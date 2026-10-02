#!/usr/bin/env bash
# Builds EasyRide-Driver.apk without Gradle, using the Android tools from
# Ubuntu's archive:
#   apt-get install aapt apksigner zipalign dalvik-exchange android-sdk-platform-23
# (that android.jar supplies the java.* core classes) and the Android 14 framework (classes + resources) from Robolectric's
# android-all jar on Maven Central, downloaded once into ~/.cache.
# Signing: KEYSTORE (path to the .keystore file) and KEYSTORE_PASS must be
# set. The key is never committed - keep the same one for every build,
# because Android only installs an update over an existing install when
# it's signed with the same key.
set -euo pipefail
cd "$(dirname "$0")"

ALL_VERSION=14-robolectric-10818077
ALL_SHA1=94b1490a891e9be559aa35c87cd8a0c163f32d83
ANDROID_JAR=${ANDROID_JAR:-$HOME/.cache/easyride/android-all-$ALL_VERSION.jar}
if [ ! -f "$ANDROID_JAR" ]; then
  mkdir -p "$(dirname "$ANDROID_JAR")"
  curl -fsSL -o "$ANDROID_JAR.tmp" \
    "https://repo1.maven.org/maven2/org/robolectric/android-all/$ALL_VERSION/android-all-$ALL_VERSION.jar"
  echo "$ALL_SHA1  $ANDROID_JAR.tmp" | sha1sum -c --quiet
  mv "$ANDROID_JAR.tmp" "$ANDROID_JAR"
fi
CORE_JAR=${CORE_JAR:-/usr/lib/android-sdk/platforms/android-23/android.jar}
KEYSTORE=${KEYSTORE:?Set KEYSTORE to the signing .keystore file}
KEYSTORE_PASS=${KEYSTORE_PASS:?Set KEYSTORE_PASS to its password}
OUT=${OUT:-build/EasyRide-Driver.apk}

rm -rf build && mkdir -p build/gen build/classes

aapt package -f -m -J build/gen -M AndroidManifest.xml -S res -I "$ANDROID_JAR"
javac -nowarn -Xlint:-options -source 8 -target 8 -encoding UTF-8 -bootclasspath "$ANDROID_JAR:$CORE_JAR" \
  -d build/classes $(find src build/gen -name '*.java')
dalvik-exchange --dex --output=build/classes.dex build/classes

# -0 arsc: Android 11+ refuses APKs whose resources.arsc is compressed.
aapt package -f -0 arsc -M AndroidManifest.xml -S res -I "$ANDROID_JAR" -F build/unsigned.apk
(cd build && aapt add -f unsigned.apk classes.dex >/dev/null)
zipalign -f -p 4 build/unsigned.apk build/aligned.apk
apksigner sign --ks "$KEYSTORE" --ks-pass "pass:$KEYSTORE_PASS" --out "$OUT" build/aligned.apk
apksigner verify "$OUT"
echo "Built $OUT"
