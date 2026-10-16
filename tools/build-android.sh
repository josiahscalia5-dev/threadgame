#!/usr/bin/env bash
# Builds the Wishweave Wonders Level 1 debug APK from android/ (which packages ../game).
#
#   tools/build-android.sh [--preview] [--allow-incomplete-game] [extra gradle args...]
#
#   --preview   build the separate "Wishweave Preview" app (opens game/connected/index.html, installs next to the
#               game) as dist/wishweave-wonders-connected-preview.apk
#
# Environment (all optional):
#   ANDROID_HOME   Android SDK (default /opt/android-sdk; needs platforms;android-36, build-tools;35.0.0)
#   GRADLE_BIN     Gradle used ONLY to create the wrapper when it is missing (default /opt/gradle/bin/gradle,
#                  then `gradle` on PATH). The build itself always runs through ./gradlew (Gradle 8.13).
#   JAVA_HOME      JDK 17+ with javac (the system default is used otherwise)
#
# Output: dist/wishweave-wonders-level1-debug.apk, or dist/wishweave-wonders-connected-preview.apk with --preview
# (+ .sha256), debug-signed with the local debug keystore.
set -euo pipefail

GRADLE_VERSION=8.13
# Official SHA-256 of gradle-8.13-bin.zip (https://services.gradle.org/distributions/gradle-8.13-bin.zip.sha256);
# written into gradle-wrapper.properties so the wrapper verifies the download.
GRADLE_DIST_SHA256=20f1b1176237254a6fc204d8434196fa11a4cfb387567519c61556e8710aed78

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_DIR="$REPO/android"
DIST_DIR="$REPO/dist"
APK_SRC="$ANDROID_DIR/app/build/outputs/apk/debug/app-debug.apk"
APK_OUT="$DIST_DIR/wishweave-wonders-level1-debug.apk"

ALLOW_INCOMPLETE=0
PREVIEW=0
GRADLE_ARGS=()
for arg in "$@"; do
  case "$arg" in
    --allow-incomplete-game) ALLOW_INCOMPLETE=1 ;;
    --preview) PREVIEW=1 ;;
    -h|--help) sed -n '2,16p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) GRADLE_ARGS+=("$arg") ;;
  esac
done
if [ "$PREVIEW" = 1 ]; then
  GRADLE_ARGS+=("-Pwishweave.preview=connected")
  APK_OUT="$DIST_DIR/wishweave-wonders-connected-preview.apk"
fi
if [ "$ALLOW_INCOMPLETE" = 1 ]; then
  GRADLE_ARGS+=("-Pwishweave.allowIncompleteGame=true")
fi

