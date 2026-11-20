package app.volna.player;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.Manifest;
import android.app.PendingIntent;
import android.app.PictureInPictureParams;
import android.app.RemoteAction;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.IntentFilter;
import android.content.res.Configuration;
import android.graphics.drawable.Icon;
import android.util.Rational;
import java.util.ArrayList;
import android.content.ContentValues;
import android.content.pm.PackageManager;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

public class MainActivity extends Activity {
    static final String HOME = "https://asarabombom-ctrl.github.io/volna/";
    static final String HOST = "asarabombom-ctrl.github.io";
    static final int FILE_REQ = 7;
    static final int MIC_REQ = 8;
    PermissionRequest pendingPerm;
    static final String PIP_ACTION = "app.volna.player.PIP";
    boolean playing = false;
    BroadcastReceiver pipRcv;

    WebView web;
    FrameLayout root;
    View fullView;
    WebChromeClient.CustomViewCallback fullCb;
    ValueCallback<Uri[]> fileCb;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#0B0812"));
        // Отступы под статус-бар и навигацию (Android 15 рисует до краёв)
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            if (fullView == null && !inPip()) {
                if (android.os.Build.VERSION.SDK_INT >= 30) {
                    android.graphics.Insets i = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime());
                    v.setPadding(i.left, i.top, i.right, i.bottom);
                } else {
                    v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                            insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
                }
            } else {
                v.setPadding(0, 0, 0, 0);
            }
            return insets;
        });

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#0B0812"));
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setUserAgentString(s.getUserAgentString() + " VolnaApp/" + appVersion());

        web.addJavascriptInterface(new Bridge(), "VolnaAndroid");

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(web, true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (!req.isForMainFrame()) return false;
                if (HOST.equals(u.getHost())) return false;
                openOutside(u);
                return true;
            }

            @Override
            public void onReceivedError(WebView v, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) showOffline();
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onShowCustomView(View view, CustomViewCallback cb) {
                if (fullView != null) { cb.onCustomViewHidden(); return; }
                fullView = view;
                fullCb = cb;
                root.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
                web.setVisibility(View.GONE);
                root.setPadding(0, 0, 0, 0);
                getWindow().getDecorView().setSystemUiVisibility(
                        View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
            }

            @Override
            public void onHideCustomView() { exitFull(); }

            // Микрофон для записи каверов: только для нашего сайта
            @Override
            public void onPermissionRequest(PermissionRequest req) {
                runOnUiThread(() -> {
                    Uri o = req.getOrigin();
                    boolean ours = o != null && HOST.equals(o.getHost());
                    boolean audio = false;
                    for (String r : req.getResources()) if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) audio = true;
                    if (!ours || !audio) { req.deny(); return; }
                    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                        req.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                    } else {
                        pendingPerm = req;
                        requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, MIC_REQ);
                    }
                });
            }

            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (fileCb != null) fileCb.onReceiveValue(null);
                fileCb = cb;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("audio/*");
                i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, p.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                try {
                    startActivityForResult(Intent.createChooser(i, "Выбери музыку"), FILE_REQ);
                } catch (ActivityNotFoundException e) {
                    fileCb = null;
                    return false;
                }
                return true;
            }
        });

        // Кнопки в окне «картинка в картинке»
        pipRcv = new BroadcastReceiver() {
            @Override public void onReceive(Context c, Intent i) {
                String cmd = i.getStringExtra("cmd");
                if (cmd != null) web.evaluateJavascript("window.volnaCmd&&volnaCmd('" + cmd + "')", null);
            }
        };
        IntentFilter f = new IntentFilter(PIP_ACTION);
        if (android.os.Build.VERSION.SDK_INT >= 33) registerReceiver(pipRcv, f, Context.RECEIVER_NOT_EXPORTED);
        else registerReceiver(pipRcv, f);

        if (state != null) web.restoreState(state);
        else web.loadUrl(HOME);
    }

    String appVersion() {
        try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; }
        catch (Exception e) { return "1"; }
    }

    void exitFull() {
        if (fullView == null) return;
        root.removeView(fullView);
        fullView = null;
        if (fullCb != null) fullCb.onCustomViewHidden();
        fullCb = null;
        web.setVisibility(View.VISIBLE);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
        root.requestApplyInsets();
    }

    void openOutside(Uri u) {
        try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
    }

    void showOffline() {
        String html = "<html><body style='margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#0b0812;color:#eee;font-family:sans-serif;text-align:center'>"
                + "<div style='font-size:48px'>〰️</div><h2>Нет интернета</h2><p style='opacity:.7'>Волне нужен интернет, чтобы искать и играть музыку.</p>"
                + "<button onclick=\"location.href='" + HOME + "'\" style='margin-top:12px;padding:12px 28px;border:0;border-radius:999px;background:#b67cff;color:#fff;font-size:16px'>Повторить</button>"
                + "</body></html>";
        web.loadDataWithBaseURL(HOME, html, "text/html", "utf-8", HOME);
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        if (req == FILE_REQ && fileCb != null) {
            Uri[] result = null;
            if (res == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    int n = data.getClipData().getItemCount();
                    result = new Uri[n];
                    for (int k = 0; k < n; k++) result[k] = data.getClipData().getItemAt(k).getUri();
                } else if (data.getData() != null) {
                    result = new Uri[]{data.getData()};
                }
            }
            fileCb.onReceiveValue(result);
            fileCb = null;
            return;
        }
        super.onActivityResult(req, res, data);
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] res) {
        super.onRequestPermissionsResult(code, perms, res);
        if (code == MIC_REQ && pendingPerm != null) {
            if (res.length > 0 && res[0] == PackageManager.PERMISSION_GRANTED)
                pendingPerm.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            else pendingPerm.deny();
            pendingPerm = null;
        }
    }

    PendingIntent pipIntent(String cmd, int code) {
        Intent i = new Intent(PIP_ACTION).setPackage(getPackageName()).putExtra("cmd", cmd);
        return PendingIntent.getBroadcast(this, code, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    @android.annotation.TargetApi(26)
    PictureInPictureParams pipParams() {
        ArrayList<RemoteAction> acts = new ArrayList<>();
        acts.add(new RemoteAction(Icon.createWithResource(this, android.R.drawable.ic_media_previous), "Назад", "Назад", pipIntent("prev", 1)));
        acts.add(new RemoteAction(Icon.createWithResource(this, playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play),
                playing ? "Пауза" : "Играть", playing ? "Пауза" : "Играть", pipIntent("toggle", 2)));
        acts.add(new RemoteAction(Icon.createWithResource(this, android.R.drawable.ic_media_next), "Дальше", "Дальше", pipIntent("next", 3)));
        PictureInPictureParams.Builder b = new PictureInPictureParams.Builder().setAspectRatio(new Rational(16, 9)).setActions(acts);
        if (android.os.Build.VERSION.SDK_INT >= 31) b.setAutoEnterEnabled(playing).setSeamlessResizeEnabled(false);
        return b.build();
    }

    void updatePip() {
        if (android.os.Build.VERSION.SDK_INT < 26) return;
        try { setPictureInPictureParams(pipParams()); } catch (Exception ignored) { }
    }

    // Свернули приложение во время музыки — уменьшаем в окошко поверх других приложений
    @Override
    protected void onUserLeaveHint() {
        super.onUserLeaveHint();
        if (playing && fullView == null && android.os.Build.VERSION.SDK_INT >= 26 && android.os.Build.VERSION.SDK_INT < 31) {
            try { enterPictureInPictureMode(pipParams()); } catch (Exception ignored) { }
        }
    }

    @Override
    public void onPictureInPictureModeChanged(boolean inPip, Configuration cfg) {
        super.onPictureInPictureModeChanged(inPip, cfg);
        web.evaluateJavascript("window.volnaPip&&volnaPip(" + inPip + ")", null);
        root.setPadding(0, 0, 0, 0);
        if (!inPip) root.requestApplyInsets();
    }

    // Сохранение записи из сайта в «Загрузки»
    class Bridge {
        @JavascriptInterface
        public void setPlaying(boolean p) {
            runOnUiThread(() -> { playing = p; updatePip(); });
        }

        @JavascriptInterface
        public boolean saveFile(String name, String mime, String b64) {
            try {
                byte[] data = Base64.decode(b64, Base64.DEFAULT);
                String safe = name.replaceAll("[\\\\/:*?\"<>|]", " ");
                if (android.os.Build.VERSION.SDK_INT >= 29) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.Downloads.DISPLAY_NAME, safe);
                    v.put(MediaStore.Downloads.MIME_TYPE, mime);
                    v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Volna");
                    Uri u = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                    if (u == null) return false;
                    try (OutputStream os = getContentResolver().openOutputStream(u)) { os.write(data); }
                } else {
                    File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                    if (dir == null) return false;
                    try (FileOutputStream os = new FileOutputStream(new File(dir, safe))) { os.write(data); }
                }
                return true;
            } catch (Exception e) {
                return false;
            }
        }
    }

    @Override
    public void onBackPressed() {
        if (fullView != null) { exitFull(); return; }
        if (web.canGoBack()) { web.goBack(); return; }
        moveTaskToBack(true);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    boolean inPip() {
        return android.os.Build.VERSION.SDK_INT >= 24 && isInPictureInPictureMode();
    }

    @Override
    protected void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();
        if (!inPip()) web.onPause();
    }

    @Override
    protected void onStop() {
        super.onStop();
        // Окно «картинка в картинке» закрыли (или выключили экран) — ставим на паузу
        if (!inPip()) {
            web.evaluateJavascript("window.volnaCmd&&volnaCmd('pause')", null);
            web.onPause();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onDestroy() {
        try { unregisterReceiver(pipRcv); } catch (Exception ignored) { }
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
