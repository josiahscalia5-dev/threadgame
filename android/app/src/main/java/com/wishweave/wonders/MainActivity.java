package com.wishweave.wonders;

import android.annotation.TargetApi;
import android.app.Activity;
import android.content.pm.ApplicationInfo;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.DisplayCutout;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;

import androidx.webkit.WebViewAssetLoader;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;

/**
 * Native host for the Wishweave Wonders Level 1 web game (docs/ARCHITECTURE.md §10).
 *
 * The game in assets/game/ is served from the in-app origin https://appassets.androidplatform.net
 * by {@link WebViewAssetLoader}. Nothing is fetched from the network: every other URL, and every
 * missing asset, gets a local 403/404 response, and the app has no INTERNET permission.
 *
 * Host -> game mapping (public API window.WishweaveGame, §9):
 *   onPause  -> WishweaveGame.pause('background'), WebView.onPause(), pauseTimers()
 *   onResume -> resumeTimers(), WebView.onResume() only; the race stays paused until the player resumes
 *   Back     -> WishweaveGame.onBack(); the activity finishes only when it returns 'exit'
 *   Screen   -> immersive full screen, drawn edge to edge (behind the cutout and the hidden system bars)
 *   Insets   -> the remaining cutout/system-bar insets are sent to the page in CSS px
 *               (WishweaveGame.setInsets), so only the HUD keeps clear of them and the scene fills the screen
 */
public class MainActivity extends Activity {
    private static final String TAG = "Wishweave";
    private static final String HOST = "appassets.androidplatform.net";
    static final String ENTRY = "https://" + HOST + "/assets/game/index.html";
    private static final int BACKGROUND = Color.rgb(43, 24, 16);

    /** window.WishweaveGame && WishweaveGame.pause('background'), guarded so it can never throw. */
    private static final String JS_PAUSE =
        "(function(){try{var g=window.WishweaveGame;"
        + "if(g&&typeof g.pause==='function'){g.pause('background');}}catch(e){}})();";

    /**
     * Asks the game what Back means. Returns the game's answer ('paused' or 'exit'). When the game
     * API is not available (page still loading, or failed to load) it returns 'exit' so Back can
     * never trap the player in a broken page.
     */
    private static final String JS_BACK =
        "(function(){try{var g=window.WishweaveGame;"
        + "if(!g||typeof g.onBack!=='function'){return 'exit';}"
        + "return String(g.onBack());}catch(e){return 'exit';}})();";

    private FrameLayout root;
    private WebView web;
    private int[] insetsPx = {0, 0, 0, 0};   // top, right, bottom, left (physical px) last reported by the system
    private Object backCallback;   // OnBackInvokedCallback on API 33+, kept as Object for older class verification

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        root = new FrameLayout(this);
        root.setBackgroundColor(BACKGROUND);
        layoutEdgeToEdge();
        setContentView(root);
        root.setOnApplyWindowInsetsListener(this::onInsets);
        root.requestApplyInsets();
        enterImmersive();

