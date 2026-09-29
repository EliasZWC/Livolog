# Livolog

A personal life-logging app for Android. Track what you do and how you feel, and look back at it over time.

Log a behavior once it happens, or record a span for things that last a while — then review everything grouped
by year, month, and week, with charts for each behavior and tracker.

> **Renamed from LifeLog in v0.0.17.** The app name, repository, package (`com.eliaszwc.livolog`), and data
> folder (`Documents/Livolog/`) all changed. Settings and data left behind by the old package are migrated
> automatically — but because the package changed, **uninstall LifeLog before installing Livolog**,
> otherwise you will end up with two icons.

| | |
| --- | --- |
| Latest version | **v0.1.27** |
| App name | Livolog |
| Package | `com.eliaszwc.livolog` |
| Requires | Android 8.0 (API 26) or newer |
| Targets | Android 15 (API 35) |
| Repository | https://github.com/EliasZWC/Livolog |

## Download

Grab the latest `Livolog-vX.Y.Z.apk` from the [Releases](https://github.com/EliasZWC/Livolog/releases) page
and open it on your device. Android will ask you to allow installing apps from this source the first time.

The app also checks for updates on its own each time you bring it to the foreground and offers to install
the new version for you.

> Upgrades are installed over the existing app, so **your data is kept**. Downgrading is not supported.

## What you can do

### Time records

The app is built around **behaviors** — the things you do. Create a behavior (Sleep, Reading, Gym…) with a name
and an icon, then log against it.

Two kinds of record:

- **Moment** — a single point in time. "I took my medication at 08:00."
- **Period** — a span with a start and an end. "I slept from 23:00 to 07:00."

Each record can carry an optional description. Long descriptions are collapsed to one line in the list —
tap to expand, tap again to collapse.

The Time page groups everything into year → month → week, and you can narrow it down to the last year,
month, or week. Records are separated by day, each marked with a date.

You can tap any record to edit it, or long-press a card to select several and delete them together.

### Trackers

The Track page holds **trackers** for things you measure rather than do — weight, waistline, blood pressure.

A tracker can have several fields (blood pressure = systolic / diastolic / pulse), so one entry records a
whole set of readings at once. Entries are always moments: a time plus values, with no start or end,
which is why they never show up on the Time page.

### Statistics

Every behavior and every tracker has a detail page with a chart. Pick between bars and a line, choose the
time range, and tap any point to read the exact value. Trackers with several fields let you choose which
field to plot, or show them all at once on one chart.

Summary figures sit under the chart: total time, number of records, averages, and so on.

### Settings

- **Language** — English or 中文
- **Theme** — Light / Dark / System
- **Time Zone** — follow the system, or pick a fixed offset
- **Week Start** — Sunday or Monday. This defines when a week begins, so it changes how records are
  grouped into weeks.
- **Location** — where your CSV files are stored; you can point it at any folder
- **Import Data / Export Data** — back up or move your data as CSV

## Your data

**Your data lives in plain CSV files on your device, not on a server.** Nothing is uploaded anywhere.
You can open the files in Excel or any text editor, edit them, and import them back.

Default location: `Documents/Livolog/`

| File | Contents |
| --- | --- |
| `records.csv` | Time records |
| `metrics.csv` | Tracker data |

- `records.csv` header: `id,behavior,type,start,end,note` — the behavior is written as its **name**, so the
  file stays readable and portable.
- `metrics.csv` is a wide table: `id,metric,time,<field name>…` — one row per entry, one column per field.
  You can add columns in Excel and they become new fields when you import it back.
- Row endings are CRLF, so Excel opens the files cleanly.

Importing **replaces** the current data, so the app validates the file first and refuses anything that does
not look like a Livolog CSV — a wrong file will never wipe your records.

You can change the storage folder at any time. If the target folder already contains a `records.csv`, that
file becomes your new database; otherwise your current data is moved there.

## Design

- **Icons** — [Material Icons](https://fonts.google.com/icons) only, no third-party icon sets.
- **Typeface** — a subset of Sarasa Mono SC (SIL OFL 1.1), bundled with the app so the interface looks the
  same on every device. Characters outside the subset fall back to the system font.
- **Color** — black and white, using shades of gray to build hierarchy. Never pure `#000` or `#fff`:
  the light theme is white-dominant, the dark theme black-dominant, and the navigation bar is always the
  most extreme surface on screen.
- **Type scale** — titles are dark, bold, and uppercase; labels are dark and bold; values are lighter and
  regular. Chinese text is unaffected by the uppercase rule, so it only shapes the English interface.

## Requirements

- Android 8.0 (API 26) or newer
- No account needed. The network is only touched to check for updates.

## Building from source

The project is an Android WebView shell: a native container plus a front end written in plain HTML, CSS,
and JavaScript. All of the interface and logic live in `app/src/main/assets/www/`.

```powershell
# Build a debug APK (needs JDK 17 + Android SDK)
gradle assembleDebug
```

To preview just the front end, serve the assets folder with any static server:

```powershell
cd app/src/main/assets/www
python -m http.server 8000
```

### Releasing

The version is defined in exactly one place — `app/build.gradle.kts`:

```kotlin
val appVersionCode = 48
val appVersionName = "0.1.27"
```

Bump both, update `CHANGELOG.md`, push to `main`, then push a matching `vX.Y.Z` tag. The release workflow
builds and signs the APK and attaches it to a GitHub Release. The tag must match `appVersionName`
exactly or the workflow fails, which prevents mislabelled releases.

Release builds must be signed with the project's fixed keystore. Without it the release task fails outright
rather than producing an unsigned — and therefore uninstallable — package. Losing the key means users have to
uninstall and reinstall, losing their data, so back it up.

## Project layout

```
Livolog/
├── .github/workflows/
│   ├── build.yml                 # CI: build the debug APK
│   └── release.yml               # Release: build and publish on a v* tag
├── app/
│   ├── build.gradle.kts          # single source of truth for the version
│   └── src/main/
│       ├── AndroidManifest.xml
│       ├── java/com/eliaszwc/livolog/
│       │   ├── MainActivity.kt   # WebView container, system bars, file pickers
│       │   ├── WebAppBridge.kt   # the JS interface exposed to the page
│       │   ├── CsvStore.kt       # writes CSVs to the Livolog folder
│       │   ├── Updater.kt        # in-app update: check, download, install
│       │   └── CrashLog.kt       # persists crash stacks for the next launch
│       ├── assets/www/           # the front end
│       │   ├── index.html        # markup (splash, sheets, detail pages)
│       │   ├── styles.css        # theme tokens and all styling
│       │   ├── i18n.js           # English and Chinese strings
│       │   ├── icons.js          # Material icon set
│       │   ├── clock.js          # time zone, week start, wall-clock math
│       │   ├── csv.js            # CSV serialisation and parsing
│       │   ├── store.js          # data layer: behaviors and time records
│       │   ├── metrics.js        # data layer: trackers and their entries
│       │   ├── components.js     # sheets, menus, icon picker, toasts, bridge
│       │   ├── datetime.js       # date formatting and segmented time input
│       │   ├── chart.js          # charts (bars and lines, inline SVG)
│       │   ├── datepicker.js     # date picker sheet
│       │   ├── stats.js          # stats toolbar (chart type, range)
│       │   ├── theme.js          # theme preference
│       │   ├── setting.js        # settings page
│       │   ├── update.js         # update dialog
│       │   ├── page-time.js      # Time page
│       │   ├── page-behavior.js  # Behavior page
│       │   ├── page-behavior-detail.js
│       │   ├── page-metric.js    # Track page
│       │   ├── page-metric-detail.js
│       │   └── app.js            # shell: navigation, titles, startup
│       └── res/                  # themes, colors, launcher icon, FileProvider
├── build.gradle.kts
├── settings.gradle.kts
├── gradle.properties
└── CHANGELOG.md
```

Assets are served to the WebView through `WebViewAssetLoader` at
`https://appassets.androidplatform.net/assets/www/index.html` rather than over `file://`, so that
`localStorage` and the rest of the Web API work normally.

## Native bridge

The page talks to the native side through a `LivologNative` object injected with `addJavascriptInterface`:

| Method | Purpose |
| --- | --- |
| `setThemeMode(mode)` | Tell the native side about a theme change (`light` / `dark` / `system`) |
| `saveRecordsCsv(csv)` | Mirror time records into the Livolog folder |
| `saveMetricsCsv(csv)` | Mirror tracker data into `metrics.csv` |
| `pickStorageFolder()` | Open the system folder picker |
| `resetStorageFolder()` | Restore the default storage location |
| `exportRecordsCsv(csv)` | Export data through the system "save as" dialog |
| `downloadUpdate()` | Start downloading a new APK |
| `installUpdate()` | Retry installation after granting permission |
| `closeUpdate()` | Dismiss the update dialog |

The native side calls back into `LivologShell` with `evaluateJavascript`:

| Method | Purpose |
| --- | --- |
| `setInsets(top, right, bottom, left, keyboard)` | System bar and keyboard sizes, written into CSS variables |
| `setVersion(name, code)` | Version, shown read-only on the settings page |
| `onStorageReady(csv, path)` | Contents and path of `records.csv` |
| `onMetricsReady(csv)` | Contents of `metrics.csv` |
| `onCsvSaved(ok, detail)` / `onMetricsSaved(ok, detail)` | Write results |
| `onStoragePathChanged(path)` | The folder changed but the contents did not |
| `onExported(ok, detail)` | Export result (empty `detail` means cancelled) |
| `onUpdateAvailable(version, current, size)` | A new version was found |
| `onUpdateProgress(percent)` | Download progress |
| `onUpdateReady()` | Download finished and the installer was launched |
| `onUpdateFailed(reason, downloaded)` | Update failed |

The WebView is full-screen, including under the status bar and navigation bar, so sheets and scrims can cover
the whole display. Layout insets come from CSS variables pushed by the native side rather than
`env(safe-area-inset-*)`, whose values are unreliable inside a WebView.

## Troubleshooting

**Two icons on the home screen** — you still have LifeLog installed. Uninstall it; Livolog is the successor.

**"App not installed" when updating** — the new APK is signed with a different key. Uninstall the old version
first, but note that this clears your data, so export it beforehand.

**A blank screen after the app has been in the background** — the WebView renderer was reclaimed by the
system. The app detects this and rebuilds the view automatically; if it keeps happening, restart the app.

## Development status

- [x] App skeleton, black and white theme, launcher icon
- [x] Bottom navigation (Time / Behavior / Track / Setting) with centered page titles
- [x] Bilingual English and Chinese, English by default
- [x] Settings page with theme switching
- [x] Page and list transition animations
- [x] Behavior page: list plus a form with name and icon
- [x] Time page: three views, list, and a record form
- [x] Full-screen layout, keyboard avoidance, custom select controls
- [x] Behavior detail page with rename and type-to-confirm delete
- [x] Time records stored as CSV, with import
- [x] Statistics for each behavior (chart plus summary figures)
- [x] Tap a record to edit it
- [x] Export through the system "save as" dialog
- [x] In-app update check, download, and install
- [x] Track page with multi-field entries and statistics
- [x] Configurable storage folder
- [x] Three levels of grouping on the Time page, plus range filtering
- [x] Selectable chart type and range
- [x] Long-press to select and delete records
- [x] Animated launch screen
- [x] Records separated by day
- [x] Long-press drag to reorder behaviors and trackers
- [x] Record type preselected from the behavior's history
- [x] Tap a chart point to read its value
- [x] Optional descriptions on records
- [x] Recovery after the WebView renderer is reclaimed
- [x] Icon picker with search and categories
- [x] Multi-field trackers (blood pressure: systolic / diastolic / pulse)
- [x] Numbered export filenames
- [x] Time Zone and Week Start settings
- [x] Collapsible descriptions with an expand indicator
- [x] Scrollbars in the app's own style
- [ ] Editing cards
- [ ] A dedicated statistics page

## History

See [CHANGELOG.md](CHANGELOG.md) for every release. Development notes in Chinese are kept in
[README.zh-dev.md](README.zh-dev.md).
