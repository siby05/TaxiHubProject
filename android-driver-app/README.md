# EasyRide Driver - Android app

A small native Android app that opens the driver website
(https://easyridenz.com/driver) full-screen. Everything is the same as on the
website, and website updates show up in the app straight away - only changes
to this folder need a new APK. The website itself has no app-specific code:
the few things a WebView can't do on its own are handled by a script the app
injects into each page (see PAGE_SCRIPT in MainActivity.java).

What the app adds on top of the website:
- Location permission prompt, so trip GPS tracking and "use my location" work
- File picker for uploading driver documents (photos or PDF)
- Call, WhatsApp, Google Maps and receipt links open in their own apps
- Printing (QR card, expenses report) and saving the expenses CSV
- Android back button goes back a page
- "No connection" screen with a retry button

Not supported in the app (same limits as any app WebView):
- "Sign in with Google" - Google blocks it inside apps, so the app hides the
  button; drivers sign in with email and password
- Pop-up notifications while the app is closed
- Recording trip GPS while the app is in the background or the screen is off

## Building

Built without Android Studio or Gradle, using Android's command-line tools
from Ubuntu's package archive:

    apt-get install aapt apksigner zipalign dalvik-exchange android-sdk-platform-23
    KEYSTORE=/path/to/release.keystore KEYSTORE_PASS=... ./build.sh
    # -> build/EasyRide-Driver.apk

For each new release, raise `android:versionCode` (and `versionName`) in
AndroidManifest.xml, otherwise phones won't install it as an update.

## Signing key

The signing key is not in this repository (it's git-ignored). Keep it
somewhere safe: Android only installs an update over an existing install
when it's signed with the same key. If it's lost, drivers have to uninstall
the app and install a new one signed with a new key.
