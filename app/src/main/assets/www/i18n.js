/**
 * Livolog - 极简国际化。
 *
 * 默认语言为英文（DEFAULT_LOCALE），zh 词条已备好，交给后续「设置」页切换。
 * 支持三种绑定：data-i18n（文本）、data-i18n-aria-label、data-i18n-placeholder。
 */
(function (global) {
    'use strict';

    var DEFAULT_LOCALE = 'en';
    var STORAGE_KEY = 'livolog.locale';

    var MESSAGES = {
        en: {
            'app.name': 'Livolog',
            'nav.label': 'Main Navigation',
            'nav.time': 'Time',
            'nav.behavior': 'Behavior',
            'nav.metric': 'Track',
            'nav.setting': 'Setting',

            'view.all': 'All',
            'view.period': 'Period',
            'view.moment': 'Moment',
            'view.records': 'Records',
            'view.stats': 'Stats',
            'view.switch': 'Switch View',

            'time.range.all': 'All',
            'time.range.year': 'Last Year',
            'time.range.month': 'Last Month',
            'time.range.week': 'Last Week',
            'time.group.year': '{y}',
            'time.group.month': '{y}-{m}',
            'time.group.week': '{y}-{m}-W{n}',
            'time.level.year': 'Year',
            'time.level.month': 'Month',
            'time.level.week': 'Week',

            // 日期标记里的周几（getDay() 的 0~6，0 = 周日）
            'weekday.0': 'Sun',
            'weekday.1': 'Mon',
            'weekday.2': 'Tue',
            'weekday.3': 'Wed',
            'weekday.4': 'Thu',
            'weekday.5': 'Fri',
            'weekday.6': 'Sat',

            'date.invalid': 'Date Is Incomplete',

            'stats.chartType': 'Chart',
            'stats.chartType.bar': 'Bars',
            'stats.chartType.line': 'Line',
            'stats.range': 'Range',
            'stats.series': 'Items',
            'stats.series.all': 'All',
            'stats.series.pick': 'Select…',
            'stats.pickStart': 'Start Date',
            'stats.pickEnd': 'End Date',

            'time.empty': 'No Records Yet',
            'time.add': 'Add Record',
            'time.form.title': 'New Record',
            'time.form.editTitle': 'Edit Record',
            'time.form.behavior': 'Behavior',
            'time.form.type': 'Type',
            'time.form.type.none': 'Select Type',
            'time.form.note': 'Description',
            'time.form.note.placeholder': 'Optional',
            'time.form.start': 'Start',
            'time.form.end': 'End',
            'time.form.happen': 'Happen',
            'time.form.needBehavior': 'Create a Behavior First',
            'time.form.needType': 'Pick a Type to Set the Time',
            'time.form.invalidTime': 'Fill in the Full Time',
            'time.form.endBeforeStart': 'End Is Earlier Than Start',

            'behavior.empty': 'No Behaviors Yet',
            'behavior.add': 'Add Behavior',
            'behavior.form.title': 'New Behavior',
            'behavior.edit.title': 'Edit Behavior',
            'behavior.form.name': 'Name',
            'behavior.form.namePlaceholder': 'e.g. Sleep',
            'behavior.form.icon': 'Icon',
            'behavior.form.needName': 'Enter a Name',

            'behavior.menu.open': 'More Options',
            'behavior.menu.rename': 'Rename',
            'behavior.menu.delete': 'Delete',
            'behavior.detail.back': 'Back',
            'behavior.detail.records': 'Records',
            'behavior.detail.stats': 'Stats',
            'behavior.detail.empty': 'No Records Yet',
            'behavior.detail.statsEmpty': 'No Records Yet',
            'behavior.detail.total': 'Total Time',
            'behavior.detail.count': 'Total Times',
            'behavior.detail.perTime': 'Average per Time',
            'behavior.detail.perDay': 'Average per Day',
            'behavior.detail.chartDuration': 'Minutes per Day',
            'behavior.detail.chartCount': 'Times per Day',

            'unit.hour': 'h',
            'unit.minute': 'm',

            'behavior.delete.title': 'Delete Behavior',
            'behavior.delete.tip': 'Type {name} to confirm. All time records of this behavior will be deleted too.',
            'behavior.delete.hint': 'Behavior Name',
            'behavior.delete.confirm': 'Delete',

            'metric.empty': 'No Trackers Yet',
            'metric.add': 'Add Tracker',
            'metric.form.title': 'New Tracker',
            'metric.edit.title': 'Edit Tracker',
            'metric.form.name': 'Name',
            'metric.form.namePlaceholder': 'e.g. Weight',
            'metric.form.items': 'Items',
            'metric.form.item.add': 'Add Item',
            'metric.form.itemNamePlaceholder': 'e.g. Weight',
            'metric.form.items.invalid': 'Name Every Item',
            'metric.menu.rename': 'Rename',
            'metric.detail.records': 'Records',
            'metric.detail.stats': 'Stats',
            'metric.detail.empty': 'No Entries Yet',
            'metric.detail.statsEmpty': 'No Entries Yet',
            'metric.detail.chartDaily': 'Value per Record',
            'metric.detail.count': 'Entries',
            'metric.detail.latest': 'Latest',
            'metric.detail.average': 'Average',
            'metric.detail.max': 'Maximum',
            'metric.detail.min': 'Minimum',
            'metric.record.add': 'Add Entry',
            'metric.record.title': 'New Entry',
            'metric.record.editTitle': 'Edit Entry',
            'metric.record.value': 'Value',
            'metric.record.valuePlaceholder': '0',
            'metric.detail.formula': 'Show',
            'metric.detail.chartFormula': 'Show Which Value',
            'metric.record.invalidTime': 'Time Is Incomplete',
            'metric.record.invalidValue': 'Please Enter a Number',
            'metric.delete.title': 'Delete Tracker',
            'metric.delete.tip': 'Type {name} to confirm. All entries of this tracker will be deleted too.',
            'metric.delete.hint': 'Tracker Name',
            'metric.delete.confirm': 'Delete',

            'setting.group.general': 'General',
            'setting.group.time': 'Time',
            'setting.group.data': 'Data',
            'setting.group.about': 'About',
            'setting.language': 'Language',
            'setting.language.en': 'English',
            'setting.language.zh': '中文',
            'setting.contact': 'Contact',
            'setting.timezone': 'Time Zone',
            'setting.timezone.system': 'System',
            'setting.weekStart': 'Week Start',
            'setting.import': 'Import Data',
            'setting.export': 'Export Data',
            'setting.storage': 'Location',
            'setting.import.empty': 'Not Set',
            'setting.data.records': 'Time Records',
            'setting.data.metrics': 'Tracker Data',

            'toast.imported': 'Imported {n} Records',
            'toast.importedMetrics': 'Imported {m} Trackers, {n} Records',
            'toast.importFailed': 'Import Failed: {reason}',
            'toast.importEmpty': 'No Valid Rows Found',
            'toast.importReason.empty': 'Empty File',
            'toast.importReason.header': 'Not a Livolog CSV',
            'toast.importReason.format': 'Not a Livolog CSV',
            'toast.importReason.norows': 'No Readable Rows, Existing Data Kept',
            'toast.importReason.read': 'Unreadable File',
            'toast.importReason.write-failed': 'Could Not Save to Local Storage',
            'toast.deleted': 'Deleted',
            'toast.saveFailed': 'Failed to Write CSV',
            'toast.exported': 'Exported to {path}',
            'toast.exportFailed': 'Export Failed: {reason}',
            'toast.exportCanceled': 'Export Canceled',

            'update.title': 'Update Available',
            'update.message': 'Version {version} has been released ({size}). You are on {current}.',
            'update.later': 'Later',
            'update.now': 'Update',
            'update.downloading': 'Downloading...',
            'update.retryInstall': 'Retry Install',
            'update.installing': 'Downloaded, Installing...',
            'update.failed.permission': 'Allow Livolog to install apps in the system settings, then come back and retry.',
            'update.failed.network': 'Download failed. Check your network and try again.',
            'update.failed.install': 'Could not start the installer. Please install the APK manually.',
            'update.failed.invalid': 'The downloaded file is not a valid APK. Please try again.',
            'update.failed.truncated': 'The download was incomplete. Please try again.',
            'update.failed.mismatch': 'The downloaded package does not match the released version. Please try again.',
            'update.failed.downgrade': 'The downloaded package is not newer than the installed one, so it was not installed.',
            'update.failed.unknown': 'Update failed. Please try again later.',
            'update.stalled': 'The previous install did not take effect. Allow Livolog to install apps in the system settings, then try again.',

            'action.cancel': 'Cancel',
            'action.confirm': 'Confirm',
            'action.close': 'Close',
            'action.clear': 'Clear',

            'icon.pick': 'Choose Icon',
            'icon.search': 'Search Icons',
            'icon.searchEmpty': 'No Matching Icon',
            'icon.category.favorite': 'Frequently used',
            'icon.category.sport': 'Sport',
            'icon.category.food': 'Food',
            'icon.category.health': 'Health',
            'icon.category.transport': 'Transport',
            'icon.category.study': 'Study',
            'icon.category.work': 'Work',
            'icon.category.daily': 'Daily',
            'icon.category.play': 'Leisure',
            'icon.category.other': 'Other',

            'selection.cancel': 'Cancel Selection',
            'selection.delete': 'Delete Selected',
            'selection.count': '{n} selected',

            'setting.version': 'Version',
            'setting.storage.pick': 'Tap to Pick Another Folder',
            'setting.storage.unavailable': 'Folder Change Is Available in the App Only',
            'setting.storage.reset': 'Default Location Restored',

            'setting.theme': 'Theme',
            'setting.theme.light': 'Light',
            'setting.theme.dark': 'Dark',
            'setting.theme.system': 'System'
        },
        zh: {
            'app.name': 'Livolog',
            'nav.label': '主导航',
            'nav.time': '时间',
            'nav.behavior': '行为',
            'nav.metric': '跟踪',
            'nav.setting': '设置',

            'view.all': '全部',
            'view.period': '时段',
            'view.moment': '时点',
            'view.records': '记录',
            'view.stats': '统计',
            'view.switch': '切换视图',

            'time.range.all': '全部',
            'time.range.year': '最近一年',
            'time.range.month': '最近一月',
            'time.range.week': '最近一周',
            'time.group.year': '{y}',
            'time.group.month': '{y}-{m}',
            'time.group.week': '{y}-{m}-W{n}',
            'time.level.year': '年',
            'time.level.month': '月',
            'time.level.week': '周',

            'weekday.0': '周日',
            'weekday.1': '周一',
            'weekday.2': '周二',
            'weekday.3': '周三',
            'weekday.4': '周四',
            'weekday.5': '周五',
            'weekday.6': '周六',

            'date.invalid': '日期未填写完整',

            'stats.chartType': '图类型',
            'stats.chartType.bar': '直方图',
            'stats.chartType.line': '折线图',
            'stats.range': '时间范围',
            'stats.series': '项目',
            'stats.series.all': '全部',
            'stats.series.pick': '选择…',
            'stats.pickStart': '选择开始日期',
            'stats.pickEnd': '选择结束日期',

            'time.empty': '还没有记录',
            'time.add': '新增记录',
            'time.form.title': '新增记录',
            'time.form.editTitle': '修改记录',
            'time.form.behavior': '行为',
            'time.form.type': '类型',
            'time.form.type.none': '请选择类型',
            'time.form.note': '描述',
            'time.form.note.placeholder': '选填',
            'time.form.start': '开始',
            'time.form.end': '结束',
            'time.form.happen': '发生',
            'time.form.needBehavior': '请先到「行为」页创建行为',
            'time.form.needType': '请先选择类型',
            'time.form.invalidTime': '时间未填写完整',
            'time.form.endBeforeStart': '结束时间早于开始时间',

            'behavior.empty': '还没有行为',
            'behavior.add': '新增行为',
            'behavior.form.title': '新增行为',
            'behavior.edit.title': '编辑行为',
            'behavior.form.name': '名称',
            'behavior.form.namePlaceholder': '例如：睡眠',
            'behavior.form.icon': '图标',
            'behavior.form.needName': '请输入名称',

            'behavior.menu.open': '更多操作',
            'behavior.menu.rename': '重命名',
            'behavior.menu.delete': '删除',
            'behavior.detail.back': '返回',
            'behavior.detail.records': '记录',
            'behavior.detail.stats': '统计',
            'behavior.detail.empty': '还没有记录',
            'behavior.detail.statsEmpty': '还没有记录',
            'behavior.detail.total': '总时长',
            'behavior.detail.count': '总次数',
            'behavior.detail.perTime': '平均每次时长',
            'behavior.detail.perDay': '平均每日时长',
            'behavior.detail.chartDuration': '每日时长（分钟）',
            'behavior.detail.chartCount': '每日次数',

            'unit.hour': '小时',
            'unit.minute': '分钟',

            'behavior.delete.title': '删除行为',
            'behavior.delete.tip': '请输入「{name}」以确认删除，该行为下的所有时间记录也会一并删除。',
            'behavior.delete.hint': '行为名称',
            'behavior.delete.confirm': '删除',
            'metric.empty': '还没有跟踪项',
            'metric.add': '新增跟踪项',
            'metric.form.title': '新增跟踪项',
            'metric.edit.title': '编辑跟踪项',
            'metric.form.name': '名称',
            'metric.form.namePlaceholder': '例如：体重',
            'metric.form.items': '项目',
            'metric.form.item.add': '添加项目',
            'metric.form.itemNamePlaceholder': '例如：体重',
            'metric.form.items.invalid': '每个项目都要填名字',
            'metric.menu.rename': '重命名',
            'metric.detail.records': '记录',
            'metric.detail.stats': '统计',
            'metric.detail.empty': '还没有记录',
            'metric.detail.statsEmpty': '还没有记录',
            'metric.detail.chartDaily': '每次记录取值',
            'metric.detail.count': '记录次数',
            'metric.detail.latest': '最新值',
            'metric.detail.average': '平均值',
            'metric.detail.max': '最大值',
            'metric.detail.min': '最小值',
            'metric.record.add': '新增记录',
            'metric.record.title': '新增记录',
            'metric.record.editTitle': '修改记录',
            'metric.record.value': '记录值',
            'metric.record.valuePlaceholder': '0',
            'metric.detail.formula': '计算公式',
            'metric.detail.chartFormula': '展示哪个值',
            'metric.record.invalidTime': '时间未填写完整',
            'metric.record.invalidValue': '请填写一个数值',
            'metric.delete.title': '删除跟踪项',
            'metric.delete.tip': '请输入 {name} 以确认，该跟踪项下的全部记录也会一并删除。',
            'metric.delete.hint': '跟踪项名称',
            'metric.delete.confirm': '删除',
            'setting.group.general': '通用',
            'setting.group.time': '时间',
            'setting.group.data': '数据管理',
            'setting.group.about': '关于',
            'setting.language': '语言',
            'setting.language.en': 'English',
            'setting.language.zh': '中文',
            'setting.contact': '联系',
            'setting.timezone': '时区',
            'setting.timezone.system': '系统',
            'setting.weekStart': '每周起始',
            'setting.import': '导入数据',
            'setting.export': '导出数据',
            'setting.storage': '存储位置',
            'setting.data.records': '时间记录',
            'setting.data.metrics': '跟踪数据',
            'setting.import.empty': '未设置',

            'toast.imported': '已导入 {n} 条记录',
            'toast.importedMetrics': '已导入 {m} 个跟踪项、{n} 条跟踪记录',
            'toast.importFailed': '导入失败：{reason}',
            'toast.importEmpty': '没有可导入的有效行',
            'toast.importReason.empty': '文件是空的',
            'toast.importReason.header': '不是 Livolog 的 CSV（缺少 metric / time 列）',
            'toast.importReason.format': '不是 Livolog 的 CSV（缺少 metric / time 列）',
            'toast.importReason.norows': '读不到有效行，已保留原有数据',
            'toast.importReason.read': '文件读取失败',
            'toast.importReason.write-failed': '写入本地存储失败',
            'toast.deleted': '已删除',
            'toast.saveFailed': 'CSV 写入失败',
            'toast.exported': '已导出到 {path}',
            'toast.exportFailed': '导出失败：{reason}',
            'toast.exportCanceled': '已取消导出',

            'update.title': '发现新版本',
            'update.message': '新版本 {version} 已发布（{size}），当前版本 {current}。',
            'update.later': '稍后',
            'update.now': '更新',
            'update.downloading': '正在下载…',
            'update.retryInstall': '重试安装',
            'update.installing': '下载完成，正在安装…',
            'update.failed.permission': '请在系统设置里允许 Livolog 安装应用，然后回到这里重试。',
            'update.failed.network': '下载失败，请检查网络后重试。',
            'update.failed.install': '无法拉起安装器，请手动安装下载好的 APK。',
            'update.failed.invalid': '下载到的不是合法的安装包，请重试。',
            'update.failed.truncated': '下载不完整，请重试。',
            'update.failed.mismatch': '下载到的包与发布版本不一致，请重试。',
            'update.failed.downgrade': '下载到的包不比已安装的版本新，已阻止安装。',
            'update.failed.unknown': '更新失败，请稍后再试。',
            'update.stalled': '上一次安装没有生效。请确认系统已允许 Livolog 安装应用，然后重试。',

            'action.cancel': '取消',
            'action.confirm': '确定',
            'action.close': '关闭',
            'action.clear': '清空',

            'icon.pick': '选择图标',
            'icon.search': '搜索图标',
            'icon.searchEmpty': '没有匹配的图标',
            'icon.category.favorite': '常用',
            'icon.category.sport': '运动',
            'icon.category.food': '饮食',
            'icon.category.health': '医疗健康',
            'icon.category.transport': '出行交通',
            'icon.category.study': '学习',
            'icon.category.work': '工作',
            'icon.category.daily': '日常',
            'icon.category.play': '娱乐休闲',
            'icon.category.other': '其他',

            'selection.cancel': '取消选择',
            'selection.delete': '删除所选',
            'selection.count': '已选 {n} 项',

            'setting.version': '版本',
            'setting.storage.pick': '点击可选择其它文件夹',
            'setting.storage.unavailable': '仅 app 内支持更换文件夹',
            'setting.storage.reset': '已恢复默认位置',
            'setting.theme': '主题',
            'setting.theme.light': '日间',
            'setting.theme.dark': '夜间',
            'setting.theme.system': '系统'
        }
    };

    var current = DEFAULT_LOCALE;
    var listeners = [];

    function normalize(locale) {
        if (!locale) {
            return DEFAULT_LOCALE;
        }
        var value = String(locale).toLowerCase();
        if (MESSAGES[value]) {
            return value;
        }
        if (value.indexOf('zh') === 0) {
            return 'zh';
        }
        return DEFAULT_LOCALE;
    }

    function t(key) {
        var table = MESSAGES[current] || {};
        if (Object.prototype.hasOwnProperty.call(table, key)) {
            return table[key];
        }
        var fallback = MESSAGES[DEFAULT_LOCALE];
        return Object.prototype.hasOwnProperty.call(fallback, key) ? fallback[key] : key;
    }

    /** 把当前语言应用到 DOM 上带 data-i18n / data-i18n-aria-label 的元素 */
    function apply(root) {
        var scope = root || document;

        Array.prototype.forEach.call(scope.querySelectorAll('[data-i18n]'), function (element) {
            element.textContent = t(element.dataset.i18n);
        });

        Array.prototype.forEach.call(scope.querySelectorAll('[data-i18n-aria-label]'), function (element) {
            element.setAttribute('aria-label', t(element.dataset.i18nAriaLabel));
        });

        Array.prototype.forEach.call(scope.querySelectorAll('[data-i18n-placeholder]'), function (element) {
            element.setAttribute('placeholder', t(element.dataset.i18nPlaceholder));
        });

        document.documentElement.lang = current === 'zh' ? 'zh-CN' : 'en';
        document.title = t('app.name');
    }

    function setLocale(locale) {
        current = normalize(locale);
        try {
            localStorage.setItem(STORAGE_KEY, current);
        } catch (e) {
            /* 隐私模式下忽略 */
        }
        apply(document);
        listeners.forEach(function (listener) {
            listener(current);
        });
        return current;
    }

    function init() {
        var saved = null;
        try {
            saved = localStorage.getItem(STORAGE_KEY);
        } catch (e) {
            /* 忽略 */
        }
        current = normalize(saved || DEFAULT_LOCALE);
        apply(document);
        return current;
    }

    global.LivologI18n = {
        DEFAULT_LOCALE: DEFAULT_LOCALE,
        init: init,
        setLocale: setLocale,
        getLocale: function () {
            return current;
        },
        t: t,
        apply: apply,
        onChange: function (listener) {
            listeners.push(listener);
        }
    };
})(window);
