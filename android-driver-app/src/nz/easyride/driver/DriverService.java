package nz.easyride.driver;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;

/**
 * Keeps working while the app is in the background or closed, using the
 * same backend endpoints the website uses (nothing on the server changes):
 *  - every 20 s, GET /booking/driver: a notification for each new ride
 *    request, and when a passenger cancels an accepted trip
 *  - while a trip is on the go, records GPS and POSTs it to
 *    /booking/driver/location every 15 s (kept 7 days by the backend)
 * While the app is on screen the website does both itself, so this stays
 * quiet then (no double alerts or GPS points). Runs while the driver is
 * online or has a trip on the go, and stops itself otherwise; the app
 * starts it again when opened.
 */
public class DriverService extends Service {
    static final String PREFS = "easyride";
    static final String PREF_TOKEN = "token";
    static final String PREF_API = "apiBase";

    private static final String CHANNEL_SERVICE = "service";
    private static final String CHANNEL_ALERTS = "ride_alerts";
    private static final int ID_SERVICE = 1;
    private static final long POLL_MS = 20 * 1000;
    private static final long GPS_SEND_MS = 15 * 1000;
    private static final long SCHEDULED_AHEAD_MS = 15 * 60 * 1000;

    /** Set by MainActivity - true while the app is on screen. */
    static volatile boolean appVisible;
    /** True while the service is up. */
    static volatile boolean running;

    private HandlerThread thread;
    private Handler worker;
    private LocationManager locationManager;
    private boolean gpsOn;
    private long lastGpsSent;
    private boolean firstPoll = true;
    private final Set<String> seenRequests = new HashSet<>();
    private final Map<String, String> tripStatus = new HashMap<>();
    private int nextAlertId = 100;
    private String serviceText = "";

