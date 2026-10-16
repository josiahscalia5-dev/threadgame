package com.wishweave.completevisualkit;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;

import androidx.webkit.WebViewAssetLoader;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;

/** Offline art and camera viewer. Gameplay and payments belong to the next build. */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String ENTRY = "https://" + HOST + "/assets/scene/index.html";
    private static final int BACKGROUND = Color.rgb(41, 27, 45);
    private WebView web;
    private FrameLayout root;

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        root = new FrameLayout(this);
        root.setBackgroundColor(BACKGROUND);
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
        setContentView(root);
        // The WebView viewport itself excludes navigation/status bars and cutouts.
        // The HTML then fits the full approved portrait composition inside that area.
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                Insets safe = insets.getInsets(
                    WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
            } else {
                int left = insets.getSystemWindowInsetLeft();
                int top = insets.getSystemWindowInsetTop();
                int right = insets.getSystemWindowInsetRight();
                int bottom = insets.getSystemWindowInsetBottom();
                if (Build.VERSION.SDK_INT >= 28 && insets.getDisplayCutout() != null) {
                    left = Math.max(left, insets.getDisplayCutout().getSafeInsetLeft());
                    top = Math.max(top, insets.getDisplayCutout().getSafeInsetTop());
                    right = Math.max(right, insets.getDisplayCutout().getSafeInsetRight());
                    bottom = Math.max(bottom, insets.getDisplayCutout().getSafeInsetBottom());
                }
                view.setPadding(left, top, right, bottom);
            }
            return insets;
        });
        root.requestApplyInsets();
        createViewer();
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::finish);
        }
    }

    private void createViewer() {
        web = new WebView(this);
        web.setBackgroundColor(BACKGROUND);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
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
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
            .build();
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(
                    WebView view, WebResourceRequest request) {
                if (!isLocalAsset(request.getUrl())) return blocked(403, "Forbidden");
                WebResourceResponse response = loader.shouldInterceptRequest(request.getUrl());
                // Missing assets must not fall back to an external network request.
                return response != null ? response : blocked(404, "Not Found");
            }

            @Override public boolean shouldOverrideUrlLoading(
                    WebView view, WebResourceRequest request) {
                return !isLocalAsset(request.getUrl());
            }

            @Override public boolean onRenderProcessGone(
                    WebView view, RenderProcessGoneDetail detail) {
                ((ViewGroup) view.getParent()).removeView(view);
                view.destroy();
                if (web == view) web = null;
                TextView recovery = new TextView(MainActivity.this);
                recovery.setText("The visual preview closed. Tap to reopen it.");
                recovery.setTextColor(Color.WHITE);
                recovery.setTextSize(18);
                recovery.setGravity(android.view.Gravity.CENTER);
                recovery.setPadding(24, 24, 24, 24);
                root.addView(recovery, new FrameLayout.LayoutParams(-1, -1));
                recovery.setOnClickListener(v -> {
                    root.removeView(recovery);
                    createViewer();
                });
                return true;
            }
        });
        web.loadUrl(ENTRY);
    }

    private static boolean isLocalAsset(Uri uri) {
        return "https".equals(uri.getScheme())
            && HOST.equals(uri.getHost())
            && (uri.getPort() == -1 || uri.getPort() == 443)
            && uri.getUserInfo() == null
            && uri.getPath() != null
            && uri.getPath().startsWith("/assets/");
    }

    private static WebResourceResponse blocked(int status, String reason) {
        byte[] content = reason.getBytes(StandardCharsets.UTF_8);
        return new WebResourceResponse("text/plain", "UTF-8", status, reason,
            Collections.emptyMap(), new ByteArrayInputStream(content));
    }

    private void pauseViewer() {
        if (web != null) {
            web.evaluateJavascript(
                "if(window.WishweaveVisual && typeof window.WishweaveVisual.pause==='function'){window.WishweaveVisual.pause();}",
                null);
        }
    }

    @Override protected void onPause() {
        pauseViewer();
        if (web != null) { web.onPause(); web.pauseTimers(); }
        super.onPause();
    }

    @Override protected void onResume() {
        super.onResume();
        if (web != null) { web.resumeTimers(); web.onResume(); }
        // Autoplay remains paused until the user chooses it again.
    }

    @Override public void onBackPressed() { finish(); }

    @Override protected void onDestroy() {
        if (web != null) {
            web.stopLoading();
            root.removeView(web);
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