log() { printf '\n== %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- SDK + JDK
export ANDROID_HOME="${ANDROID_HOME:-/opt/android-sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
[ -d "$ANDROID_HOME/platforms/android-36" ] || die "Android SDK platform 36 not found under $ANDROID_HOME (set ANDROID_HOME)."
[ -d "$ANDROID_HOME/build-tools/35.0.0" ] || echo "WARNING: build-tools 35.0.0 not found under $ANDROID_HOME; Gradle may try to install it."

JAVA_CMD="java"; JAVAC_CMD="javac"
if [ -n "${JAVA_HOME:-}" ]; then JAVA_CMD="$JAVA_HOME/bin/java"; JAVAC_CMD="$JAVA_HOME/bin/javac"; fi
command -v "$JAVAC_CMD" >/dev/null 2>&1 || die "javac not found: a full JDK 17+ is required (set JAVA_HOME)."
JAVA_MAJOR="$("$JAVA_CMD" -XshowSettings:properties -version 2>&1 | awk -F'= ' '/java.specification.version/ {print $2; exit}')"
JAVA_MAJOR="${JAVA_MAJOR#1.}"
[ -n "$JAVA_MAJOR" ] && [ "$JAVA_MAJOR" -ge 17 ] 2>/dev/null || die "JDK 17+ required (found: ${JAVA_MAJOR:-unknown})."
echo "JDK $JAVA_MAJOR ($(command -v "$JAVA_CMD")), ANDROID_HOME=$ANDROID_HOME"

[ -f "$REPO/game/index.html" ] || {
  [ "$ALLOW_INCOMPLETE" = 1 ] || die "game/index.html is missing. Finish game/ first, or pass --allow-incomplete-game for a host-only test build."
  echo "WARNING: game/index.html is missing; building a host-only test APK (--allow-incomplete-game)."
}

# ---------------------------------------------------------------- Gradle wrapper
if [ ! -f "$ANDROID_DIR/gradlew" ] || [ ! -f "$ANDROID_DIR/gradle/wrapper/gradle-wrapper.jar" ] \
   || [ ! -f "$ANDROID_DIR/gradle/wrapper/gradle-wrapper.properties" ]; then
  GRADLE_BIN="${GRADLE_BIN:-/opt/gradle/bin/gradle}"
  if [ ! -x "$GRADLE_BIN" ]; then GRADLE_BIN="$(command -v gradle || true)"; fi
  [ -n "$GRADLE_BIN" ] && [ -x "$GRADLE_BIN" ] || die "Gradle wrapper missing and no gradle executable found (set GRADLE_BIN)."
  log "Creating Gradle $GRADLE_VERSION wrapper with $GRADLE_BIN"
  WRAP_TMP="$(mktemp -d)"
  trap 'rm -rf "$WRAP_TMP"' EXIT
  # Generated in an empty build so the system Gradle never has to configure the Android project.
  : > "$WRAP_TMP/settings.gradle"
  "$GRADLE_BIN" --no-daemon --quiet -p "$WRAP_TMP" wrapper \
    --gradle-version "$GRADLE_VERSION" --distribution-type bin \
    --gradle-distribution-sha256-sum "$GRADLE_DIST_SHA256"
  mkdir -p "$ANDROID_DIR/gradle/wrapper"
  cp "$WRAP_TMP/gradlew" "$WRAP_TMP/gradlew.bat" "$ANDROID_DIR/"
  cp "$WRAP_TMP/gradle/wrapper/gradle-wrapper.jar" "$WRAP_TMP/gradle/wrapper/gradle-wrapper.properties" \
     "$ANDROID_DIR/gradle/wrapper/"
  chmod +x "$ANDROID_DIR/gradlew"
fi

# ---------------------------------------------------------------- local.properties
if [ ! -f "$ANDROID_DIR/local.properties" ]; then
  log "Writing android/local.properties (sdk.dir=$ANDROID_HOME)"
  printf '# Machine-specific; not committed.\nsdk.dir=%s\n' "$ANDROID_HOME" > "$ANDROID_DIR/local.properties"
fi

# ---------------------------------------------------------------- build
log "Building :app:assembleDebug"
(cd "$ANDROID_DIR" && ./gradlew --no-daemon --console=plain :app:assembleDebug ${GRADLE_ARGS[@]+"${GRADLE_ARGS[@]}"})
[ -f "$APK_SRC" ] || die "Build finished but $APK_SRC was not produced."

mkdir -p "$DIST_DIR"
cp "$APK_SRC" "$APK_OUT"
SHA256="$(sha256sum "$APK_OUT" | awk '{print $1}')"
SIZE="$(stat -c %s "$APK_OUT" 2>/dev/null || stat -f %z "$APK_OUT")"
printf '%s  %s\n' "$SHA256" "$(basename "$APK_OUT")" > "$APK_OUT.sha256"

# ---------------------------------------------------------------- verify
AAPT2="$(ls -d "$ANDROID_HOME"/build-tools/*/aapt2 2>/dev/null | sort -V | tail -n 1 || true)"
if [ -n "$AAPT2" ]; then
  log "aapt2 dump badging (selected lines)"
  "$AAPT2" dump badging "$APK_OUT" | grep -E "^(package|sdkVersion|targetSdkVersion|application-label|application:|launchable-activity|uses-permission|native-code)" || true
  if "$AAPT2" dump badging "$APK_OUT" | grep -q "uses-permission: name='android.permission.INTERNET'"; then
    die "APK requests android.permission.INTERNET; the host must stay local-only."
  fi
fi

log "Packaged game files"
python3 - "$APK_OUT" "$ALLOW_INCOMPLETE" "$PREVIEW" <<'PY'
import posixpath, re, sys, zipfile
apk, allow_incomplete, preview = sys.argv[1], sys.argv[2] == '1', sys.argv[3] == '1'
names = set(zipfile.ZipFile(apk).namelist())
game = sorted(n for n in names if n.startswith('assets/game/'))
print(f'{len(game)} files under assets/game/')
missing = []
if 'assets/game/index.html' not in names:
    missing.append('assets/game/index.html')
else:
    html = zipfile.ZipFile(apk).read('assets/game/index.html').decode('utf-8', 'replace')
    refs = re.findall(r'<(?:script|link|img)\b[^>]*?\b(?:src|href)\s*=\s*["\']([^"\'#?]+)', html, re.I)
    for ref in refs:
        if re.match(r'^[a-z]+:', ref, re.I) or ref.startswith('//'):
            continue  # external/data URLs are blocked by the host anyway; the game must not use them
        if ref.startswith('../'):
            # outside game/: the browser test harness (index.html?stubs=1 only), never part of the app
            print(f'  dev-only reference outside game/ (not packaged, not loaded by the app): {ref}')
            continue
        if 'assets/game/' + ref.lstrip('./') not in names:
            missing.append('assets/game/' + ref.lstrip('./') + '  (referenced by index.html)')
    print(f'index.html references {len(refs)} local files')
if 'assets/game/src/data/asset-data.js' in names:
    data = zipfile.ZipFile(apk).read('assets/game/src/data/asset-data.js').decode('utf-8', 'replace')
    files = sorted(set(re.findall(r'["\']?file["\']?\s*:\s*["\']([^"\']+)["\']', data)))
    for f in files:
        if 'assets/game/' + f.lstrip('./') not in names:
            missing.append('assets/game/' + f + '  (WW.ASSETS image)')
    print(f'asset-data.js lists {len(files)} image files')
if preview:
    # The preview app opens connected/index.html. Its <base href="../"> resolves every reference against game/.
    page = 'assets/game/connected/index.html'
    if page not in names:
        missing.append(page + '  (the preview app\'s entry page)')
    else:
        html = zipfile.ZipFile(apk).read(page).decode('utf-8', 'replace')
        base = re.search(r'<base\b[^>]*\bhref\s*=\s*["\']([^"\']*)', html, re.I)
        root = posixpath.normpath(posixpath.join('assets/game/connected', base.group(1) if base else '.'))
        refs = [r for r in re.findall(r'<(?:script|link|img)\b[^>]*?\b(?:src|href)\s*=\s*["\']([^"\'#?]+)', html, re.I)
                if not re.match(r'^[a-z]+:', r, re.I) and not r.startswith('//')]
        for ref in refs:
            if posixpath.normpath(posixpath.join(root, ref)) not in names:
                missing.append(posixpath.join(root, ref) + '  (referenced by connected/index.html)')
        print(f'connected/index.html references {len(refs)} local files')
    if 'assets/game/connected/src/data/world-art.js' in names:
        data = zipfile.ZipFile(apk).read('assets/game/connected/src/data/world-art.js').decode('utf-8', 'replace')
        files = sorted(set(re.findall(r'"file"\s*:\s*"([^"]+)"', data)))
        for f in files:
            if 'assets/game/' + f not in names:
                missing.append('assets/game/' + f + '  (WW.WORLD_ART image)')
        print(f'world-art.js lists {len(files)} image files')
for n in game[:8]:
    print('  ' + n)
if len(game) > 8:
    print(f'  ... and {len(game) - 8} more')
if missing:
    print('MISSING from APK:')
    for m in missing:
        print('  ' + m)
    sys.exit(0 if allow_incomplete else 1)
PY

log "APK ready"
echo "path:    $APK_OUT"
echo "size:    $SIZE bytes ($(awk -v s="$SIZE" 'BEGIN{printf "%.2f MiB", s/1048576}'))"
echo "sha256:  $SHA256"
echo "install: adb install -r \"$APK_OUT\""
