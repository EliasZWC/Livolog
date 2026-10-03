package com.eliaszwc.livolog

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.webkit.RenderProcessGoneDetail
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.addCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.pm.PackageInfoCompat
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.roundToInt

/**
 * Livolog 的网页套壳容器。
 *
 * 网页资源位于 `assets/www/`，通过 [WebViewAssetLoader] 以 https 源
 * `https://appassets.androidplatform.net/assets/www/` 提供，这样 localStorage
 * 等 Web API 可以正常工作（直接用 `file://` 会有诸多限制）。
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView

    /**
     * 布局根视图。必须存成字段，并且**不能叫 rootView**：
     * - 在 `with(webView) { ... }` 作用域里写 `findViewById(...)` 会被解析成
     *   `webView.findViewById(...)`，从 WebView 往下找是找不到父级的根视图的；
     * - `View` 有 `getRootView()`，Kotlin 会暴露成合成属性 `rootView`，同名字段会被遮蔽。
     */
    private lateinit var layoutRoot: View

    /**
     * 应用内主题设置：`light` / `dark` / `system`。
     * 与网页端 localStorage 里的 `livolog.theme` 保持同步，
     * 网页改设置时通过 [WebAppBridge.setThemeMode] 通知过来。
     */
    private var themeMode: String = THEME_SYSTEM

    /** 页面加载完成前不往网页里注入脚本 */
    private var pageReady = false

    /** 上一次发起入口页加载的时刻（用 elapsedRealtime，不受系统时间改动影响） */
    private var lastLoadAt = 0L

    /**
     * 网页当前**有没有需要返回键关掉的层**（底部表单 / 下拉菜单 / 图标选择器 / 多选栏）。
     *
     * ⚠️ 为什么要缓存这个布尔值，而不是每次评估一段 JS 拿结果：
     *    `evaluateJavascript` 是异步的，而返回键的处理必须**同步**决定「消化掉还是退出」。
     *    所以由网页在每次开/关层时主动把状态推过来（见 [WebAppBridge.setBackLayer]），
     *    原生只读这个缓存值。
     * ⚠️ 初始为 false：页面刚加载时没有任何层，此时返回键应该按历史 / 退出处理。
     */
    private var webHasBackLayer = false

    /**
     * 网页的启动动画还在演（或还没结束）时为 true。
     * 这段时间窗口底色与系统栏图标一律按「品牌黑」处理，等网页通知再切回主题色，
     * 否则白天主题下会在黑色启动页上面看到一排深色状态栏图标。
     */
    private var splashActive = true

    /** 网页里 <input type="file"> 点开后，等系统选择器返回时要用 */
    private var filePathCallback: ValueCallback<Array<Uri>>? = null

    /**
     * 本次进程是否已经把磁盘上的 CSV 载入过网页。
     * ⚠️ 只有「载入还没完成」时才重试：从后台回到前台时再读盘会拿旧内容覆盖
     * 网页里正在编辑的新数据（极端情况下会把用户刚加的记录抹掉）。
     */
    private var csvLoaded = false

    /** 设置页「导出数据」：等系统「另存为」返回时要把这份 CSV 写进用户选的位置 */
    private var pendingExportCsv: String? = null
    /** 待导出的数据种类：`"metrics"` 跟踪数据，其余当时间记录 */
    private var pendingExportKind: String = EXPORT_KIND_RECORDS

    /**
     * 网页最近一次交过来的 CSV。
     * 换存储文件夹时如果新文件夹里还没有数据库，就把这份搬过去。
     */
    private var latestRecordsCsv = ""
    private var latestMetricsCsv = ""

    /** 本次进入前台是否已经查过更新（GitHub API 有频次限制，不重复查） */
    private var updateChecked = false
    /** 更新弹窗还开着就不重置上面的标志，否则从安装器回来会又弹一次 */
    private var updateFlowActive = false
    /** 已发现的新版本 */
    private var pendingRelease: Updater.Release? = null
    /** 已下载好、可以安装的安装包 */
    private var downloadedApk: File? = null
    /** 正在下载，避免重复触发 */
    private var downloading = false

    private val openDocument =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val callback = filePathCallback
            filePathCallback = null
            if (callback == null) {
                return@registerForActivityResult
            }
            val uri = if (result.resultCode == RESULT_OK) result.data?.data else null
            callback.onReceiveValue(if (uri != null) arrayOf(uri) else null)
        }

    /** 用系统「另存为」把数据导出成 CSV，用户取消就当什么都没发生 */
    private val createCsvDocument =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val csv = pendingExportCsv
            pendingExportCsv = null
            pendingExportKind = EXPORT_KIND_RECORDS
            val uri = if (result.resultCode == RESULT_OK) result.data?.data else null

            if (csv == null) {
                return@registerForActivityResult
            }
            if (uri == null) {
                // 用户主动取消，不弹提示
                notifyExported(true, "")
                return@registerForActivityResult
            }
            writeExport(uri, csv)
        }

    /** 用系统文件夹选择器换掉数据存储位置（SAF，可持久授权） */
    private val pickStorageTree =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val data = result.data
            val uri = if (result.resultCode == RESULT_OK) data?.data else null
            if (uri == null) {
                // 用户取消，什么都不动
                return@registerForActivityResult
            }

            // 不申请持久权限的话重启后就读不到了
            try {
                val flags = (data?.flags ?: 0) and
                    (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
                contentResolver.takePersistableUriPermission(uri, flags)
            } catch (t: Throwable) {
                Log.w(TAG, "持久化文件夹授权失败", t)
            }

            applyStorageTree(uri)
        }

    private val assetLoader: WebViewAssetLoader by lazy {
        WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        // 接管系统启动页：主题里指定的纯黑底 + 全透明图标会在第一帧后自动退场，
        // 紧接着交给网页里的启动动画。必须在 super.onCreate 之前调用。
        installSplashScreen()
        super.onCreate(savedInstanceState)

        // 网页一直没就绪的话不能无限黑屏，兜一个上限
        window.decorView.postDelayed({
            if (splashActive) finishSplash()
        }, SPLASH_TIMEOUT_MS)

        CrashLog.install(this)

        // 上次启动崩过就把堆栈直接显示出来，没 adb 也能定位
        CrashLog.readAndClear(this)?.let { trace ->
            showDiagnostics(getString(R.string.diagnostics_last_crash), trace)
            return
        }

        try {
            startApp()
        } catch (t: Throwable) {
            Log.e(TAG, "启动失败", t)
            showDiagnostics(
                getString(R.string.diagnostics_start_failed),
                Log.getStackTraceString(t),
            )
        }
    }

    private fun startApp() {
        migrateLegacyPrefs()
        themeMode = readThemeMode()

        // 全屏内容；系统栏要让开多少交给网页自己决定（targetSdk 35 起系统强制 edge-to-edge）
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.statusBarColor = Color.TRANSPARENT
        window.navigationBarColor = Color.TRANSPARENT
        applyTheme()

        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.web_view)
        configureWebView()

        // 后台久置被系统回收后重建 Activity 时，WebView 想把「旧状态」恢复回来，
        // 但渲染进程已经没了，恢复出来就是一片空白（用户看到的白屏）。
        // 我们的数据全在 CSV / localStorage 里，网页载入后自己会同步，
        // 所以这里一律重新加载入口页，不依赖 WebView 的状态恢复。
        loadEntry()

        // WebView 铺满整屏（包括状态栏与系统导航条区域），使遮罩、弹窗能盖住整屏
        layoutRoot = findViewById(R.id.root)
        ViewCompat.setOnApplyWindowInsetsListener(layoutRoot) { _, insets ->
            pushInsetsToWeb(insets)
            insets
        }

        /*
           返回键的处理顺序（v0.1.28 重写）：

           ⚠️ 以前只判断 `webView.canGoBack()`，但这是个**单页应用**：详情页之外的
              所有层（底部表单、下拉菜单、图标选择器、多选栏）都不产生历史记录，
              所以 canGoBack() 为 false → 直接 finish()，按返回键**直接退出 app**
              （用户报的 bug）。

           现在的顺序：
             1. 先问网页「有没有需要关掉的层」→ 有就让网页关掉（它自己知道顺序）
             2. 没有可关的层时，再看能不能回退浏览历史（详情页 pushState 的）
             3. 都没有才真的退出

           ⚠️ 第 1 步不能省：网页里弹窗可能正压在详情页上，此时 canGoBack() 是 true，
              若先走 goBack() 会触发 popstate、把弹窗和详情页一起关掉。
        */
        onBackPressedDispatcher.addCallback(this) { dismissWebLayerOrExit() }
    }

    /**
     * 返回键：先让网页关掉最上面那层，再考虑历史，最后才退出。
     * ⚠️ `evaluateJavascript` 是**异步**的，回调还没回来时返回键就按完了，
     *    所以这里不能把「是否退出」写成同步判断，而是：
     *    先**同步**取一次缓存状态（由网页每次开/关层时主动推送），
     *    拿不到缓存再回退到同步的 canGoBack() 判断。
     */
    private fun dismissWebLayerOrExit() {
        if (!::webView.isInitialized) {
            isEnabled = false
            onBackPressedDispatcher.onBackPressed()
            return
        }

        if (webHasBackLayer) {
            // 让网页关掉最上面那层；它会在关完后把新状态推回来
            webView.evaluateJavascript("window.LivologUI && window.LivologUI.handleBack()", null)
            return
        }

        if (webView.canGoBack()) {
            webView.goBack()
            return
        }

        isEnabled = false
        onBackPressedDispatcher.onBackPressed()
    }

    /** 加载入口页，并记下时刻（自愈逻辑靠它做节流） */
    private fun loadEntry() {
        if (!::webView.isInitialized) return
        lastLoadAt = SystemClock.elapsedRealtime()
        pageReady = false
        try {
            webView.loadUrl(WEB_ENTRY_URL)
        } catch (t: Throwable) {
            Log.w(TAG, "加载入口页失败", t)
        }
    }

    /**
     * 渲染进程被系统回收后，旧 WebView 已经彻底不可用，只能整只换掉。
     * 后台久置回来白屏就是这件事 —— 不重建的话页面永远不会再出来。
     */
    private fun rebuildWebView() {
        if (!::webView.isInitialized) return

        val parent = webView.parent as? ViewGroup
        val params = webView.layoutParams

        try {
            parent?.removeView(webView)
            webView.destroy()
        } catch (t: Throwable) {
            Log.w(TAG, "销毁旧 WebView 失败", t)
        }

        pageReady = false
        latestRecordsCsv = ""
        latestMetricsCsv = ""
        csvLoaded = false

        webView = WebView(this).apply { id = R.id.web_view }
        if (parent != null && params != null) {
            parent.addView(webView, params)
        }
        configureWebView()
        loadEntry()
    }

    /**
     * 回到前台时确认网页还活着。
     * 两种情况都会自带自愈：
     *   1. 页面压根没就绪（被丢掉 / 上次加载失败）→ 重新加载；
     *   2. 页面自称就绪，但问不动（渲染进程已经死了，WebView 只剩一层壳）→ 重新加载。
     * 加载本身有节流，不至于来回打转。
     */
    private fun recoverWebViewIfNeeded() {
        if (!::webView.isInitialized) return

        val now = SystemClock.elapsedRealtime()
        if (!pageReady) {
            if (now - lastLoadAt > RELOAD_THROTTLE_MS) {
                Log.w(TAG, "页面未就绪，重新加载")
                loadEntry()
            }
            return
        }

        var answered = false
        val handler = Handler(Looper.getMainLooper())
        val timeout = Runnable {
            if (!answered) {
                Log.w(TAG, "页面没有响应探活，重新加载")
                loadEntry()
            }
        }
        handler.postDelayed(timeout, LIVENESS_TIMEOUT_MS)

        try {
            webView.evaluateJavascript("window.Livolog ? \"ok\" : \"blank\"") { result ->
                answered = true
                handler.removeCallbacks(timeout)
                if (result == null || result.contains("blank")) {
                    Log.w(TAG, "页面已失效（$result），重新加载")
                    loadEntry()
                }
            }
        } catch (t: Throwable) {
            answered = true
            handler.removeCallbacks(timeout)
            Log.w(TAG, "探活失败，重新加载", t)
            loadEntry()
        }
    }

    /** 出问题时用最简单的控件把信息显示出来，而不是直接闪退 */
    private fun showDiagnostics(title: String, body: String) {
        val content = TextView(this).apply {
            text = title + "\n\n" + body
            textSize = 11f
            typeface = Typeface.MONOSPACE
            setTextIsSelectable(true)
            setTextColor(Color.BLACK)
            setBackgroundColor(Color.WHITE)
            setPadding(40, 80, 40, 40)
        }
        setContentView(ScrollView(this).apply { addView(content) })
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView() = with(webView) {
        setBackgroundColor(Color.TRANSPARENT)
        isLongClickable = false
        setOnLongClickListener { true }
        addJavascriptInterface(
            WebAppBridge(
                onThemeMode = { mode -> runOnUiThread { setThemeMode(mode) } },
                onSaveCsv = { csv -> handleSaveCsv(csv) },
                onSaveMetricsCsv = { csv -> handleSaveMetricsCsv(csv) },
                onExportCsv = { csv, kind -> runOnUiThread { handleExportCsv(csv, kind) } },
                onPickStorageFolder = { runOnUiThread { openStoragePicker() } },
                onResetStorageFolder = { runOnUiThread { resetStorageLocation() } },
                onOpenExternal = { url -> runOnUiThread { openExternally(url) } },
                onDownloadUpdate = { runOnUiThread { startUpdateDownload() } },
                onInstallUpdate = { runOnUiThread { installDownloaded() } },
                onCloseUpdate = { runOnUiThread { closeUpdateFlow() } },
                onFinishSplash = { runOnUiThread { finishSplash() } },
                // 返回键要同步判断，所以把这个状态缓存下来（见 dismissWebLayerOrExit）
                onBackLayerChanged = { has -> runOnUiThread { webHasBackLayer = has } },
            ),
            JS_BRIDGE_NAME,
        )

        settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            // 只加载应用内置资源，关闭本地文件与内容提供器访问
            allowFileAccess = false
            allowContentAccess = false
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            mediaPlaybackRequiresUserGesture = true
            textZoom = 100
            cacheMode = android.webkit.WebSettings.LOAD_DEFAULT
        }

        webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest,
            ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest,
            ): Boolean {
                val url = request.url
                // 站内（appassets 域名）导航留在 WebView 内
                if (url.host == APP_ASSETS_HOST) return false
                return openExternally(url.toString())
            }

            override fun onPageFinished(view: WebView, url: String?) {
                pageReady = true
                // 页面脚本就绪后把版本号、CSV 内容与内边距补发一次
                pushVersionToWeb()
                pushCsvToWeb()
                if (::layoutRoot.isInitialized) {
                    ViewCompat.requestApplyInsets(layoutRoot)
                }
                // 首次进入时 onResume 可能比页面更早就跑完了，这里补一次
                maybeCheckUpdate()
            }

            override fun onRenderProcessGone(
                view: WebView,
                detail: RenderProcessGoneDetail?,
            ): Boolean {
                // 后台久置很常见：系统把 WebView 的渲染进程回收了。
                // 旧 WebView 已经不可用（继续用就是一片空白），必须整只换掉；
                // 返回 true 表示「我自己处理」，否则系统会连 app 进程一起杀掉。
                Log.w(TAG, "WebView 渲染进程退出（didCrash=${detail?.didCrash()}），重建 WebView")
                rebuildWebView()
                return true
            }
        }

        // 网页里点 <input type="file"> 时拉起系统文件选择器（用于导入 CSV）
        webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?,
            ): Boolean {
                if (filePathCallback == null || fileChooserParams == null) {
                    return false
                }

                this@MainActivity.filePathCallback?.onReceiveValue(null)
                this@MainActivity.filePathCallback = filePathCallback

                return try {
                    openDocument.launch(fileChooserParams.createIntent())
                    true
                } catch (t: Throwable) {
                    Log.w(TAG, "拉起文件选择器失败", t)
                    this@MainActivity.filePathCallback = null
                    false
                }
            }
        }
    }

    // -----------------------------------------------------------------------
    // 与网页同步
    // -----------------------------------------------------------------------

    private fun evaluateInWeb(script: String) {
        // 页面没就绪时注入没有意义，也容易出问题
        if (!pageReady || !::webView.isInitialized) return
        try {
            webView.evaluateJavascript(script, null)
        } catch (t: Throwable) {
            Log.w(TAG, "evaluateJavascript 失败", t)
        }
    }

    private fun toDp(pixels: Int): Int = (pixels / resources.displayMetrics.density).roundToInt()

    /**
     * 把系统栏与输入法尺寸按 dp 推给网页（CSS 像素即 dp）。
     * 网页用它给内容让位；键盘高度单独给，好让表单整体上移。
     */
    private fun pushInsetsToWeb(insets: WindowInsetsCompat) {
        val bars = insets.getInsets(
            WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
        )
        val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom

        evaluateInWeb(
            "window.LivologShell && window.LivologShell.setInsets(" +
                "${toDp(bars.top)}, ${toDp(bars.right)}, ${toDp(bars.bottom)}, " +
                "${toDp(bars.left)}, ${toDp(keyboard)});"
        )
    }

    /** 版本号只在 build.gradle.kts 里维护，这里读系统的值传给网页显示 */
    private fun pushVersionToWeb() {
        val info: PackageInfo = try {
            packageManager.getPackageInfo(packageName, 0)
        } catch (_: Exception) {
            return
        }

        val name = info.versionName ?: return
        val code = PackageInfoCompat.getLongVersionCode(info)
        evaluateInWeb("window.LivologShell && window.LivologShell.setVersion(\"$name\", $code);")
    }

    /**
     * 把 Livolog 目录里的 CSV 内容与路径推给网页（文件不存在时内容为空串）。
     * 只在本次进程还没载入过时才会真读盘。
     */
    private fun pushCsvToWeb() {
        if (csvLoaded) return

        val context = applicationContext
        Thread {
            val records = CsvStore.read(context, CsvStore.FILE_RECORDS)
            val metrics = CsvStore.read(context, CsvStore.FILE_METRICS)
            val path = CsvStore.describe(context)

            // 记下来，换存储位置时要用
            latestRecordsCsv = records ?: ""
            latestMetricsCsv = metrics ?: ""

            runOnUiThread {
                csvLoaded = true
                evaluateInWeb(
                    "window.LivologShell && window.LivologShell.onStorageReady(" +
                        "${JSONObject.quote(records ?: "")}, ${JSONObject.quote(path)});"
                )
                evaluateInWeb(
                    "window.LivologShell && window.LivologShell.onMetricsReady(" +
                        "${JSONObject.quote(metrics ?: "")});"
                )
            }
        }.start()
    }

    /** 网页把最新的 CSV 交过来落盘，成功与否回推给网页 */
    private fun handleSaveCsv(csv: String) {
        latestRecordsCsv = csv
        val context = applicationContext
        Thread {
            var ok = false
            var detail = "unknown error"
            try {
                detail = CsvStore.write(context, csv, CsvStore.FILE_RECORDS)
                ok = true
            } catch (t: Throwable) {
                Log.w(TAG, "写 CSV 失败", t)
                detail = t.message ?: "unknown error"
            }
            runOnUiThread {
                evaluateInWeb(
                    "window.LivologShell && window.LivologShell.onCsvSaved(" +
                        "$ok, ${JSONObject.quote(detail)});"
                )
            }
        }.start()
    }

    /** 跟踪数据的 CSV（同一个目录，另一个文件） */
    private fun handleSaveMetricsCsv(csv: String) {
        latestMetricsCsv = csv
        val context = applicationContext
        Thread {
            var ok = false
            var detail = "unknown error"
            try {
                detail = CsvStore.write(context, csv, CsvStore.FILE_METRICS)
                ok = true
            } catch (t: Throwable) {
                Log.w(TAG, "写跟踪 CSV 失败", t)
                detail = t.message ?: "unknown error"
            }
            runOnUiThread {
                evaluateInWeb(
                    "window.LivologShell && window.LivologShell.onMetricsSaved(" +
                        "$ok, ${JSONObject.quote(detail)});"
                )
            }
        }.start()
    }

    // -----------------------------------------------------------------------
    // 数据存储位置
    // -----------------------------------------------------------------------

    private fun openStoragePicker() {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
            addFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION or
                    Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                    Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or
                    Intent.FLAG_GRANT_PREFIX_URI_PERMISSION,
            )
        }

        try {
            pickStorageTree.launch(intent)
        } catch (t: Throwable) {
            Log.w(TAG, "拉起文件夹选择器失败", t)
            evaluateInWeb(
                "window.LivologShell && window.LivologShell.onStoragePathChanged(" +
                    "${JSONObject.quote(CsvStore.describe(this))});"
            )
        }
    }

    /**
     * 切到用户选的文件夹：
     * - 里面已经有 records.csv → 采用那份（相当于切换数据库）
     * - 没有 → 把当前内存里的数据搬过去
     */
    private fun applyStorageTree(uri: Uri) {
        val context = applicationContext
        val recordsCsv = latestRecordsCsv
        val metricsCsv = latestMetricsCsv

        Thread {
            var adopted: String? = null
            var path = ""

            try {
                adopted = CsvStore.readFromTree(context, uri, CsvStore.FILE_RECORDS)
                CsvStore.setTree(context, uri)

                if (adopted == null) {
                    CsvStore.write(context, recordsCsv, CsvStore.FILE_RECORDS)
                    CsvStore.write(context, metricsCsv, CsvStore.FILE_METRICS)
                }
                path = CsvStore.describe(context)
            } catch (t: Throwable) {
                Log.w(TAG, "切换存储位置失败", t)
                path = CsvStore.describe(context)
            }

            val adoptedCsv = adopted
            runOnUiThread {
                if (adoptedCsv == null) {
                    // 内容没变，只报新路径，不要拿空串去覆盖现有数据
                    evaluateInWeb(
                        "window.LivologShell && window.LivologShell.onStoragePathChanged(" +
                            "${JSONObject.quote(path)});"
                    )
                } else {
                    pushCsvToWeb()
                }
            }
        }.start()
    }

    /** 恢复到默认的 Documents/Livolog */
    private fun resetStorageLocation() {
        val context = applicationContext
        val recordsCsv = latestRecordsCsv
        val metricsCsv = latestMetricsCsv

        Thread {
            var path = ""
            try {
                CsvStore.clearTree(context)
                CsvStore.write(context, recordsCsv, CsvStore.FILE_RECORDS)
                CsvStore.write(context, metricsCsv, CsvStore.FILE_METRICS)
                path = CsvStore.describe(context)
            } catch (t: Throwable) {
                Log.w(TAG, "恢复默认存储位置失败", t)
            }

            val finalPath = path
            runOnUiThread {
                evaluateInWeb(
                    "window.LivologShell && window.LivologShell.onStoragePathChanged(" +
                        "${JSONObject.quote(finalPath)});"
                )
            }
        }.start()
    }

    /** 用系统浏览器 / 其它应用打开站外链接 */
    private fun openExternally(url: String): Boolean = try {
        startActivity(Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url)))
        true
    } catch (_: ActivityNotFoundException) {
        true
    }

    // -----------------------------------------------------------------------
    // 导出数据
    // -----------------------------------------------------------------------

    /**
     * 设置页「导出数据」：弹系统「另存为」让用户选位置，文件名自动编号避免重名。
     * @param kind `"metrics"` 跟踪数据，否则时间记录；只影响文件名的前缀
     */
    private fun handleExportCsv(csv: String, kind: String) {
        pendingExportCsv = csv
        pendingExportKind = kind

        val next = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
            .getInt(KEY_EXPORT_INDEX, 0) + 1

        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = CsvStore.MIME
            putExtra(Intent.EXTRA_TITLE, nextExportName(kind, next))
        }

        try {
            createCsvDocument.launch(intent)
        } catch (t: Throwable) {
            Log.w(TAG, "拉起导出选择器失败", t)
            pendingExportCsv = null
            notifyExported(false, t.message ?: "no-picker")
        }
    }

    /** 导出文件名：livolog-001.csv / livolog-metrics-001.csv ；序号只在真的写成功之后才前进 */
    private fun nextExportName(kind: String, index: Int): String {
        val prefix = if (kind == EXPORT_KIND_METRICS) "livolog-metrics" else "livolog"
        return prefix + "-" + String.format(Locale.US, "%03d", index) + ".csv"
    }

    /** 把 CSV 写进「另存为」选中的文档 */
    private fun writeExport(uri: Uri, csv: String) {
        val resolver = applicationContext.contentResolver
        Thread {
            var ok = false
            var detail = uri.lastPathSegment ?: "csv"
            try {
                val stream = resolver.openOutputStream(uri)
                    ?: throw IllegalStateException("openOutputStream 返回 null")
                stream.use {
                    it.write(csv.toByteArray(Charsets.UTF_8))
                    it.flush()
                }
                ok = true
            } catch (t: Throwable) {
                Log.w(TAG, "导出 CSV 失败", t)
                detail = t.message ?: "unknown error"
            }
            runOnUiThread { notifyExported(ok, detail) }
        }.start()
    }

    private fun notifyExported(ok: Boolean, detail: String) {
        if (ok) {
            // 只有真的写成功才把序号往前推，取消 / 失败不会白白吃掉一个号
            val prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
            prefs.edit()
                .putInt(KEY_EXPORT_INDEX, prefs.getInt(KEY_EXPORT_INDEX, 0) + 1)
                .apply()
        }

        evaluateInWeb(
            "window.LivologShell && window.LivologShell.onExported(" +
                "$ok, ${JSONObject.quote(detail)});"
        )
    }

    // -----------------------------------------------------------------------
    // 应用内更新
    // -----------------------------------------------------------------------

    override fun onResume() {
        super.onResume()
        // 后台久置回来自愈：页面被系统丢掉时重新加载，别把白屏留给用户
        recoverWebViewIfNeeded()
        maybeCheckUpdate()
    }

    override fun onStop() {
        super.onStop()
        // 退到后台再回来算「重新进入 app」；更新流程进行中不重置，
        // 否则从系统安装器切回来会又弹一次窗。
        if (!updateFlowActive) {
            updateChecked = false
        }
    }

    /** 每次进入前台只查一次；页面还没就绪时什么都不做，等 onPageFinished 再来 */
    private fun maybeCheckUpdate() {
        if (updateChecked || updateFlowActive || !pageReady) return
        updateChecked = true

        val installedNow = Updater.installedVersionName(this)

        Updater.check(this) { release ->
            if (release == null || updateFlowActive) return@check

            pendingRelease = release
            updateFlowActive = true

            // 上一次也给你推过同一个版本，而 app 的版本号没变 ⇒ 上次的安装没生效。
            // 不说清楚的话，用户只会看到同一个弹窗反复出现。
            val prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
            val attemptedVersion = prefs.getString(KEY_PENDING_UPDATE, null)
            val attemptedFrom = prefs.getString(KEY_PENDING_UPDATE_FROM, null)
            val stalled = release.version == attemptedVersion && installedNow == attemptedFrom

            if (release.version != attemptedVersion) {
                // 已经跟当前待装版本无关了（要么装成功了，要么被更新的版本取代），清掉记录
                prefs.edit().remove(KEY_PENDING_UPDATE).remove(KEY_PENDING_UPDATE_FROM).apply()
            }

            evaluateInWeb(
                "window.LivologShell && window.LivologShell.onUpdateAvailable(" +
                    "${JSONObject.quote(release.version)}, " +
                    "${JSONObject.quote(installedNow)}, " +
                    "${JSONObject.quote(Updater.formatSize(release.size))}, " +
                    "$stalled);"
            )
        }
    }

    /** 网页点了「更新」：开始下载新版 APK */
    private fun startUpdateDownload() {
        val release = pendingRelease ?: return
        if (downloading) return
        downloading = true

        Updater.download(
            this,
            release,
            onProgress = { percent ->
                evaluateInWeb(
                    "window.LivologShell && window.LivologShell.onUpdateProgress($percent);"
                )
            },
            onDone = { file, error ->
                downloading = false
                if (file == null) {
                    updateFlowActive = false
                    notifyUpdateFailed(error ?: Updater.ERROR_NETWORK, downloaded = false)
                    return@download
                }
                downloadedApk = file
                installDownloaded()
            },
        )
    }

    /** 安装已下好的包（也可能是上次被权限拦下后的重试） */
    private fun installDownloaded() {
        val apk = downloadedApk ?: return

        val error = Updater.install(this, apk)
        if (error == null) {
            // 记下“正在尝试装到哪个版本”，下次进入前台就能判断到底装上没有
            pendingRelease?.let { release ->
                getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                    .edit()
                    .putString(KEY_PENDING_UPDATE, release.version)
                    .putString(KEY_PENDING_UPDATE_FROM, Updater.installedVersionName(this))
                    .apply()
            }
            evaluateInWeb("window.LivologShell && window.LivologShell.onUpdateReady();")
        } else {
            notifyUpdateFailed(error, downloaded = true)
        }
    }

    private fun notifyUpdateFailed(reason: String, downloaded: Boolean) {
        evaluateInWeb(
            "window.LivologShell && window.LivologShell.onUpdateFailed(" +
                "${JSONObject.quote(reason)}, $downloaded);"
        )
    }

    /** 弹窗被关掉：清干净状态，下次进入 app 可以重新检查 */
    private fun closeUpdateFlow() {
        updateFlowActive = false
        pendingRelease = null
        downloadedApk = null
    }

    // -----------------------------------------------------------------------
    // 主题
    // -----------------------------------------------------------------------

    private fun readThemeMode(): String =
        getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
            .getString(KEY_THEME_MODE, THEME_SYSTEM)
            ?.takeIf { it in THEME_MODES }
            ?: THEME_SYSTEM

    /**
     * v0.0.17：应用从 LifeLog 改名为 Livolog（包名也变了），
     * 把旧包留下的偏好整体搬到新的 SharedPreferences 里，
     * 免得主题、自选存储文件夹、更新状态这些设置白白重置。
     * 只跑一次（成功后置 [KEY_MIGRATED]）。
     */
    private fun migrateLegacyPrefs() {
        val prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
        if (prefs.getBoolean(KEY_MIGRATED, false)) return

        runCatching {
            val legacy = getSharedPreferences(LEGACY_PREFS_NAME, MODE_PRIVATE)
            val editor = prefs.edit()
            for ((key, value) in legacy.all) {
                if (key == KEY_MIGRATED) continue
                when (value) {
                    is String -> editor.putString(key, value)
                    is Boolean -> editor.putBoolean(key, value)
                    is Int -> editor.putInt(key, value)
                    is Long -> editor.putLong(key, value)
                    is Float -> editor.putFloat(key, value)
                    is Set<*> -> editor.putStringSet(key, value.filterIsInstance<String>().toSet())
                }
            }
            editor.putBoolean(KEY_MIGRATED, true).apply()
        }
    }

    private fun isDarkAppearance(): Boolean = when (themeMode) {
        THEME_LIGHT -> false
        THEME_DARK -> true
        else -> (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
            Configuration.UI_MODE_NIGHT_YES
    }

    /** 把当前主题落到窗口背景与状态栏／导航栏图标颜色上 */
    private fun applyTheme() {
        // 启动动画还在演：先维持品牌黑，免得黑色启动页上出现浅色底 + 深色图标
        if (splashActive) {
            applySplashAppearance()
            return
        }

        val dark = isDarkAppearance()
        try {
            window.setBackgroundDrawableResource(
                if (dark) R.color.app_background_dark else R.color.app_background_light
            )
            WindowInsetsControllerCompat(window, window.decorView).apply {
                isAppearanceLightStatusBars = !dark
                isAppearanceLightNavigationBars = !dark
            }
        } catch (t: Throwable) {
            // 纯外观问题，绝不能因此崩溃
            Log.w(TAG, "应用主题失败", t)
        }
    }

    /** 启动动画期间的外观：与桌面图标一样的品牌黑 + 浅色系统栏图标 */
    private fun applySplashAppearance() {
        try {
            window.setBackgroundDrawableResource(R.color.ic_launcher_background)
            WindowInsetsControllerCompat(window, window.decorView).apply {
                isAppearanceLightStatusBars = false
                isAppearanceLightNavigationBars = false
            }
        } catch (t: Throwable) {
            Log.w(TAG, "应用启动页外观失败", t)
        }
    }

    /** 网页的启动动画演完了，把外观切回正常主题 */
    private fun finishSplash() {
        if (!splashActive) return
        splashActive = false
        applyTheme()
    }

    private fun setThemeMode(mode: String) {
        val normalized = if (mode in THEME_MODES) mode else THEME_SYSTEM
        if (normalized == themeMode) return

        themeMode = normalized
        getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
            .edit()
            .putString(KEY_THEME_MODE, themeMode)
            .apply()
        applyTheme()
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        // 「跟随系统」时系统深浅色切换需要重新解析
        applyTheme()
    }

    override fun onDestroy() {
        if (::webView.isInitialized) {
            webView.destroy()
        }
        super.onDestroy()
    }

    private companion object {
        const val TAG = "Livolog"

        const val APP_ASSETS_HOST = "appassets.androidplatform.net"
        const val WEB_ENTRY_URL = "https://appassets.androidplatform.net/assets/www/index.html"

        const val JS_BRIDGE_NAME = "LivologNative"

        /** 网页一直没通知启动动画结束时的兜底时长（网页那边约 2.2s） */
        const val SPLASH_TIMEOUT_MS = 4000L

        /** 回到前台探活网页时的等待上限 */
        const val LIVENESS_TIMEOUT_MS = 2000L

        /** 两次重新加载之间的最小间隔，避免自愈逻辑来回打转 */
        const val RELOAD_THROTTLE_MS = 3000L

        const val PREFS_NAME = "livolog"
        /** v0.0.16 及之前用的偏好文件名，只用于一次性迁移 */
        const val LEGACY_PREFS_NAME = "lifelog"
        const val KEY_MIGRATED = "legacy_migrated"
        const val KEY_THEME_MODE = "theme_mode"
        /** 上次拉起安装器时装的是哪个版本、从哪个版本升 */
        const val KEY_PENDING_UPDATE = "pending_update_version"
        const val KEY_PENDING_UPDATE_FROM = "pending_update_from"
        /** 「导出数据」的文件名序号（livolog-001.csv …） */
        const val KEY_EXPORT_INDEX = "export_index"

        /** 导出时间记录（默认）：livolog-001.csv */
        const val EXPORT_KIND_RECORDS = "records"
        /** 导出跟踪数据：livolog-metrics-001.csv */
        const val EXPORT_KIND_METRICS = "metrics"

        const val THEME_LIGHT = "light"
        const val THEME_DARK = "dark"
        const val THEME_SYSTEM = "system"
        val THEME_MODES = listOf(THEME_LIGHT, THEME_DARK, THEME_SYSTEM)
    }
}
