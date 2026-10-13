package app.sillytavern.pocket;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import android.window.OnBackInvokedDispatcher;

import org.json.JSONObject;

import java.io.OutputStream;

/**
 * Full-screen WebView onto the on-device SillyTavern server. While the server
 * unpacks and starts, the same WebView shows The Ledger's boot page
 * (assets/boot.html), which this activity drives through bootState().
 */
public class MainActivity extends Activity implements ServerService.Listener {
    private static final int REQ_FILE = 1;
    private static final int REQ_NOTIF = 2;
    private static final String BOOT_URL = "file:///android_asset/boot.html";

    /**
     * SillyTavern saves files by clicking an <a download> pointing at a blob: URL,
     * which Android's WebView cannot download. Intercept those and hand the bytes
     * to the native side instead.
     */
    private static final String DOWNLOAD_HOOK = "(function(){"
            + "if(window.__stPocketDl)return;window.__stPocketDl=true;"
            + "function want(a){return a&&a.hasAttribute&&a.hasAttribute('download')&&/^(blob:|data:|http:\\/\\/127\\.0\\.0\\.1)/.test(a.href);}"
            + "function save(a){var name=a.getAttribute('download')||'download';"
            + "fetch(a.href).then(function(r){return r.blob();}).then(function(b){var fr=new FileReader();"
            + "fr.onload=function(){StPocket.save(name,b.type||'application/octet-stream',String(fr.result).split(',')[1]||'');};"
            + "fr.readAsDataURL(b);}).catch(function(e){StPocket.toast('Download failed: '+e);});}"
            + "var click=HTMLAnchorElement.prototype.click;"
            + "HTMLAnchorElement.prototype.click=function(){if(want(this)){save(this);return;}return click.apply(this,arguments);};"
            + "document.addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('a');"
            + "if(want(a)){e.preventDefault();e.stopPropagation();save(a);}},true);"
            + "})();";

