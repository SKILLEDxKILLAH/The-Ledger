package app.sillytavern.pocket;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Insets;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.text.method.ScrollingMovementMethod;
import android.util.Base64;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import android.window.OnBackInvokedDispatcher;

import java.io.OutputStream;

/**
 * Full-screen WebView onto the on-device SillyTavern server, with a native boot
 * screen while the server unpacks and starts.
 */
public class MainActivity extends Activity implements ServerService.Listener {
    private static final int REQ_FILE = 1;
    private static final int REQ_NOTIF = 2;

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

    private FrameLayout root;
    private WebView web;
    private View boot;
    private ProgressBar progress;
    private TextView status;
    private TextView log;
    private Button retry;
    private boolean loaded;
    private ValueCallback<Uri[]> fileCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        root = new FrameLayout(this);
        root.setBackgroundColor(getColor(R.color.st_bg));
        web = buildWebView();
        web.setVisibility(View.INVISIBLE);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        boot = buildBootScreen();
        root.addView(boot, new FrameLayout.LayoutParams(-1, -1));
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

        getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                OnBackInvokedDispatcher.PRIORITY_DEFAULT, () -> {
                    if (loaded && web.canGoBack()) web.goBack();
                    else moveTaskToBack(true); // keep the server and page alive
                });

        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIF);
        }
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
        switch (state) {
            case RUNNING:
                if (!loaded) {
                    loaded = true;
                    web.loadUrl(ServerService.ORIGIN);
                }
                break;
            case FAILED:
                showBoot(detail, -1);
                log.setText(ServerService.logTail());
                log.setVisibility(View.VISIBLE);
                retry.setVisibility(View.VISIBLE);
                loaded = false;
                break;
            case IDLE:
                break;
            default:
                showBoot(detail, pct);
                log.setVisibility(View.GONE);
                retry.setVisibility(View.GONE);
        }
    }

    private void showBoot(String text, int pct) {
        boot.setVisibility(View.VISIBLE);
        web.setVisibility(View.INVISIBLE);
        status.setText(text);
        progress.setIndeterminate(pct < 0);
        if (pct >= 0) progress.setProgress(pct);
    }

    // ---- WebView ------------------------------------------------------------------

    private WebView buildWebView() {
        WebView w = new WebView(this);
        w.setBackgroundColor(getColor(R.color.st_bg));
        w.setOverScrollMode(View.OVER_SCROLL_NEVER);
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false); // TTS playback
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setTextZoom(100);
        s.setAlgorithmicDarkeningAllowed(false); // SillyTavern has its own themes
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        WebView.setWebContentsDebuggingEnabled(
                (getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        w.addJavascriptInterface(new Bridge(), "StPocket");

        w.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if ("127.0.0.1".equals(u.getHost()) || "localhost".equals(u.getHost())) return false;
                // Everything else (docs, provider sign-ups, Discord...) opens in the browser.
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (ActivityNotFoundException ignored) {
                    // No handler for this scheme.
                }
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                view.evaluateJavascript(DOWNLOAD_HOOK, null);
                if (loaded) {
                    view.setVisibility(View.VISIBLE);
                    boot.setVisibility(View.GONE);
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
            String name = android.webkit.URLUtil.guessFileName(url, cd, mime);
            w.evaluateJavascript("(function(){var a=document.createElement('a');a.href="
                    + org.json.JSONObject.quote(url) + ";a.setAttribute('download',"
                    + org.json.JSONObject.quote(name) + ");a.click();})();", null);
        });
        return w;
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

    /** Receives exported files (character cards, chats, backups) from the page. */
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
    }

    // ---- boot screen ----------------------------------------------------------------

    private View buildBootScreen() {
        // Material You: tinted from the wallpaper palette on Pixel.
        int bg = getColor(android.R.color.system_neutral1_900);
        int fg = getColor(android.R.color.system_neutral1_50);
        int accent = getColor(android.R.color.system_accent1_200);
        float dp = getResources().getDisplayMetrics().density;

        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setBackgroundColor(bg);
        int pad = (int) (24 * dp);
        box.setPadding(pad, pad, pad, pad);

        TextView title = new TextView(this);
        title.setText(R.string.app_name);
        title.setTextColor(fg);
        title.setTextSize(28);
        title.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        title.setGravity(Gravity.CENTER);
        box.addView(title);

        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100);
        progress.setIndeterminate(true);
        progress.setProgressTintList(android.content.res.ColorStateList.valueOf(accent));
        progress.setIndeterminateTintList(android.content.res.ColorStateList.valueOf(accent));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams((int) (220 * dp), -2);
        lp.topMargin = (int) (24 * dp);
        lp.bottomMargin = (int) (16 * dp);
        box.addView(progress, lp);

        status = new TextView(this);
        status.setTextColor(fg);
        status.setAlpha(0.8f);
        status.setGravity(Gravity.CENTER);
        status.setMaxLines(6);
        box.addView(status);

        log = new TextView(this);
        log.setTextColor(fg);
        log.setTypeface(Typeface.MONOSPACE);
        log.setTextSize(11);
        log.setBackgroundColor(Color.argb(60, 0, 0, 0));
        log.setPadding(pad / 2, pad / 2, pad / 2, pad / 2);
        log.setMovementMethod(new ScrollingMovementMethod());
        log.setTextIsSelectable(true);
        log.setVisibility(View.GONE);
        LinearLayout.LayoutParams logLp = new LinearLayout.LayoutParams(-1, 0, 1f);
        logLp.topMargin = (int) (16 * dp);
        box.addView(log, logLp);

        retry = new Button(this);
        retry.setText(R.string.retry);
        retry.setVisibility(View.GONE);
        retry.setOnClickListener(v -> startServer());
        LinearLayout.LayoutParams rlp = new LinearLayout.LayoutParams(-2, -2);
        rlp.topMargin = (int) (16 * dp);
        box.addView(retry, rlp);
        return box;
    }
}