    static void start(Context context) {
        Intent intent = new Intent(context, DriverService.class);
        try {
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent);
            else context.startService(intent);
        } catch (Exception ignored) {
            // Not allowed right now (e.g. app in background) - started next time the app opens.
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createChannels(this);
        thread = new HandlerThread("EasyRideDriver");
        thread.start();
        worker = new Handler(thread.getLooper());
        locationManager = (LocationManager) getSystemService(LOCATION_SERVICE);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (!hasLocationPermission()) {
            stopSelf();
            return START_NOT_STICKY;
        }
        try {
            Notification n = serviceNotification("Watching for ride requests");
            if (Build.VERSION.SDK_INT >= 29) startForeground(ID_SERVICE, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            else startForeground(ID_SERVICE, n);
        } catch (Exception e) {
            stopSelf();
            return START_NOT_STICKY;
        }
        running = true;
        worker.removeCallbacks(poll);
        worker.post(poll);
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        worker.removeCallbacksAndMessages(null);
        stopGps();
        thread.quitSafely();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private final Runnable poll = new Runnable() {
        @Override
        public void run() {
            try {
                if (!pollOnce()) {
                    stopSelf();
                    return;
                }
            } catch (Exception ignored) {
                // Network hiccup - try again next round.
            }
            worker.postDelayed(this, POLL_MS);
        }
    };

    /** One round. Returns false when the service is no longer needed. */
    private boolean pollOnce() throws Exception {
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        String token = prefs.getString(PREF_TOKEN, null);
        String api = prefs.getString(PREF_API, null);
        if (token == null) return false; // signed out
        if (api == null) return true;    // app hasn't seen the API address yet

        Response profileRes = request("GET", api + "/driver/profile", token, null);
        if (profileRes.code == 401 || profileRes.code == 403) return false;
        Response bookingsRes = request("GET", api + "/booking/driver", token, null);
        if (bookingsRes.code == 401 || bookingsRes.code == 403) return false;
        if (profileRes.code != 200 || bookingsRes.code != 200) return true;

        boolean online = new JSONObject(profileRes.body).optBoolean("isAvailable", false);
        JSONArray bookings = new JSONArray(bookingsRes.body);
        long now = System.currentTimeMillis();
        boolean tripOnTheGo = false;

        for (int i = 0; i < bookings.length(); i++) {
            JSONObject b = bookings.getJSONObject(i);
            String id = b.optString("_id");
            String status = b.optString("status");
            boolean mine = !b.isNull("driverId");

            if ("pending".equals(status) && !seenRequests.contains(id)) {
                seenRequests.add(id);
                if (!firstPoll && !appVisible) {
                    alert("New ride request", route(b) + passengerLine(b));
                }
            }

            String before = tripStatus.get(id);
            if (mine && "cancelled".equals(status) && ("accepted".equals(before) || "in-progress".equals(before)) && !appVisible) {
                alert("Trip cancelled", route(b) + (b.optString("cancelReason").isEmpty() ? "" : "\n" + b.optString("cancelReason")));
            }
            if (mine) tripStatus.put(id, status);

            if (mine && isOnTheGo(b, status, now)) tripOnTheGo = true;
        }
        firstPoll = false;

        if (tripOnTheGo && !appVisible) startGps();
        else stopGps();

        updateServiceText(tripOnTheGo ? "Trip in progress - recording GPS route" : "Online - watching for ride requests");
        return online || tripOnTheGo || appVisible;
    }

    // Same rule as the website (DriverDashboard.jsx isTripOnTheGo): in
    // progress, or accepted and either due now or already arrived.
    private static boolean isOnTheGo(JSONObject b, String status, long now) {
        if ("in-progress".equals(status)) return true;
        if (!"accepted".equals(status)) return false;
        if (!b.isNull("arrivedAt") || b.isNull("scheduledFor")) return true;
        Date scheduled = parseDate(b.optString("scheduledFor"));
        return scheduled == null || scheduled.getTime() - now <= SCHEDULED_AHEAD_MS;
    }

    private static String route(JSONObject b) {
        return b.optString("pickupAddress") + " → " + b.optString("dropAddress");
    }

    private static String passengerLine(JSONObject b) {
        JSONObject p = b.optJSONObject("passengerId");
        String name = p == null ? "" : p.optString("name");
        String fare = b.has("estimatedFare") ? " · est. $" + b.optString("estimatedFare") : "";
        return name.isEmpty() && fare.isEmpty() ? "" : "\n" + name + fare;
    }

    // ---- GPS ----

    private final LocationListener locationListener = new LocationListener() {
        @Override
        public void onLocationChanged(final Location loc) {
            long now = System.currentTimeMillis();
            if (now - lastGpsSent < GPS_SEND_MS || appVisible) return;
            lastGpsSent = now;
            worker.post(new Runnable() {
                @Override
                public void run() {
                    sendLocation(loc);
                }
            });
        }

        @Override public void onStatusChanged(String provider, int status, Bundle extras) { }
        @Override public void onProviderEnabled(String provider) { }
        @Override public void onProviderDisabled(String provider) { }
    };

    private void startGps() {
        if (gpsOn || !hasLocationPermission()) return;
        try {
            if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 5000, 0, locationListener, thread.getLooper());
            }
            if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                locationManager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 10000, 0, locationListener, thread.getLooper());
            }
            gpsOn = true;
        } catch (SecurityException ignored) {
        }
    }

    private void stopGps() {
        if (!gpsOn) return;
        locationManager.removeUpdates(locationListener);
        gpsOn = false;
    }

    private void sendLocation(Location loc) {
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        String token = prefs.getString(PREF_TOKEN, null);
        String api = prefs.getString(PREF_API, null);
        if (token == null || api == null) return;
        try {
            JSONObject body = new JSONObject();
            body.put("lat", loc.getLatitude());
            body.put("lng", loc.getLongitude());
            if (loc.hasAccuracy()) body.put("accuracy", loc.getAccuracy());
            if (loc.hasSpeed()) body.put("speed", loc.getSpeed());
            if (loc.hasBearing()) body.put("heading", loc.getBearing());
            body.put("recordedAt", isoDate(loc.getTime()));
            Response r = request("POST", api + "/booking/driver/location", token, body.toString());
            if (r.code != 200) lastGpsSent = 0; // retry on the next fix
        } catch (Exception e) {
            lastGpsSent = 0;
        }
    }

    private boolean hasLocationPermission() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    // ---- notifications ----

    static void createChannels(Context context) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = context.getSystemService(NotificationManager.class);
        NotificationChannel service = new NotificationChannel(CHANNEL_SERVICE, "Running in background", NotificationManager.IMPORTANCE_LOW);
        service.setDescription("Shown while EasyRide Driver watches for ride requests and records trip GPS");
        nm.createNotificationChannel(service);
        NotificationChannel alerts = new NotificationChannel(CHANNEL_ALERTS, "Ride requests and trip updates", NotificationManager.IMPORTANCE_HIGH);
        alerts.setDescription("New ride requests and cancelled trips");
        alerts.enableVibration(true);
        nm.createNotificationChannel(alerts);
    }

    private PendingIntent openAppIntent() {
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        return PendingIntent.getActivity(this, 0, open, flags);
    }

    @SuppressWarnings("deprecation")
    private Notification.Builder builder(String channel) {
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, channel) : new Notification.Builder(this);
        return b.setSmallIcon(R.drawable.ic_stat_car).setContentIntent(openAppIntent()).setColor(0xFF0EA5E9);
    }

    private Notification serviceNotification(String text) {
        return builder(CHANNEL_SERVICE)
                .setContentTitle("EasyRide Driver is running")
                .setContentText(text)
                .setOngoing(true)
                .build();
    }

    private void updateServiceText(String text) {
        if (text.equals(serviceText)) return;
        serviceText = text;
        ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).notify(ID_SERVICE, serviceNotification(text));
    }

    @SuppressWarnings("deprecation")
    private void alert(String title, String text) {
        Notification.Builder b = builder(CHANNEL_ALERTS)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setAutoCancel(true)
                .setCategory(Notification.CATEGORY_MESSAGE);
        if (Build.VERSION.SDK_INT < 26) b.setPriority(Notification.PRIORITY_HIGH).setDefaults(Notification.DEFAULT_ALL);
        try {
            ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).notify(nextAlertId++, b.build());
        } catch (SecurityException ignored) {
            // Notification permission turned off.
        }
    }

    // ---- HTTP ----

    private static class Response {
        int code;
        String body;
    }

    private static Response request(String method, String url, String token, String json) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        try {
            c.setRequestMethod(method);
            c.setConnectTimeout(15000);
            c.setReadTimeout(20000);
            c.setRequestProperty("Authorization", "Bearer " + token);
            c.setRequestProperty("Accept", "application/json");
            if (json != null) {
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type", "application/json");
                try (OutputStream out = c.getOutputStream()) {
                    out.write(json.getBytes("UTF-8"));
                }
            }
            Response r = new Response();
            r.code = c.getResponseCode();
            InputStream in = r.code >= 400 ? c.getErrorStream() : c.getInputStream();
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            if (in != null) {
                byte[] chunk = new byte[8192];
                for (int n; (n = in.read(chunk)) > 0; ) buf.write(chunk, 0, n);
                in.close();
            }
            r.body = buf.toString("UTF-8");
            return r;
        } finally {
            c.disconnect();
        }
    }

    private static String isoDate(long millis) {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        f.setTimeZone(TimeZone.getTimeZone("UTC"));
        return f.format(new Date(millis));
    }

    private static Date parseDate(String iso) {
        try {
            SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
            f.setTimeZone(TimeZone.getTimeZone("UTC"));
            return f.parse(iso);
        } catch (Exception e) {
            return null;
        }
    }
}
