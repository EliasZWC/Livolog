package com.eliaszwc.livolog

import android.webkit.JavascriptInterface

/**
 * 暴露给网页的接口，实例名见 `MainActivity.JS_BRIDGE_NAME`。
 *
 * 注意必须是 **public 的顶层类**：Android 的 JS 桥是用反射查找并调用
 * `@JavascriptInterface` 方法的，放在 private 内部类里在部分系统上会调用失败。
 * 回调里只做转交，避免把 Activity 的引用泄漏进 JS 层。
 */
class WebAppBridge(
    private val onThemeMode: (String) -> Unit,
    private val onSaveCsv: (String) -> Unit,
    private val onSaveMetricsCsv: (String) -> Unit,
    private val onExportCsv: (String, String) -> Unit,
    private val onPickStorageFolder: () -> Unit,
    private val onResetStorageFolder: () -> Unit,
    private val onOpenExternal: (String) -> Unit,
    private val onDownloadUpdate: () -> Unit,
    private val onInstallUpdate: () -> Unit,
    private val onCloseUpdate: () -> Unit,
    private val onFinishSplash: () -> Unit,
    private val onBackLayerChanged: (Boolean) -> Unit,
) {

    @JavascriptInterface
    fun setThemeMode(mode: String) {
        onThemeMode(mode)
    }

    /** 把全部时间记录的 CSV 内容落盘到 Livolog 目录 */
    @JavascriptInterface
    fun saveRecordsCsv(csv: String) {
        onSaveCsv(csv)
    }

    /** 把全部跟踪数据的 CSV 内容落盘（与 records.csv 同一个目录） */
    @JavascriptInterface
    fun saveMetricsCsv(csv: String) {
        onSaveMetricsCsv(csv)
    }

    /** 设置页「数据存储位置」：拉起系统文件夹选择器 */
    @JavascriptInterface
    fun pickStorageFolder() {
        onPickStorageFolder()
    }

    /** 恢复默认位置（Documents/Livolog） */
    @JavascriptInterface
    fun resetStorageFolder() {
        onResetStorageFolder()
    }

    /** 用系统应用打开外部链接（如设置页「联系」的 mailto:） */
    @JavascriptInterface
    fun openExternal(url: String) {
        onOpenExternal(url)
    }

    /**
     * 设置页「导出数据」：拉起系统「另存为」，把 CSV 写到用户选的位置。
     * @param kind `"records"` 时间记录 / `"metrics"` 跟踪数据，决定默认文件名
     */
    @JavascriptInterface
    fun exportRecordsCsv(csv: String, kind: String) {
        onExportCsv(csv, kind)
    }

    /** 更新弹窗点「更新」：开始下载新版 APK */
    @JavascriptInterface
    fun downloadUpdate() {
        onDownloadUpdate()
    }

    /** 包已下好但安装被拦下时，点「重试安装」 */
    @JavascriptInterface
    fun installUpdate() {
        onInstallUpdate()
    }

    /** 更新弹窗关掉了，原生可以重置「本次进入已检查过」的状态 */
    @JavascriptInterface
    fun closeUpdate() {
        onCloseUpdate()
    }

    /** 网页的启动动画演完了：原生可以把窗口底色与系统栏图标切回正常主题 */
    @JavascriptInterface
    fun finishSplash() {
        onFinishSplash()
    }

    /**
     * 网页里「可被返回键关掉的层」数量/存在性变了。
     *
     * ⚠️ 返回键的处理必须是**同步**的，而 `evaluateJavascript` 是异步的，
     *    所以由网页在每次开/关底部表单、下拉菜单、图标选择器、多选栏时主动推过来，
     *    原生缓存起来供 [MainActivity.dismissWebLayerOrExit] 同步读取。
     */
    @JavascriptInterface
    fun setBackLayer(has: Boolean) {
        onBackLayerChanged(has)
    }
}
