# Livolog

记录生活行为的 Android 应用，采用「网页套壳」（原生 WebView 容器 + 内置网页前端）的方式实现。

> v0.0.17 起全名从 **LifeLog** 改为 **Livolog**（LifeLog 重名太多了）：
> 应用显示名、仓库名、包名（`com.eliaszwc.livolog`）、数据目录（`Documents/Livolog/`）全部跟着换。
> 升级时会自动把旧包名 `com.eliaszwc.lifelog` 留下的设置与 `Documents/LifeLog/` 里的数据搬过来（详见 `CHANGELOG.md`）。
> ⚠️ 因为包名变了，**要先卸载旧的 LifeLog 再装 Livolog**，否则桌面会出现两个图标。

| 项目 | 值 |
| --- | --- |
| 当前版本 | **v0.1.18** |
| 显示名 | Livolog |
| 包名 | `com.eliaszwc.livolog` |
| 最低支持 | Android 8.0（API 26） |
| 目标版本 | Android 15（API 35） |
| 仓库 | https://github.com/EliasZWC/Livolog |

## 设计约定

- **图标**：界面里全部使用谷歌官方 [Material Icons](https://fonts.google.com/icons)，不引入第三方图标集。
  行为与跟踪项共用一个图标库（`icons.js`，目前 62 个），选择器里只显示图形、不显示名字。
- **应用图标（launcher）**：黑底 `#1B1B1B` + **白 → 灰逆时针环绕渐变**的时钟（圆环 + 中心指针），
  资源在 `res/drawable/ic_launcher_foreground.xml`（自适应图标前景层，108 × 108 视口）。
  造型与几何参数见该文件顶部的注释与 `CHANGELOG.md` 的 v0.0.16 / v0.0.17 条目；
  设计过程稿与遮挡预览留在 `design/icon-sketch.html`、`design/icon-preview.html`。
- **字体**：界面统一用**更纱等宽黑体**（Sarasa Mono SC）的子集版（v0.0.17 起）。
  完整字体每个字重 24 MB，这里只保留「拉丁 + 常用标点 + 全角 + GB2312 全集 + 网页实际用到的字符」，
  转成 WOFF2 后每个字重约 1.5 MB，放在 `assets/www/fonts/`，由 `styles.css` 顶部的 `@font-face` 引入。
  带的是 **Regular + Bold** 两档（界面里 400/500 走 Regular，600/700 走 Bold —— 用 SemiBold 在 15px 下看不出「粗」）。
  没打进包里的生僻字会自动回退到系统字体。授权 SIL OFL 1.1，授权文件与字体放在同一目录。
- **主题色**：黑白，但使用不同质感的灰阶表达层次，**不使用纯黑 `#000` / 纯白 `#fff`**。
  - 白天主题：以白为主（页面背景 `#EFEFED`，导航栏 / 面板 `#FCFCFB`，文字 `#1B1B1B`）
  - 夜间主题：以黑为主（页面背景 `#1E1E1E`，导航栏 `#131313`，面板 `#242424`，文字 `#ECECEA`）
  - 导航栏与页面背景的关系固定为「导航栏更极端」：日间导航栏比背景更白，夜间导航栏比背景更黑；
    设置项这类“栏”则取 `--surface`，与 `--bg` 拉开差异以体现分区。
  - 主题色定义集中在 `app/src/main/assets/www/styles.css` 的 `:root` 与 `@media (prefers-color-scheme: dark)` 中，加壳侧的系统栏颜色在 `res/values/colors.xml` 与 `res/values-night/colors.xml`。
- **排版规则**（v0.0.19 起，`styles.css` 顶部有对应注释，改样式时照着走）：
  - 标题（`.sheet-title` 表单标题 / `.page-title` 页面标题）：**深色 + 全大写 + 粗体**，表单标题居中
  - 栏目名（`.form-label` / `.datetime-label` / `.setting-label`）：**深色 + 粗体**，保持正常大小写
  - 值（`.form-input` / `.form-select` / `.seg` / `.setting-value`）：**浅色 + 正常字重**，保持正常大小写
  - 底部按钮（`.btn`，取消 / 确定）：**全大写**
  - 时间页分组行三级字体完全一致，层级只靠左侧缩进区分
  - 中文不受 `text-transform: uppercase` 影响，所以这套规则只对英文界面产生大小写变化
- **语言**：默认英文（`en`），可在设置页「通用 → 语言」切换为中文（`zh`）。
  i18n 在 `app/src/main/assets/www/i18n.js`（`data-i18n` 属性 + `LivologI18n.t/setLocale`，
  选择存在 `localStorage`）；原生端以 `res/values/strings.xml` 作为英文默认资源。
- **主题设置**：设置页可在「日间 / 夜间 / 跟随系统」间切换。网页端通过 `<html data-theme>` 覆盖系统配色，
  原生端同步窗口背景与状态栏图标颜色，保证系统与应用内设置不一致时不露错色。

## 网页与原生通信

原生通过 `addJavascriptInterface` 向网页暴露 `LivologNative` 对象（见 `WebAppBridge`）：

| 方法 | 说明 |
| --- | --- |
| `setThemeMode(mode)` | 网页切换主题后通知原生，`mode` 为 `light` / `dark` / `system` |
| `saveRecordsCsv(csv)` | 把全部时间记录的 CSV 镜像写入 Livolog 目录 |
| `saveMetricsCsv(csv)` | 把全部跟踪数据的 CSV 镜像写入同一目录的 `metrics.csv` |
| `pickStorageFolder()` | 拉起系统文件夹选择器，换数据存储位置 |
| `resetStorageFolder()` | 恢复默认存储位置 |
| `exportRecordsCsv(csv)` | 设置页「导出数据」：拉起系统「另存为」 |
| `downloadUpdate()` | 更新弹窗点「更新」：开始下载新版 APK |
| `installUpdate()` | 安装被权限拦下后点「重试安装」 |
| `closeUpdate()` | 弹窗关掉，原生可以重置「本次进入已检查过」的状态 |

反方向（原生 → 网页）用 `evaluateJavascript` 调用 `LivologShell`：

| 方法 | 说明 |
| --- | --- |
| `setInsets(top, right, bottom, left, keyboard)` | 推送系统栏与输入法尺寸（dp），网页写进 `--safe-*` / `--keyboard` CSS 变量 |
| `setVersion(name, code)` | 推送版本名与版本号，供设置页只读显示 |
| `onStorageReady(csv, path)` | 推送 `Livolog/records.csv` 的内容与路径（文件不存在时内容为空串） |
| `onMetricsReady(csv)` | 推送 `metrics.csv` 的内容 |
| `onCsvSaved(ok, detail)` | 时间记录 CSV 落盘结果 |
| `onMetricsSaved(ok, detail)` | 跟踪数据 CSV 落盘结果 |
| `onStoragePathChanged(path)` | 只换了目录、内容未变（例如切到新文件夹后的回推） |
| `onExported(ok, detail)` | 导出结果（`detail` 为空串表示用户取消） |
| `onUpdateAvailable(version, current, size)` | 发现新版本，网页弹窗 |
| `onUpdateProgress(percent)` | 下载进度 0~100 |
| `onUpdateReady()` | 下载完成，安装器已拉起 |
| `onUpdateFailed(reason, downloaded)` | 更新失败；`reason` 为 `permission` / `network` / `install` |

**WebView 是全屏的**（包括状态栏与系统导航条区域），所以遮罩与底部弹窗能盖住整屏。
内容要让开多少由 CSS 变量决定，不依赖 `env(safe-area-inset-*)`（WebView 里的取值不可靠，只在 `:root` 里作为兜底）。

原生会把主题偏好落到 `SharedPreferences`，保证冷启动时先上对背景色，不用等网页接管。
网页侧的偏好则存在 `localStorage`，两者由这一桥接保持同步。

## 应用内更新

每次重新进入 app（`onResume`，且页面已就绪）会去查一次
`https://api.github.com/repos/EliasZWC/Livolog/releases/latest`：

- 取 `tag_name` 去掉 `v` 与本地 `versionName` 按段比较，**只认更新不回退**；
- 从 `assets[]` 里挑第一个 `.apk`，用它的 `browser_download_url` 与 `size`；
- 有新版本才推给网页弹窗，用户确认后由原生下载到 `cacheDir/update/`；
- 下完用 `FileProvider`（authority `${applicationId}.fileprovider`）以 `content://` 交给系统安装器；
- 若系统未授予「安装未知应用」（`canRequestPackageInstalls()` 为 false），
  先跳 `ACTION_MANAGE_UNKNOWN_APP_SOURCES`，回来后点「重试安装」即可，无需重下。

几个刻意的限制：

- **每次进入前台只查一次**。GitHub 未登录 API 限额是每小时 60 次；
  而拉起安装器会让 Activity 走一遍 `onStop`/`onResume`，所以弹窗还开着时不重置标志，
  否则会反复弹窗。
- 只能覆盖安装，**签名不同会装不上**；因此更新包必须是同一个发布密钥签的。
- debug 构建的 `versionName` 带 `-debug` 后缀，比较时会先截掉。

### 下载与安装的校验（v0.0.12 起）

「提示的是新版、装下去的却是旧版」是这类应用内更新最典型的坑，所以做了三层防护：

1. **安装包按版本命名**：`cacheDir/update/<version>/livolog.apk`，每次更新的
   `content://` URI 都不同 —— 固定路径会让安装器（部分定制 ROM 尤其明显）
   按 URI 复用上一次扫描/暂存过的那份包，表现就是“提示的是新版、装下去的却是旧版”。
   下载前还会把整个 `update/` 目录删掉。
2. **拉起安装器前校验包内容**：用 `PackageManager.getPackageArchiveInfo()` 解析，
   逐项检查字节数与 Release 声明一致、`versionName` 与发布标签一致、
   `versionCode` 严格大于当前已安装的。任何一项不过就直接报错，不会把错的包递进安装器。
3. **记录「上次拉起安装器时装的是哪个版本」**：下次进入前台如果再检测到同一个版本，
   而 app 自己的版本号没变，说明上次安装没生效 —— 弹窗会额外提示一句，
   而不是让同一个弹窗无声地循环出现。

对应的失败原因码：`permission` / `network` / `install` / `invalid` / `truncated` / `mismatch` / `downgrade`。

> ⚠️ 历史上出过的现象：Release 里的 APK 是正确的新版本（已用 `AndroidManifest.xml` 内的
> `versionName` 直接核对过），但手机装完仍是旧版。这种情况下要优先怀疑
> 「下载到的文件」与「递给安装器的文件」不是同一份，以及安装是否真的被系统执行完。

## 数据模型

**时间记录以 CSV 形式存放在手机的 Livolog 目录下作为数据库**，应用启动时从该文件载入，
之后任何改动都会同步写回；`localStorage` 只是一份加快启动的缓存。

落盘位置：`Documents/Livolog/records.csv`（API 29+ 走 MediaStore，无需任何权限，文件管理器可见；
部分定制系统限制 MediaStore 时会退回应用专属目录，实际路径会显示在设置页）。

CSV 表头固定为 `id,behavior,type,start,end,note`：

- `behavior` 写的是行为**名称**而不是 id，便于人读与迁移
- `start` / `end` 为本地时间 `YYYY-MM-DD HH:mm`，时点的 `end` 留空
- `note` 是选填的描述（v0.1.6 起），可能带逗号 / 引号 / 换行，按 RFC4180 转义；
  旧文件（只有 5 列）照样能读，note 列不存在就当空
- 行尾 CRLF，Excel 可直接打开

```js
Behavior = { id, name, icon }                                  // icon 为 icons.js 里的图标名
Record   = { id, behaviorId, type, start, end, note }          // type: 'period' | 'moment'；note 选填
```

- **行为是时间记录的前提**：先在行为页建立行为，才能在时间页新增记录。
- 删除行为会连带删除它名下的全部时间记录。
- 时间记录的增删改都会重写整个 CSV（个人量级足够快）。

### 跟踪数据（`metrics.csv`）

跟跟踪是与「行为 / 时间记录」完全独立的另一套数据，存在于导航栏第二个页签（Track）：

```js
Metric       = { id, name, icon, fields: [{id, name}], primary: <fieldId> }
MetricRecord = { id, metricId, time, values: [{fieldId, value}] }
```

- 跟踪项就是「被跟踪的数据」，比如体重、腰围、血压（v0.1.7 起支持多字段：血压 = 高压 / 低压 / 脉搏）。
- 跟踪记录本质上都是**时点**：只有记录时间与各字段的值，没有起止时间，
  所以它们永远不会出现在时间页，只能从跟踪详情页的悬浮按钮添加。
- CSV 是「一条记录一行」的宽表，表头为 `id,metric,time,<字段名>…`（字段名即列名），
  `metric` 同样写名称，与 `records.csv` 放在同一个目录。

### 存储位置

设置页的「数据存储位置」可以换成任意文件夹（`ACTION_OPEN_DOCUMENT_TREE`，授权会持久化）：

- 目标文件夹里已有 `records.csv` → 采用它（相当于换一个数据库）
- 没有 → 把当前内存里的数据搬过去
- 长按那一栏恢复默认位置（`Documents/Livolog`）

## 目录结构

```
Livolog/
├── .github/workflows/
│   ├── build.yml                 # CI：构建 Debug APK
│   └── release.yml               # 发布：打 v* 标签时构建并发布 Release
├── app/
│   ├── build.gradle.kts          # 版本号唯一来源
│   └── src/main/
│       ├── AndroidManifest.xml
│       ├── java/com/eliaszwc/livolog/
│       │   ├── MainActivity.kt   # WebView 容器、系统栏、文件选择器
│       │   ├── WebAppBridge.kt   # 暴露给网页的 JS 接口
│       │   ├── CsvStore.kt       # CSV 落盘到 Livolog 目录
│       │   ├── Updater.kt        # 应用内更新：查 Release / 下载 APK / 拉起安装器
│       │   └── CrashLog.kt       # 崩溃堆栈落盘并在下次启动显示
│       ├── assets/www/           # 网页前端
│       │   ├── index.html        # 页面结构（含启动动画屏、表单弹窗、详情页）
│       │   ├── styles.css        # 主题变量 + 全部样式
│       │   ├── i18n.js           # 中英文词条
│       │   ├── icons.js          # 谷歌官方行为图标库
│       │   ├── clock.js          # 时间口径（时区 / 每周起始日 / 墙上时间换算）
│       │   ├── csv.js            # CSV 序列化 / 解析
│       │   ├── store.js          # 数据层（行为 / 时间记录）
│       │   ├── metrics.js        # 数据层（跟踪项 / 跟踪记录）
│       │   ├── components.js     # 弹窗 / 下拉 / 图标选择器 / 多选 / 轻提示 / 壳通信
│       │   ├── datetime.js       # 日期格式化 + 分段日期时间输入
│       │   ├── chart.js          # 统计图（直方图 / 折线图，内联 SVG）
│       │   ├── datepicker.js     # 日期选择弹窗
│       │   ├── stats.js          # 统计视图的选项栏（图类型 / 时间范围）
│       │   ├── theme.js          # 主题偏好
│       │   ├── setting.js        # 设置页
│       │   ├── update.js         # 应用内更新弹窗
│       │   ├── page-time.js      # 时间页
│       │   ├── page-behavior.js  # 行为页
│       │   ├── page-behavior-detail.js  # 行为详情页
│       │   ├── page-metric.js    # 跟踪页
│       │   ├── page-metric-detail.js    # 跟踪详情页
│       │   └── app.js            # 外壳：导航 / 标题 / 启动
│       └── res/                  # 主题、配色、启动图标、FileProvider 路径
├── build.gradle.kts
├── settings.gradle.kts
├── gradle.properties
└── CHANGELOG.md
```

网页资源通过 `WebViewAssetLoader` 以 `https://appassets.androidplatform.net/assets/www/index.html`
提供给 WebView（而不是 `file://`），这样 `localStorage` 等 Web API 才能正常工作。

## 本地开发

本地只需改网页部分时，可以直接用任意静态服务器预览 `app/src/main/assets/www/`：

```powershell
cd app/src/main/assets/www
python -m http.server 8000
```

构建 APK 需要 JDK 17 + Android SDK；也可以在本地用 Gradle 构建：

```powershell
gradle assembleDebug
```

## 版本管理

- 版本号**唯一来源**是 `app/build.gradle.kts` 顶部的两个常量：

  ```kotlin
  val appVersionCode = 1
  val appVersionName = "0.0.1"
  ```

- **只有明确要求发版时才修改版本号**，平时开发保持当前版本不变。
- Git 标签格式为 `vX.Y.Z`，且必须与 `appVersionName` 完全一致，否则发布工作流会直接失败（防止发错版本）。
- 每次发版时同步更新 `CHANGELOG.md`。

### 发布一个新版本

```powershell
# 1. 修改 app/build.gradle.kts：appVersionCode +1，appVersionName 改为新版本
# 2. 更新 CHANGELOG.md
git add -A
git commit -m "chore: release v0.0.2"
git push origin main

# 3. 打标签并推送，触发发布工作流
git tag v0.0.2
git push origin v0.0.2
```

标签推送后，`Release` 工作流会构建 APK，并自动创建 GitHub Release 挂上 `Livolog-v0.0.2.apk`。

### 发布签名

**发布包必须用固定密钥签名**。否则每次 CI 都会新生成一个随机 debug 密钥，导致新旧版本签名不一致，
用户覆盖安装时会报 `conflicting signature` / 无法安装。

因此 `app/build.gradle.kts` 在缺少密钥时会**直接让 release 任务失败**，绝不会产出「能装但签不了名」的包。

密钥库放在本地 `.signing/`（已被 gitignore），同目录有密码，**务必备份**。仓库 Secrets 已配置：

| Secret | 说明 |
| --- | --- |
| `KEYSTORE_BASE64` | `lifelog-release.p12` 的 base64 |
| `KEYSTORE_PASSWORD` | 密钥库密码 |
| `KEY_ALIAS` | `lifelog`（密钥库里的别名，历史名字，**永远不要改**，改了就不能覆盖安装） |
| `KEY_PASSWORD` | 密钥密码 |

详见 `.signing/README.md`。

> ⚠️ 换密钥 = 换签名，用户必须先卸载再装新版（数据全丢），所以**不要轻易更换**。

## 开发进度

- [x] 应用骨架 + 黑白主题 + 启动图标
- [x] 底部导航（时间 / 行为 / 跟踪 / 设置）+ 页面顶部居中标题
- [x] 中英双语基础，默认英文
- [x] 设置页：列表布局 + 主题（日间 / 夜间 / 跟随系统）
- [x] 页面 / 列表切换动画
- [x] 行为页：列表 + 新增行为表单（名称 + 图标）
- [x] 时间页：三视图（全部 / 时段 / 时点）+ 列表 + 新增记录表单
- [x] 卡片长按多选删除（时间页）
- [x] 全屏布局 + 键盘避让 + 自绘下拉控件
- [x] 行为详情页（重命名 / 输名删除 / 记录视图）
- [x] 时间记录以 CSV 落盘到 Livolog 目录 + CSV 导入
- [x] 设置页分区
- [x] 行为详情页的统计视图（直方图 + 统计信息）
- [x] 设置项统一为「左名称 / 右值」，设置列表卡片化
- [x] 时间记录点击修改
- [x] 数据导出（系统「另存为」）
- [x] 应用内检测更新 + 下载 + 安装
- [x] 时间记录点击修改
- [x] 数据导出（系统「另存为」）
- [x] 跟踪页（跟踪项 + 时点式记录 + 统计）
- [x] 数据存储位置可换文件夹
- [x] 时间页三级分组（年 / 月 / 周，层级随范围变化）+ 时间范围筛选
- [x] 统计视图可选图类型与统计区间
- [x] 统计视图：起止时间合成一行、统计信息直接排在背景上
- [x] 折线图跨过没有记录的天直接连线
- [x] 卡片长按多选删除（时间页 / 行为详情页 / 跟踪详情页）
- [x] 图标库扩容（闪电 / 显微镜 / 药丸等 10 个）
- [x] 带 logo 的启动动画（splash，纯 CSS）
- [x] 时间页记录按天分隔（换天插一条日期标记）
- [x] 启动页换成品牌黑 + 干掉系统自带的图标启动页
- [x] 行为页 / 跟踪页长按拖动排序（行为顺序同步到新建记录的行为下拉）
- [x] 时间页天标识改为 `YYYY-MM-DD, 周几`
- [x] 新建记录按行为习惯预选记录类型
- [x] 统计图点某一天看具体数值
- [x] 时间记录可写描述（选填，卡片上多一行）
- [x] 后台久置回来自愈（渲染进程被回收后自动重建）
- [x] 图标选择改为点开弹窗（62 个图标）
- [x] 跟踪项支持多字段键值记录（如血压：高压 / 低压 / 脉搏）
- [x] 导出文件名自动编号（livolog-001.csv…）
- [x] 设置页：通用（语言 / 主题）/ 数据管理 / 关于（版本 / 联系）
- [ ] 卡片编辑
- [ ] 统计页
