package app.wordyarn.reader;

import android.app.Activity;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import java.io.ByteArrayInputStream;
import java.io.IOException;

public final class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String START = "https://" + HOST + "/index.html";
    private WebView page;
    private OfflineVoice voice;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        FrameLayout root = new FrameLayout(this);
        if (Build.VERSION.SDK_INT >= 30) {
            root.setOnApplyWindowInsetsListener((v, value) -> {
                android.graphics.Insets bars = value.getInsets(android.view.WindowInsets.Type.systemBars()
                    | android.view.WindowInsets.Type.displayCutout() | android.view.WindowInsets.Type.ime());
                v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return value;
            });
        }
        root.setBackgroundColor(0xfff3f6fc);
        page = new WebView(this);
        root.addView(page, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        page.getSettings().setJavaScriptEnabled(true);
        page.getSettings().setDomStorageEnabled(true);
        page.getSettings().setAllowFileAccess(false);
        page.getSettings().setAllowContentAccess(false);
        page.getSettings().setBlockNetworkLoads(false);
        page.addJavascriptInterface(new SpeechBridge(), "AndroidSpeech");
        page.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !START.equals(request.getUrl().buildUpon().fragment(null).build().toString());
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                android.net.Uri uri = request.getUrl();
                String path = uri.getEncodedPath();
                // Only the configured Azure Speech region may leave the local reader.
                String authority = uri.getEncodedAuthority();
                String method = request.getMethod();
                if ("https".equals(uri.getScheme()) && authority != null
                    && authority.matches("[a-z][a-z0-9]{0,31}\\.tts\\.speech\\.microsoft\\.com")
                    && "/cognitiveservices/v1".equals(path) && uri.getEncodedQuery() == null
                    && ("POST".equals(method) || "OPTIONS".equals(method))) return null;
                if ("https".equals(uri.getScheme()) && HOST.equals(uri.getEncodedAuthority())
                    && "GET".equals(request.getMethod()) && path != null
                    && path.matches("/(index\\.html|favicon\\.ico|data/[a-z0-9]+\\.js|assets/[a-z0-9/_.-]+)")
                    && !path.contains("..")) {
                    String mime = path.endsWith(".js") ? "application/javascript" : path.endsWith(".css") ? "text/css"
                        : path.endsWith(".svg") ? "image/svg+xml" : path.endsWith(".ico") ? "image/x-icon" : "text/html";
                    try { return new WebResourceResponse(mime, "UTF-8", getAssets().open("reader" + path)); }
                    catch (IOException ignored) {}
                }
                return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", null,
                    new ByteArrayInputStream(new byte[0]));
            }
        });
        voice = new OfflineVoice(this, this::reply);
        page.loadUrl(START);
    }

    private void reply(String id, String event) {
        if (page != null) page.evaluateJavascript("window.wordYarnSpeechEvent?.(" + id + ",'" + event + "',0,0)", null);
    }

    private final class SpeechBridge {
        @JavascriptInterface public void speak(String id, String text, float rate, float volume, int speaker) {
            if (id == null || !id.matches("[0-9]{1,12}") || text == null || text.length() > 1800
                || !Float.isFinite(rate) || !Float.isFinite(volume) || speaker < 0 || speaker >= 8) return;
            runOnUiThread(() -> { if (voice != null) voice.speak(id, text, Math.max(.5f, Math.min(2f, rate)),
                Math.max(0f, Math.min(1f, volume)), speaker); });
        }
        @JavascriptInterface public void stop() {
            runOnUiThread(() -> { if (voice != null) voice.stop(); });
        }
        @JavascriptInterface public void pause() {
            runOnUiThread(() -> { if (voice != null) voice.pause(); });
        }
        @JavascriptInterface public void resume() {
            runOnUiThread(() -> { if (voice != null) voice.resume(); });
        }
    }

    @Override public void onBackPressed() {
        if (page.canGoBack()) page.goBack(); else super.onBackPressed();
    }

    @Override protected void onDestroy() {
        if (voice != null) { voice.close(); voice = null; }
        if (page != null) {
            ((FrameLayout)page.getParent()).removeView(page);
            page.destroy();
            page = null;
        }
        super.onDestroy();
    }
}
