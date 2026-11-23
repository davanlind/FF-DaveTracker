package au.ff.tracker

import android.annotation.SuppressLint
import android.content.ContentValues
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.view.View
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.LinearLayout
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewAssetLoader

/**
 * The whole Android app: one screen showing the F&F Tracker web app.
 *
 * The web files (index.html, js/, css/) are copied into the APK at build time and served
 * from https://appassets.androidplatform.net/www/, so the app works offline and saves to
 * the same Google Sheet as the website.
 *
 * The page can call `window.FFAndroid` (see [Bridge]) for things a WebView can't do itself.
 */
class MainActivity : ComponentActivity() {

    private lateinit var webView: WebView
    private var fileCallback: ValueCallback<Array<Uri>>? = null

    // "Restore backup" in Settings opens the phone's file picker through this.
    private val pickFile = registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        fileCallback?.onReceiveValue(if (uri != null) arrayOf(uri) else null)
        fileCallback = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Coloured strips behind the status bar (top) and gesture bar (bottom),
        // so the app's own header and tab bar never sit underneath them.
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val topStrip = View(this).apply { setBackgroundColor(Color.parseColor("#24302A")) }
        val bottomStrip = View(this).apply { setBackgroundColor(Color.WHITE) }
        webView = WebView(this)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F5F2EC"))
            addView(topStrip, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0))
            addView(webView, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
            addView(bottomStrip, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0))
        }
        setContentView(root)

        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime())
            topStrip.layoutParams = topStrip.layoutParams.apply { height = bars.top }
            bottomStrip.layoutParams = bottomStrip.layoutParams.apply { height = maxOf(bars.bottom, keyboard.bottom) }
            view.setPadding(bars.left, 0, bars.right, 0)
            WindowInsetsCompat.CONSUMED
        }
        WindowInsetsControllerCompat(window, root).apply {
            isAppearanceLightStatusBars = false // white icons on the dark header
            isAppearanceLightNavigationBars = true
        }

        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true // the tracker saves data in localStorage
            allowFileAccess = false
            allowContentAccess = false
        }
        webView.addJavascriptInterface(Bridge(), "FFAndroid")

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                assetLoader.shouldInterceptRequest(request.url)

            // Links to other websites (setup guide, GitHub) open in the phone's browser.
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.url.host == APP_HOST) return false
                openInBrowser(request.url)
                return true
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                view: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams,
            ): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                return try {
                    pickFile.launch("*/*")
                    true
                } catch (e: Exception) {
                    fileCallback = null
                    false
                }
            }
        }

        // Back button: close a pop-up if one is open, otherwise go to the previous screen, otherwise leave.
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                webView.evaluateJavascript("(window.FF && FF.app && FF.app.back) ? FF.app.back() : false") { result ->
                    when {
                        result == "true" -> Unit
                        webView.canGoBack() -> webView.goBack()
                        else -> finish()
                    }
                }
            }
        })

        if (savedInstanceState == null) {
            webView.loadUrl("https://$APP_HOST/www/index.html")
        } else {
            webView.restoreState(savedInstanceState)
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }

    private fun openInBrowser(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        } catch (e: Exception) {
            Toast.makeText(this, "Couldn't open $uri", Toast.LENGTH_SHORT).show()
        }
    }

    /** Things the web page can ask the app to do. Called from JavaScript as FFAndroid.xxx(). */
    inner class Bridge {
        @JavascriptInterface
        fun appVersion(): String =
            packageManager.getPackageInfo(packageName, 0).versionName ?: ""

        /** Save a CSV or backup file into Downloads/FF Tracker. Returns true if it worked. */
        @JavascriptInterface
        fun saveFile(fileName: String, mimeType: String, text: String): Boolean {
            return try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    val values = ContentValues().apply {
                        put(MediaStore.Downloads.DISPLAY_NAME, fileName)
                        put(MediaStore.Downloads.MIME_TYPE, mimeType)
                        put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/FF Tracker")
                    }
                    val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                        ?: throw IllegalStateException("No Downloads folder")
                    contentResolver.openOutputStream(uri)!!.use { it.write(text.toByteArray(Charsets.UTF_8)) }
                    runOnUiThread {
                        Toast.makeText(this@MainActivity, "Saved to Downloads › FF Tracker › $fileName", Toast.LENGTH_LONG).show()
                    }
                } else {
                    // Older Android: hand the text to the share sheet (email it, save to Drive…)
                    val share = Intent(Intent.ACTION_SEND).apply {
                        type = "text/plain"
                        putExtra(Intent.EXTRA_SUBJECT, fileName)
                        putExtra(Intent.EXTRA_TEXT, text)
                    }
                    runOnUiThread { startActivity(Intent.createChooser(share, fileName)) }
                }
                true
            } catch (e: Exception) {
                runOnUiThread {
                    Toast.makeText(this@MainActivity, "Couldn't save the file: ${e.message}", Toast.LENGTH_LONG).show()
                }
                false
            }
        }
    }

    companion object {
        const val APP_HOST = "appassets.androidplatform.net"
    }
}
