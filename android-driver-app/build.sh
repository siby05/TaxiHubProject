#!/usr/bin/env bash
# Builds EasyRide-Driver.apk without Gradle, using the Android tools from
# Ubuntu's archive:
#   apt-get install aapt apksigner zipalign dalvik-exchange android-sdk-platform-23
# Signing: KEYSTORE (path to the .keystore file) and KEYSTORE_PASS must be
# set. The key is never committed - keep the same one for every build,
# because Android only installs an update over an existing install when
# it's signed with the same key.
set -euo pipefail
cd "$(dirname "$0")"

SDK=${ANDROID_SDK:-/usr/lib/android-sdk}
ANDROID_JAR="$SDK/platforms/android-23/android.jar"
KEYSTORE=${KEYSTORE:?Set KEYSTORE to the signing .keystore file}
KEYSTORE_PASS=${KEYSTORE_PASS:?Set KEYSTORE_PASS to its password}
OUT=${OUT:-build/EasyRide-Driver.apk}

rm -rf build && mkdir -p build/gen build/classes

aapt package -f -m -J build/gen -M AndroidManifest.xml -S res -I "$ANDROID_JAR"
javac -nowarn -Xlint:-options -source 8 -target 8 -encoding UTF-8 -bootclasspath "$ANDROID_JAR" \
  -d build/classes $(find src build/gen -name '*.java')
dalvik-exchange --dex --output=build/classes.dex build/classes

# -0 arsc: Android 11+ refuses APKs whose resources.arsc is compressed.
aapt package -f -0 arsc -M AndroidManifest.xml -S res -I "$ANDROID_JAR" -F build/unsigned.apk
(cd build && aapt add -f unsigned.apk classes.dex >/dev/null)
zipalign -f -p 4 build/unsigned.apk build/aligned.apk
apksigner sign --ks "$KEYSTORE" --ks-pass "pass:$KEYSTORE_PASS" --out "$OUT" build/aligned.apk
apksigner verify "$OUT"
echo "Built $OUT"
