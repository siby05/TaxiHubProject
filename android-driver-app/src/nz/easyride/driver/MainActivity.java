package nz.easyride.driver;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Message;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONArray;

import java.io.OutputStream;
import java.nio.charset.Charset;

/**
 * EasyRide Driver: the driver website (easyridenz.com) in a full-screen
 * WebView, so everything works exactly as on the site and site updates show
 * up without reinstalling. Native parts: location permission for trip GPS,
 * file uploads (driver documents), phone/WhatsApp/Maps/receipt links opened
 * in their own apps, printing, saving files, and the back button.
 *
 * The website itself is not changed for the app: PAGE_SCRIPT is injected
 * into each page to route window.print() and blob CSV downloads to native
 * code, and to hide "Sign in with Google" (Google blocks it in WebViews).
 * Pop-up windows (the expenses report) are printed natively, and
 * new-tab links go to the matching app or browser.
 *
 * Background: DriverService keeps watching for ride requests and records
 * trip GPS while the app is closed. This activity hands it the driver's
 * login (read from the site's localStorage) and the API address (seen in
 * the site's own requests), so the website needs no changes for it.
 */
public class MainActivity extends Activity {
    private static final String START_URL = "https://easyridenz.com/driver";
    private static final int REQ_FILE = 1;
    private static final int REQ_SAVE = 2;
    private static final int REQ_LOCATION = 3;
    private static final int REQ_STARTUP = 4;

    // The signed-in driver's token, or '' if nobody (or not a driver) is signed in.
    private static final String TOKEN_SCRIPT = "(function(){try{var u=JSON.parse(localStorage.getItem('easyride_user')||'null');"
            + "return u&&u.role==='driver'?(localStorage.getItem('easyride_token')||''):'';}catch(e){return '';}})()";

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private GeolocationPermissions.Callback geoCallback;
    private String geoOrigin;
    private String pendingSaveText;
    private WebView printView; // kept referenced until printing has started
    private final Handler handler = new Handler(Looper.getMainLooper());

    // Injected after every page load. Overrides are looked up when the page
    // calls them, so injecting after the site's own scripts is fine.
    private static final String PAGE_SCRIPT = "(function(){"
            + "if(window.__easyRideApp)return;window.__easyRideApp=true;"
            // window.print() does nothing in a WebView - print natively.
            + "window.print=function(){EasyRideApp.printPage();};"
            // CSV export: <a download href=blob:...>.click() - read the blob
            // and hand the text to native "save as".
            + "var blobs={};var oc=URL.createObjectURL;"
            + "URL.createObjectURL=function(o){var u=oc.call(URL,o);if(o instanceof Blob)blobs[u]=o;return u;};"
            + "var ck=HTMLAnchorElement.prototype.click;"
            + "HTMLAnchorElement.prototype.click=function(){var h=this.href||'';"
            + "if(this.hasAttribute('download')&&h.indexOf('blob:')===0&&blobs[h]){"
            + "var n=this.getAttribute('download')||'download',b=blobs[h],r=new FileReader();"
            + "r.onload=function(){EasyRideApp.saveTextFile(n,b.type||'text/plain',r.result);};r.readAsText(b);return;}"
            + "return ck.call(this);};"
            // Hide the Google sign-in button and its "or with email" divider.
            + "var st=document.createElement('style');"
            + "st.textContent='div:has(iframe[src*=\"accounts.google.com/gsi\"]):not(:has(form)):not(:has(input)){display:none!important}';"
            + "document.head.appendChild(st);"
            + "})();";