        if (Build.VERSION.SDK_INT >= 33) {
            backCallback = BackApi33.register(this, this::handleBack);
        }
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            // chrome://inspect for debug builds only.
            WebView.setWebContentsDebuggingEnabled(true);
        }
        createGameView();
    }

    // ---------------------------------------------------------------- full screen + insets

    @SuppressWarnings("deprecation")
    private void layoutEdgeToEdge() {
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams attrs = getWindow().getAttributes();
            attrs.layoutInDisplayCutoutMode = Build.VERSION.SDK_INT >= 30
                ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(attrs);
        }
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
        }
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
    }

    /** Hides the status and navigation bars; a swipe from the edge shows them briefly over the game. */
    @SuppressWarnings("deprecation")
    private void enterImmersive() {
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.systemBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) enterImmersive();
    }

    /**
     * The WebView always fills the whole screen. Whatever the cutout or visible system bars still cover is
     * reported to the page so its HUD and buttons stay clear of it; the scene itself draws underneath.
     */
    @SuppressWarnings("deprecation")
    private WindowInsets onInsets(View view, WindowInsets insets) {
        int left, top, right, bottom;
        if (Build.VERSION.SDK_INT >= 30) {
            Insets safe = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            left = safe.left; top = safe.top; right = safe.right; bottom = safe.bottom;
        } else {
            left = insets.getSystemWindowInsetLeft();
            top = insets.getSystemWindowInsetTop();
            right = insets.getSystemWindowInsetRight();
            bottom = insets.getSystemWindowInsetBottom();
            if (Build.VERSION.SDK_INT >= 28) {
                DisplayCutout cutout = insets.getDisplayCutout();
                if (cutout != null) {
                    left = Math.max(left, cutout.getSafeInsetLeft());
                    top = Math.max(top, cutout.getSafeInsetTop());
                    right = Math.max(right, cutout.getSafeInsetRight());
                    bottom = Math.max(bottom, cutout.getSafeInsetBottom());
                }
            }
        }
        insetsPx = new int[] {top, right, bottom, left};
        sendInsets();
        return insets;
    }

    /** WishweaveGame.setInsets(top, right, bottom, left) in CSS px; harmless if the page is not ready yet. */
    private void sendInsets() {
        if (web == null) return;
        float d = getResources().getDisplayMetrics().density;
        String js = String.format(java.util.Locale.ROOT,
            "(function(){try{var g=window.WishweaveGame;if(g&&g.setInsets){g.setInsets(%.1f,%.1f,%.1f,%.1f);}}catch(e){}})();",
            insetsPx[0] / d, insetsPx[1] / d, insetsPx[2] / d, insetsPx[3] / d);
        web.evaluateJavascript(js, null);
    }

    // ---------------------------------------------------------------- WebView

    private void createGameView() {
        web = new WebView(this);
        web.setBackgroundColor(BACKGROUND);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
        // A long press on the play surface must not start text selection or a context menu.
        web.setLongClickable(false);
        web.setOnLongClickListener(v -> true);
        web.setHapticFeedbackEnabled(false);
        root.addView(web, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setGeolocationEnabled(false);
        // The HUD is laid out in CSS pixels around the canvas; system font scaling would break it.
        settings.setTextZoom(100);

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
            .setDomain(HOST)
            .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
            .build();

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (!isLocalAsset(url)) return blocked(403, "Forbidden");
                WebResourceResponse response = loader.shouldInterceptRequest(url);
                // A missing asset must never fall through to a real network request.
                return response != null ? response : blocked(404, "Not Found");
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // Stay on the local game; never open external links or other schemes.
                return !isLocalAsset(request.getUrl());
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                sendInsets();
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                Log.w(TAG, "WebView renderer gone (crash=" + detail.didCrash() + ")");
                showRecoveryView(view);
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage message) {
                Log.println(message.messageLevel() == ConsoleMessage.MessageLevel.ERROR ? Log.ERROR : Log.DEBUG,
                    TAG, message.message() + " (" + message.sourceId() + ":" + message.lineNumber() + ")");
                return true;
            }
        });

        web.loadUrl(ENTRY);
    }

    /** Replaces a dead WebView with a tap-to-restart message; tapping starts a fresh game page. */
    private void showRecoveryView(WebView dead) {
        ViewGroup parent = (ViewGroup) dead.getParent();
        if (parent != null) parent.removeView(dead);
        dead.destroy();
        if (web == dead) web = null;

        TextView recovery = new TextView(this);
        recovery.setText(R.string.renderer_gone);
        recovery.setTextColor(Color.WHITE);
        recovery.setTextSize(18);
        recovery.setGravity(Gravity.CENTER);
        int pad = Math.round(24 * getResources().getDisplayMetrics().density);
        recovery.setPadding(pad, pad, pad, pad);
        recovery.setOnClickListener(v -> {
            root.removeView(recovery);
            createGameView();
        });
        root.addView(recovery, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private static boolean isLocalAsset(Uri uri) {
        String path = uri.getPath();
        return "https".equals(uri.getScheme())
            && HOST.equals(uri.getHost())
            && (uri.getPort() == -1 || uri.getPort() == 443)
            && uri.getUserInfo() == null
            && path != null
            && path.startsWith("/assets/");
    }

    private static WebResourceResponse blocked(int status, String reason) {
        byte[] content = reason.getBytes(StandardCharsets.UTF_8);
        return new WebResourceResponse("text/plain", "UTF-8", status, reason,
            Collections.emptyMap(), new ByteArrayInputStream(content));
    }

    // ---------------------------------------------------------------- Back

    /** API 33+ predictive-back dispatcher, isolated so API 26-32 never load these classes. */
    @TargetApi(33)
    private static final class BackApi33 {
        static Object register(Activity activity, Runnable onBack) {
            OnBackInvokedCallback callback = onBack::run;
            activity.getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                OnBackInvokedDispatcher.PRIORITY_DEFAULT, callback);
            return callback;
        }

        static void unregister(Activity activity, Object callback) {
            activity.getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(
                (OnBackInvokedCallback) callback);
        }
    }

    /** API 26-32 (on 33+ the OnBackInvokedCallback above receives Back instead). */
    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        handleBack();
    }

    /**
     * Back asks the game first: a running race pauses (onBack() returns 'paused') and the app stays
     * open; only 'exit' (or no game page to ask) closes the activity.
     */
    private void handleBack() {
        if (web == null) {           // renderer gone: recovery view is showing
            finish();
            return;
        }
        web.evaluateJavascript(JS_BACK, value -> {
            // evaluateJavascript yields JSON: "\"exit\"" / "\"paused\"", or null/"null" if the script could not run.
            if (value == null || "null".equals(value) || "\"exit\"".equals(value)) {
                finish();
            }
        });
    }

    // ---------------------------------------------------------------- lifecycle

    @Override
    protected void onPause() {
        if (web != null) {
            // Sent before pauseTimers(); script execution is not blocked by paused WebView timers.
            web.evaluateJavascript(JS_PAUSE, null);
            web.onPause();
            web.pauseTimers();
        }
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) {
            web.resumeTimers();
            web.onResume();
        }
        enterImmersive();
        // Deliberately no WishweaveGame.resume(): the race stays paused until the player taps Resume.
    }

    @Override
    protected void onDestroy() {
        if (Build.VERSION.SDK_INT >= 33 && backCallback != null) {
            BackApi33.unregister(this, backCallback);
            backCallback = null;
        }
        if (web != null) {
            web.stopLoading();
            root.removeView(web);
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