    private WebView web;
    /** True once the tavern itself (not the boot page) has been asked to load. */
    private boolean tavern;
    private boolean clearHistoryOnLoad;
    private ServerService.State lastState = ServerService.State.IDLE;
    private String lastDetail = "";
    private int lastPct = -1;
    private ValueCallback<Uri[]> fileCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(getColor(R.color.ledger_ground));
        web = buildWebView();
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);

        // targetSdk 35 is always edge-to-edge: pad for the status bar, the camera
        // cutout, the gesture bar and the keyboard so nothing hides behind them.
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            Insets i = insets.getInsets(WindowInsets.Type.systemBars()
                    | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
            v.setPadding(i.left, i.top, i.right, i.bottom);
            return WindowInsets.CONSUMED;
        });
        WindowInsetsController bars = getWindow().getInsetsController();
        if (bars != null) {
            bars.setSystemBarsAppearance(0, WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                    | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
        }

        // Back: the page gets first refusal (it closes the plugin explorer), then
        // WebView history, then the app goes to the background with the server alive.
        getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                OnBackInvokedDispatcher.PRIORITY_DEFAULT, () -> web.evaluateJavascript(
                        "!!(window.ledgerHandleBack&&window.ledgerHandleBack())", handled -> {
                            if ("true".equals(handled)) return;
                            if (tavern && web.canGoBack()) web.goBack();
                            else moveTaskToBack(true);
                        }));

        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIF);
        }
        web.loadUrl(BOOT_URL);
        startServer();
    }

    @Override
    protected void onStart() {
        super.onStart();
        ServerService.addListener(this);
        // Coming back after the notification's Stop: start it again.
        if (ServerService.state() == ServerService.State.IDLE) startServer();
    }

    @Override
    protected void onStop() {
        ServerService.removeListener(this);
        super.onStop();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onPause() {
        // Deliberately not pauseTimers(): a reply streaming in should keep going.
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }

    private void startServer() {
        startForegroundService(new Intent(this, ServerService.class));
    }

    @Override
    public void onState(ServerService.State state, String detail, int pct) {
        lastState = state;
        lastDetail = detail;
        lastPct = pct;
        if (state == ServerService.State.RUNNING) {
            if (!tavern) {
                tavern = true;
                clearHistoryOnLoad = true;
                pushBootState(); // "The books are open." while the tavern loads
                web.loadUrl(ServerService.ORIGIN);
            }
            return;
        }
        if (state == ServerService.State.IDLE) return;
        if (tavern) {
            // The server went away under the tavern: back to the boot page.
            tavern = false;
            web.loadUrl(BOOT_URL); // onPageFinished pushes the state
        } else {
            pushBootState();
        }
    }

    private void pushBootState() {
        String js = "window.bootState&&bootState(" + JSONObject.quote(lastState.name()) + ","
                + JSONObject.quote(lastDetail) + "," + lastPct + ","
                + JSONObject.quote(lastState == ServerService.State.FAILED ? ServerService.logTail() : "") + ")";
        web.evaluateJavascript(js, null);
    }

    // ---- WebView ------------------------------------------------------------------

    private static boolean isLocal(Uri u) {
        return "127.0.0.1".equals(u.getHost()) || "localhost".equals(u.getHost())
                || ("file".equals(u.getScheme()) && u.getPath() != null && u.getPath().startsWith("/android_asset/"));
    }

    private WebView buildWebView() {
        WebView w = new WebView(this);
        w.setBackgroundColor(getColor(R.color.ledger_ground));
        w.setOverScrollMode(View.OVER_SCROLL_NEVER);
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false); // TTS playback
        s.setAllowFileAccess(false); // android_asset (the boot page) still loads
        s.setAllowContentAccess(false);
        s.setTextZoom(100);
        s.setAlgorithmicDarkeningAllowed(false); // SillyTavern has its own themes
        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        w.addJavascriptInterface(new Bridge(), "StPocket");

        w.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                if (isLocal(req.getUrl())) return false;
                openExternal(req.getUrl());
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (url.startsWith(BOOT_URL)) {
                    pushBootState();
                    return;
                }
                view.evaluateJavascript(DOWNLOAD_HOOK, null);
                if (clearHistoryOnLoad) {
                    clearHistoryOnLoad = false;
                    view.clearHistory(); // so Back never returns to the boot page
                }
            }
        });

        w.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = cb;
                try {
                    startActivityForResult(params.createIntent(), REQ_FILE);
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });

        // Plain http downloads from the server (rare): fetch them through the same hook.
        w.setDownloadListener((url, ua, cd, mime, len) -> {
            String name = URLUtil.guessFileName(url, cd, mime);
            w.evaluateJavascript("(function(){var a=document.createElement('a');a.href="
                    + JSONObject.quote(url) + ";a.setAttribute('download',"
                    + JSONObject.quote(name) + ");a.click();})();", null);
        });
        return w;
    }

    private void openExternal(Uri u) {
        String scheme = u.getScheme();
        if (!"https".equals(scheme) && !"http".equals(scheme) && !"mailto".equals(scheme)) return;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, u));
        } catch (ActivityNotFoundException ignored) {
            // No handler for this link.
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            fileCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    /** Page-to-app calls: exported files, the boot page's retry, and external links. */
    private final class Bridge {
        @JavascriptInterface
        public void save(String name, String mime, String base64) {
            byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
            String safe = name.replaceAll("[\\\\/:*?\"<>|]", "_");
            ContentValues v = new ContentValues();
            v.put(MediaStore.Downloads.DISPLAY_NAME, safe);
            v.put(MediaStore.Downloads.MIME_TYPE, mime);
            v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/SillyTavern");
            String msg;
            try {
                Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                if (uri == null) throw new java.io.IOException("MediaStore refused the file");
                try (OutputStream os = getContentResolver().openOutputStream(uri)) {
                    os.write(bytes);
                }
                msg = "Saved to Downloads/SillyTavern/" + safe;
            } catch (Exception e) {
                msg = "Could not save " + safe + ": " + e.getMessage();
            }
            toast(msg);
        }

        @JavascriptInterface
        public void toast(String msg) {
            runOnUiThread(() -> Toast.makeText(MainActivity.this, msg, Toast.LENGTH_LONG).show());
        }

        @JavascriptInterface
        public void retry() {
            runOnUiThread(MainActivity.this::startServer);
        }

        @JavascriptInterface
        public void openExternal(String url) {
            runOnUiThread(() -> MainActivity.this.openExternal(Uri.parse(url)));
        }
    }
}
