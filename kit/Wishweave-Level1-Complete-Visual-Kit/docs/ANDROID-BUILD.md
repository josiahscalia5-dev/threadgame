# Android visual-kit host

The `android/` folder is native **source for the visual viewer**, not the playable game or a compiled APK. It displays the seven-screen review and editable scene presentation supplied by `scene/index.html`. Gameplay, a real reward service and device validation remain work for Claudia.

The app label is **Wishweave Level1 Visual Kit**. Its application ID is `com.wishweave.completevisualkit`, separate from the earlier prototypes.

## Build status and pinned configuration

No native build, APK, signed release, installation or physical-device test is delivered. No Gradle wrapper JAR is included. Generate a real wrapper using Gradle rather than creating a placeholder file. The following values are the configuration retained in this source project, not a claim that they are the newest releases.

| Setting | Project value |
|---|---|
| Android Gradle Plugin | 8.13.2 |
| Gradle | 8.13 |
| Java | Full JDK 17, including `javac` |
| Compile / target SDK | 36 |
| Minimum SDK | 26 |
| SDK Build Tools | 35.0.0, AGP default used by this project |
| AndroidX WebKit | 1.14.0 |
| Entry page | `scene/index.html` |

## Build instructions

1. Extract the complete ZIP. Keep `android/`, `scene/`, `assets/` and `approved/` beside each other. Do not open the Android directory while it remains inside an archive.
2. Install Android Studio supporting this project's AGP and a full JDK 17. Select that JDK in the Gradle settings. Confirm both `java -version` and `javac -version` report 17.
3. Install Android SDK Platform 36, SDK Build-Tools 35.0.0, Platform-Tools and Command-line Tools. Accept SDK licenses on your development machine. Add an emulator/system image if using one for testing.
4. Open the extracted kit's `android/` folder. Let Android Studio generate `local.properties` for your SDK location; do not distribute that machine-specific file.
5. Obtain the official Gradle 8.13 binary distribution and verify it against its matching published checksum. From the kit's `android/` folder, use that executable to create the wrapper and build.

On macOS/Linux:

```sh
/absolute/path/to/gradle-8.13/bin/gradle wrapper --gradle-version 8.13 --distribution-type bin
./gradlew --version
./gradlew :app:assembleDebug
```

On Windows PowerShell:

```powershell
& 'C:\absolute\path\to\gradle-8.13\bin\gradle.bat' wrapper --gradle-version 8.13 --distribution-type bin
.\gradlew.bat --version
.\gradlew.bat :app:assembleDebug
```

The wrapper command produces the real `gradlew`, `gradlew.bat` and `gradle/wrapper/` files. Keep them in the downstream project. Dependency downloads require internet access during setup/build. Resolve actual SDK/JDK/dependency errors before retrying; do not report a successful build from source inspection alone.

After a successful debug build, the expected output is `android/app/build/outputs/apk/debug/app-debug.apk`. From the `android/` directory, install on a connected test device with:

```sh
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Alternatively select a device in Android Studio and press Run. A debug APK is a development viewer, not a store-ready signed game release.

## Shared assets and lifecycle

The `bundleCompleteVisualKit` task copies the sibling `scene/`, `approved/` and `assets/` folders into the generated Android assets before build. Edit those original folders, not generated build copies. Relative asset paths are preserved, so the browser and Android host share the same art/source.

The entry address is `https://appassets.androidplatform.net/assets/scene/index.html`. It is an in-app asset origin, not a public hosted website. The host accepts local asset navigation and blocks network fallback for missing files. The visual app does not implement real-money services.

The native root applies system-bar and display-cutout insets to the WebView. Keep this when adding gameplay. Do not force-stretch portrait art into landscape. On backgrounding, the host calls `window.WishweaveVisual.pause()` when available and pauses WebView timers. Returning resumes the view but should not restart autoplay until the user chooses it. Native Back closes this visual viewer. The host includes a tap-to-reopen fallback after a WebView renderer failure.

## Device checks still required

Test a compact phone, a tall gesture-navigation phone, a cutout display, three-button navigation, landscape, tablet/foldable or split screen, large font/display scaling, background/foreground, Back, and offline loading after install. Confirm all art, toolbar controls and rewards UI remain reachable and uncropped. Profile memory on constrained devices when all large plates and atlases are loaded.

After gameplay is implemented, additionally test touches, pause fairness, collision, recovery and both race results on real Android hardware. This source package declares a minimum SDK but does not prove compatibility with every phone or WebView version.