    static boolean isOwnSite(Uri uri) {
        String scheme = uri.getScheme();
        String host = uri.getHost();
        return ("https".equals(scheme) || "http".equals(scheme)) && host != null
                && (host.equals("easyridenz.com") || host.endsWith(".easyridenz.com"));
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true); // login is kept in localStorage
        s.setDatabaseEnabled(true);
        s.setGeolocationEnabled(true);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setSupportMultipleWindows(true); // new-tab links and pop-ups -> ChromeClient.onCreateWindow
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUserAgentString(s.getUserAgentString() + " EasyRideDriverApp/1.0");

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);

        web.addJavascriptInterface(new Bridge(), "EasyRideApp");
        web.setWebViewClient(new SiteClient());
        web.setWebChromeClient(new ChromeClient());
        web.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition, String mimeType, long length) {
                openExternally(Uri.parse(url));
            }
        });

        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(START_URL);

        DriverService.createChannels(this);
        askStartupPermissions();
    }

    // Location (trip GPS, also in the background) and, on Android 13+,
    // notifications (ride request alerts). Asked once at start.
    private void askStartupPermissions() {
        java.util.List<String> wanted = new java.util.ArrayList<>();
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            wanted.add(Manifest.permission.ACCESS_FINE_LOCATION);
            wanted.add(Manifest.permission.ACCESS_COARSE_LOCATION);
        }
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            wanted.add(Manifest.permission.POST_NOTIFICATIONS);
        }
        if (!wanted.isEmpty()) requestPermissions(wanted.toArray(new String[0]), REQ_STARTUP);
    }

    // The site signs in/out without reloading the page, so the login is
    // re-checked every few seconds while the app is on screen.
    private final Runnable loginCheck = new Runnable() {
        @Override
        public void run() {
            syncLogin(true);
            handler.postDelayed(this, 5000);
        }
    };

    @Override
    protected void onResume() {
        super.onResume();
        DriverService.appVisible = true;
        web.onResume();
        handler.removeCallbacks(loginCheck);
        handler.post(loginCheck);
    }

    @Override
    protected void onPause() {
        DriverService.appVisible = false;
        handler.removeCallbacks(loginCheck);
        syncLogin(false);
        web.onPause(); // the background service takes over alerts and GPS
        super.onPause();
    }

    // Copies the site's login to the background service and (re)starts it
    // while the app is on screen - Android only lets a location service
    // start from the foreground.
    private void syncLogin(final boolean startService) {
        web.evaluateJavascript(TOKEN_SCRIPT, new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String value) {
                String token = "";
                try {
                    token = new JSONArray("[" + value + "]").optString(0, "");
                } catch (Exception ignored) {
                }
                SharedPreferences.Editor prefs = getSharedPreferences(DriverService.PREFS, MODE_PRIVATE).edit();
                if (token.isEmpty() || "null".equals(token)) {
                    prefs.remove(DriverService.PREF_TOKEN).apply();
                    return;
                }
                prefs.putString(DriverService.PREF_TOKEN, token).apply();
                if (startService && DriverService.appVisible && !DriverService.running) DriverService.start(MainActivity.this);
            }
        });
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    private void openExternally(Uri uri) {
        try {
            Intent intent = "intent".equals(uri.getScheme())
                    ? Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME)
                    : new Intent(Intent.ACTION_VIEW, uri);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
        } catch (ActivityNotFoundException e) {
            String scheme = uri.getScheme();
            Toast.makeText(this, "whatsapp".equals(scheme) ? "WhatsApp is not installed" : "No app found to open this link", Toast.LENGTH_SHORT).show();
        } catch (Exception e) {
            Toast.makeText(this, "Could not open this link", Toast.LENGTH_SHORT).show();
        }
    }

    private class SiteClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            Uri uri = Uri.parse(url);
            if (isOwnSite(uri) || "about".equals(uri.getScheme()) || "data".equals(uri.getScheme())) return false;
            // tel:, whatsapp:, wa.me, Google Maps, receipts on the API host...
            openExternally(uri);
            return true;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            view.evaluateJavascript(PAGE_SCRIPT, null);
        }

        // Notes the API address from the site's own requests (it's set on
        // the hosting side, not known to the app) for the background service.
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
            int i = url.indexOf("/api/");
            if (i > 0 && (url.startsWith("https://") || url.startsWith("http://"))) {
                String base = url.substring(0, i + 4);
                SharedPreferences prefs = getSharedPreferences(DriverService.PREFS, MODE_PRIVATE);
                if (!base.equals(prefs.getString(DriverService.PREF_API, null))) {
                    prefs.edit().putString(DriverService.PREF_API, base).apply();
                }
            }
            return null;
        }

        @Override
        public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
            // Pre-API-23 signature: only called for the main page - show a
            // simple offline screen with a retry instead of the WebView's own.
            String retry = failingUrl != null && failingUrl.startsWith("https://") ? failingUrl : START_URL;
            String html = "<html><head><meta name='viewport' content='width=device-width,initial-scale=1'></head>"
                    + "<body style='font-family:sans-serif;text-align:center;padding:48px 24px;color:#0b2942'>"
                    + "<h2>No connection</h2><p>EasyRide Driver needs the internet. Check your connection and try again.</p>"
                    + "<p><a href='" + retry + "' style='display:inline-block;padding:12px 24px;background:#0ea5e9;color:#fff;"
                    + "border-radius:8px;text-decoration:none;font-weight:600'>Try again</a></p></body></html>";
            view.loadDataWithBaseURL(START_URL, html, "text/html", "UTF-8", retry);
        }
    }

    private class ChromeClient extends WebChromeClient {
        // A new tab / window.open(). Either it opens a URL (a WhatsApp, Maps
        // or receipt link - sent to its app, or our own site - shown here),
        // or the site writes a document into it (the expenses report),
        // which is printed.
        @Override
        public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
            final WebView popup = new WebView(MainActivity.this);
            popup.getSettings().setJavaScriptEnabled(true);
            final boolean[] handled = { false };
            popup.setWebViewClient(new WebViewClient() {
                private void route(String url) {
                    if (handled[0] || url == null || url.startsWith("about:") || url.startsWith("data:")) return;
                    handled[0] = true;
                    Uri uri = Uri.parse(url);
                    if (isOwnSite(uri)) web.loadUrl(url);
                    else openExternally(uri);
                }

                @Override
                public boolean shouldOverrideUrlLoading(WebView v, String url) {
                    route(url);
                    return true;
                }

                @Override
                public void onPageStarted(WebView v, String url, Bitmap favicon) {
                    if (url != null && !url.startsWith("about:") && !url.startsWith("data:")) {
                        v.stopLoading();
                        route(url);
                    }
                }
            });
            WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
            transport.setWebView(popup);
            resultMsg.sendToTarget();

            handler.postDelayed(new Runnable() {
                @Override
                public void run() {
                    if (handled[0]) {
                        popup.destroy();
                        return;
                    }
                    popup.evaluateJavascript("(document.body&&document.body.innerHTML.length)||0", new ValueCallback<String>() {
                        @Override
                        public void onReceiveValue(String length) {
                            if (!"0".equals(length) && !"null".equals(length)) {
                                printView = popup;
                                print(popup, popup.getTitle());
                            } else {
                                popup.destroy();
                            }
                        }
                    });
                }
            }, 800);
            return true;
        }

        @Override
        public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
            if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                    || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                callback.invoke(origin, true, false);
                return;
            }
            geoOrigin = origin;
            geoCallback = callback;
            requestPermissions(new String[] {
                    Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }, REQ_LOCATION);
        }

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            Intent intent = params.createIntent();
            // The site accepts photos and PDFs - allow both in the picker.
            intent.setType("*/*");
            intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[] { "image/jpeg", "image/png", "application/pdf" });
            try {
                startActivityForResult(Intent.createChooser(intent, "Choose a file"), REQ_FILE);
            } catch (ActivityNotFoundException e) {
                fileCallback = null;
                Toast.makeText(MainActivity.this, "No app found to pick a file", Toast.LENGTH_SHORT).show();
                return false;
            }
            return true;
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        if (requestCode == REQ_STARTUP) {
            syncLogin(true); // location may now be allowed - start the background service
            return;
        }
        if (requestCode != REQ_LOCATION || geoCallback == null) return;
        boolean granted = false;
        for (int r : results) granted |= r == PackageManager.PERMISSION_GRANTED;
        geoCallback.invoke(geoOrigin, granted, false);
        geoCallback = null;
        geoOrigin = null;
        if (granted) syncLogin(true);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE) {
            if (fileCallback != null) {
                Uri[] result = null;
                if (resultCode == RESULT_OK && data != null) {
                    if (data.getClipData() != null) {
                        result = new Uri[data.getClipData().getItemCount()];
                        for (int i = 0; i < result.length; i++) result[i] = data.getClipData().getItemAt(i).getUri();
                    } else if (data.getData() != null) {
                        result = new Uri[] { data.getData() };
                    }
                }
                fileCallback.onReceiveValue(result);
                fileCallback = null;
            }
            return;
        }
        if (requestCode == REQ_SAVE) {
            String text = pendingSaveText;
            pendingSaveText = null;
            if (resultCode != RESULT_OK || data == null || data.getData() == null || text == null) return;
            try (OutputStream out = getContentResolver().openOutputStream(data.getData())) {
                out.write(text.getBytes(Charset.forName("UTF-8")));
                Toast.makeText(this, "Saved", Toast.LENGTH_SHORT).show();
            } catch (Exception e) {
                Toast.makeText(this, "Could not save the file", Toast.LENGTH_SHORT).show();
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    private void print(WebView view, String title) {
        PrintManager pm = (PrintManager) getSystemService(PRINT_SERVICE);
        String name = title == null || title.isEmpty() ? "EasyRide" : title;
        pm.print(name, view.createPrintDocumentAdapter(name), new PrintAttributes.Builder().build());
    }

    /** window.EasyRideApp - called from the website. */
    private class Bridge {
        @JavascriptInterface
        public void printPage() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    print(web, web.getTitle());
                }
            });
        }

        @JavascriptInterface
        public void saveTextFile(final String filename, final String mimeType, final String text) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    pendingSaveText = text;
                    Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType(mimeType == null || mimeType.isEmpty() ? "text/plain" : mimeType);
                    intent.putExtra(Intent.EXTRA_TITLE, filename);
                    try {
                        startActivityForResult(intent, REQ_SAVE);
                    } catch (ActivityNotFoundException e) {
                        pendingSaveText = null;
                        Toast.makeText(MainActivity.this, "No app found to save files", Toast.LENGTH_SHORT).show();
                    }
                }
            });
        }
    }
}
