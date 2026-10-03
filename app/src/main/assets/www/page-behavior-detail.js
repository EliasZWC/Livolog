/**
 * Livolog - 行为详情页。
 *
 * 全屏覆盖在 app 之上，自带标题栏（返回 / 行为名称 / 菜单）与视图栏（记录 / 统计）。
 * 打开时往 history 里 push 一条记录，这样系统返回键、手势返回都能直接回来。
 */
(function (global) {
    'use strict';

    var VIEWS = ['records', 'stats'];
    var DEFAULT_VIEW = 'records';
    var ANIMATION_MS = 280;

    var root = null;
    var titleEl = null;
    var backBtn = null;
    var menuBtn = null;
    var viewNav = null;
    var listEl = null;
    var viewBar = null;
    var viewLabel = null;
    var viewButton = null;

    var deleteSheet = null;
    var deleteTip = null;
    var deleteInput = null;
    var deleteConfirm = null;

    var currentId = null;
    var currentView = DEFAULT_VIEW;
    var isOpen = false;

    /*
       记录视图的时间范围：与时间页同一套（全部 / 最近一年 / 最近一月 / 最近一周），
       但**不复用**时间页的 localStorage 偏好 —— 详情页的范围是临时的，
       每次打开都回到「全部」。
    */
    var RANGES = ['all', 'year', 'month', 'week'];
    var RANGE_DAYS = { all: 0, year: 365, month: 30, week: 7 };
    var range = 'all';

    var DAY_MS = 24 * 60 * 60 * 1000;

    /**
     * 统计视图的选项：统计类型 + 图类型 + 统计区间；每次打开详情页重置。
     * ⚠️ `metric` 是 `LivologStats` 注册表里的 id（见 stats.js 的 METRICS）。
     *    默认 duration（每日时长），但**旧行为只有时点记录时自动改用 count** ——
     *    否则一进去就是一排 0 的柱，看着像坏了。
     */
    var stats = { metric: 'duration', chartType: 'bar', range: null };

    function t(key) {
        return global.LivologI18n ? global.LivologI18n.t(key) : key;
    }

    function init() {
        root = document.getElementById('behavior-detail');
        titleEl = document.getElementById('detail-title');
        backBtn = document.getElementById('detail-back');
        menuBtn = document.getElementById('detail-menu');
        viewNav = document.getElementById('detail-view-nav');
        listEl = document.getElementById('detail-list');
        viewBar = document.getElementById('detail-view-bar');
        viewLabel = document.getElementById('detail-view-current');
        viewButton = document.getElementById('detail-view-button');

        deleteSheet = document.getElementById('sheet-delete-behavior');
        deleteTip = document.getElementById('delete-tip');
        deleteInput = document.getElementById('delete-confirm-input');
        deleteConfirm = document.getElementById('delete-confirm');

        backBtn.addEventListener('click', function () {
            close();
        });
        menuBtn.addEventListener('click', openActions);
        viewNav.addEventListener('click', onViewNavClick);
        viewButton.addEventListener('click', openRangeMenu);

        document.getElementById('delete-cancel').addEventListener('click', function () {
            global.LivologUI.closeSheet();
        });
        deleteInput.addEventListener('input', validateDelete);
        deleteInput.addEventListener('keydown', function (event) {
            if (event.key === 'Enter') {
                confirmDelete();
            }
        });
        deleteConfirm.addEventListener('click', confirmDelete);

        global.LivologStore.onChange(refresh);
        if (global.LivologI18n) {
            global.LivologI18n.onChange(refresh);
        }

        /*
           系统返回键 / 手势返回会触发 popstate。
           ⚠️ 先让**通用返回层**消化（下拉菜单 / 弹窗 / 图标选择器 / 多选栏），
              它们可能正压在详情页上面；直接关详情页会把用户正在操作的弹窗
              一并收掉，还会把历史记录多退一格。
        */
        global.addEventListener('popstate', function () {
            if (global.LivologUI.handleBack()) {
                // 刚关掉的是覆盖在详情页上的一层，把历史记录补回来
                global.history.pushState({ livologBehavior: currentId }, '');
                return;
            }
            if (isOpen) {
                close({ history: false });
            }
        });
    }

    // --- 打开 / 关闭 --------------------------------------------------------

    function open(id) {
        var behavior = global.LivologStore.getBehavior(id);
        if (!behavior || isOpen) {
            return;
        }

        currentId = id;
        currentView = DEFAULT_VIEW;
        range = 'all';
        stats = { metric: 'duration', chartType: 'bar', range: null };

        // 这一页自己当多选目标（长按卡片 → 顶部操作栏 → 删除）
        global.LivologUI.bindSelection(selection);

        isOpen = true;

        root.hidden = false;
        refresh();

        global.requestAnimationFrame(function () {
            root.classList.add('is-open');
        });

        global.history.pushState({ livologBehavior: id }, '');
    }

    function close(options) {
        if (!isOpen) {
            return;
        }

        isOpen = false;
        currentId = null;

        // 关掉详情页后，多选目标回到当前标签页的列表
        if (global.Livolog) {
            global.Livolog.syncSelection();
        }
        global.LivologUI.closeSheet();
        root.classList.remove('is-open');

        global.setTimeout(function () {
            if (!isOpen) {
                root.hidden = true;
            }
        }, ANIMATION_MS);

        if (!options || options.history !== false) {
            global.history.back();
        }
    }

    // --- 渲染 ---------------------------------------------------------------

    function refresh() {
        if (!isOpen || !currentId) {
            return;
        }

        var behavior = global.LivologStore.getBehavior(currentId);
        if (!behavior) {
            // 行为被删掉了
            close();
            return;
        }

        titleEl.textContent = behavior.name;
        renderViewNav();
        renderList(behavior);
    }

    /** 顶栏下方的内嵌视图导航栏（记录 / 统计），点哪一项就切到哪一项 */
    function renderViewNav() {
        Array.prototype.forEach.call(viewNav.children, function (button) {
            var active = button.dataset.view === currentView;
            button.classList.toggle('is-active', active);
            button.setAttribute('aria-selected', active ? 'true' : 'false');
        });
    }

    function onViewNavClick(event) {
        var target = event.target;
        var button = target && target.closest ? target.closest('.seg-nav-item') : null;
        if (!button || button.dataset.view === currentView) {
            return;
        }

        currentView = button.dataset.view;
        refresh();
        global.LivologUI.animateEnter(listEl, currentView === 'stats' ? 1 : -1);
    }

    function renderList(behavior) {
        listEl.innerHTML = '';

        // 视图栏只在记录视图显示
        viewBar.hidden = currentView !== 'records';

        if (currentView === 'stats') {
            renderStats(behavior);
            return;
        }

        var all = global.LivologStore.getRecords().filter(function (record) {
            return record.behaviorId === behavior.id;
        });

        var records = all.filter(function (record) {
            var days = RANGE_DAYS[range] || 0;
            if (!days) {
                return true;
            }
            var start = global.LivologDateTime.startOfDay(Date.now()) - (days - 1) * DAY_MS;
            // 跨天记录只要和区间有重叠就算（与统计口径一致）
            var end = record.type === 'period' && record.end !== null ? record.end : record.start;
            return end >= start;
        });

        renderViewBar();

        if (!records.length) {
            listEl.appendChild(global.LivologUI.emptyState(t('behavior.detail.empty')));
            return;
        }

        // 与时间页同一个分段逻辑：按天插日期标记
        global.LivologTimePage.appendRecordCards(
            listEl,
            records,
            function (record) {
                return buildRecordCard(behavior, record);
            },
            function (record) {
                return record.start;
            }
        );
    }

    /** 范围栏的文字 */
    function renderViewBar() {
        viewLabel.textContent = t('time.range.' + range);
        viewButton.setAttribute('aria-expanded', 'false');
    }

    function openRangeMenu() {
        viewButton.setAttribute('aria-expanded', 'true');
        global.LivologUI.openMenu(
            viewButton,
            RANGES.map(function (value) {
                return {
                    value: value,
                    label: t('time.range.' + value),
                    selected: value === range
                };
            }),
            function (value) {
                renderViewBar();
                if (value !== range) {
                    var from = RANGES.indexOf(range);
                    var to = RANGES.indexOf(value);
                    range = value;
                    renderList(global.LivologStore.getBehavior(currentId));
                    global.LivologUI.animateEnter(listEl, to >= from ? 1 : -1);
                }
            }
        );
    }

    /** 一条记录的卡片 */
    function buildRecordCard(behavior, record) {
        var card = global.LivologUI.el('li', 'card card-stacked');
        card.dataset.id = record.id;
        // 与时间页共用同一套结构：上行「图标 + 行为名 + 时间」，描述单独占下一行
        card.appendChild(global.LivologTimePage.cardContent(
            behavior.icon,
            behavior.name,
            record
        ));

        if (global.LivologUI.isSelected(record.id)) {
            card.classList.add('is-selected');
        }

        global.LivologUI.attachLongPress(card, function () {
            global.LivologUI.startSelection(record.id);
        });

        card.addEventListener('click', function () {
            if (global.LivologUI.justLongPressed()) {
                return;
            }
            if (global.LivologUI.isSelecting()) {
                global.LivologUI.toggleSelection(record.id);
                return;
            }
            // 与时间页一致：普通点击即可修改这条记录
            global.LivologTimePage.openForm(record);
        });

        return card;
    }

    // --- 统计视图 -----------------------------------------------------------
    //
    // 布局：选项栏（图类型 / 时间范围）→ 图 → 统计信息文本。
    // 图与「按天归集」都走 LivologChart（内联 SVG 手绘，横轴刻度永远是日）。
    // 只有「时刻」记录的行为没有时长可言，此时退化为按天记次数。

    /** 时长格式化：不足 1 小时只显示分钟，正好整点不显示 0 分钟 */
    function formatDuration(ms) {
        var minutes = Math.max(0, Math.round((ms || 0) / 60000));
        var hours = Math.floor(minutes / 60);
        var rest = minutes % 60;

        if (hours <= 0) {
            return rest + t('unit.minute');
        }
        if (rest === 0) {
            return hours + t('unit.hour');
        }
        return hours + t('unit.hour') + ' ' + rest + t('unit.minute');
    }

    /** 统计区间的默认值：最近 30 天，但不早于第一条记录 */
    function defaultRange(records) {
        var bounds = global.LivologChart.rangeOf(records.map(function (record) {
            return record.start;
        }));
        var today = global.LivologDateTime.startOfDay(Date.now());
        var end = Math.max(bounds.end, today);
        var earliest = Math.min(bounds.start, end);
        return { start: Math.max(earliest, end - 29 * DAY_MS), end: end };
    }

    /** 改了一头之后保证 start ≤ end（顺序不对就直接对调） */
    function normalizeRange(range, key, value) {
        var next = { start: range.start, end: range.end };
        next[key] = value;
        if (next.end < next.start) {
            var swap = next.start;
            next.start = next.end;
            next.end = swap;
        }
        return next;
    }

    function renderStats(behavior) {
        var all = global.LivologStore.getRecords().filter(function (record) {
            return record.behaviorId === behavior.id;
        });

        if (!all.length) {
            listEl.appendChild(global.LivologUI.emptyState(t('behavior.detail.statsEmpty')));
            return;
        }

        if (!stats.range) {
            stats.range = defaultRange(all);
        }

        var range = stats.range;
        // 跨天的记录（23:00 → 次日 07:00）只要和区间有重叠就算进来：
        // 只开始那天落在区间里也算，第二天那一段也会被算上。
        var rangeEnd = range.end + DAY_MS;
        var records = all.filter(function (record) {
            var start = record.start;
            var end = record.type === 'period' && record.end !== null ? record.end : start;
            return end >= range.start && start < rangeEnd;
        });

        var totalMs = 0;
        records.forEach(function (record) {
            if (record.type === 'period' && record.end !== null) {
                totalMs += Math.max(0, record.end - record.start);
            }
        });

        /*
           自动纠偏：这个行为**一条时段记录都没有**（totalMs 为 0）时，
           「每日时长」「平均单次时长」这两个选项全是 0，看着像图表坏了。
           默认从 duration 改成 count。
           ⚠️ 只在用户没手动选过、且当前恰好是 duration 时才改 ——
              用户主动选了 duration 就尊重他的选择（他可能正要记录时段）。
        */
        var hasDuration = totalMs > 0;
        if (!hasDuration && stats.metric === 'duration' && !stats.metricPicked) {
            stats.metric = 'count';
        }

        // 注册表负责聚合：横轴可能是日期，也可能是 0-23 点（每小时分布）
        var aggregated = global.LivologStats.metric(stats.metric)
            .aggregate(records, range, global.LivologChart);
        var points = aggregated.points;
        // ⚠️ 「按天平均」的分母是**区间天数**，与 points 长度一致
        var days = points.length;

        var wrap = global.LivologUI.el('li', 'stats');

        var toolbar = global.LivologStats.build({
            getChartType: function () {
                return stats.chartType;
            },
            getMetric: function () {
                return stats.metric;
            },
            getRange: function () {
                return stats.range;
            },
            onChange: function (key, value) {
                if (key === 'chartType') {
                    stats.chartType = value;
                } else if (key === 'metric') {
                    stats.metric = value;
                    // 记下「用户主动选过」，之后不再被自动纠偏覆盖
                    stats.metricPicked = true;
                } else {
                    stats.range = normalizeRange(stats.range, key, value);
                }
                refresh();
            }
        });
        wrap.appendChild(toolbar.root);

        // 值的格式化：按注册表给出的单位来（时长 → 可读时长；次数 → 整数）
        var format = aggregated.unit === 'duration'
            ? function (minutes) {
                return formatDuration(minutes * 60000);
            }
            : function (times) {
                return String(Math.round(times));
            };
        // 气泡第一行：小时分布时显示「N 点」，否则显示日期
        var dayFormat = aggregated.axis === 'hour'
            ? function (hour) {
                return t('stats.hourLabel').replace('{h}', String(hour));
            }
            : global.LivologChart.fullDateLabel;

        var chartBlock = global.LivologUI.el('div', 'stats-chart');
        chartBlock.appendChild(global.LivologUI.el(
            'span',
            'stats-chart-title',
            t(global.LivologStats.metric(stats.metric).label)
        ));
        chartBlock.appendChild(global.LivologChart.build(points, {
            type: stats.chartType,
            axis: aggregated.axis,
            dayFormat: dayFormat,
            format: format
        }));
        wrap.appendChild(chartBlock);

        var list = global.LivologUI.el('dl', 'stats-list');
        [
            [t('behavior.detail.total'), formatDuration(totalMs)],
            [t('behavior.detail.count'), String(records.length)],
            [
                t('behavior.detail.perTime'),
                formatDuration(records.length ? totalMs / records.length : 0)
            ],
            [t('behavior.detail.perDay'), formatDuration(days ? totalMs / days : 0)]
        ].forEach(function (row) {
            list.appendChild(global.LivologUI.el('dt', 'stats-key', row[0]));
            list.appendChild(global.LivologUI.el('dd', 'stats-value', row[1]));
        });
        wrap.appendChild(list);

        listEl.appendChild(wrap);
    }

    // --- 菜单 ---------------------------------------------------------------

    function openActions() {
        menuBtn.setAttribute('aria-expanded', 'true');
        global.LivologUI.openMenu(menuBtn, [
            { value: 'rename', label: t('behavior.menu.rename') },
            { value: 'delete', label: t('behavior.menu.delete'), danger: true }
        ], function (value) {
            menuBtn.setAttribute('aria-expanded', 'false');
            if (value === 'rename') {
                global.LivologBehaviorPage.openEdit(currentId);
            } else {
                openDeleteSheet();
            }
        });
    }

    // --- 删除（输入名称确认） -----------------------------------------------

    function openDeleteSheet() {
        var behavior = global.LivologStore.getBehavior(currentId);
        if (!behavior) {
            return;
        }

        deleteTip.textContent = t('behavior.delete.tip').replace('{name}', behavior.name);
        deleteInput.value = '';
        validateDelete();
        global.LivologUI.openSheet(deleteSheet);
    }

    function validateDelete() {
        var behavior = global.LivologStore.getBehavior(currentId);
        var typed = deleteInput.value.trim();
        deleteConfirm.disabled = !behavior || typed !== behavior.name;
    }

    function confirmDelete() {
        var behavior = global.LivologStore.getBehavior(currentId);
        if (!behavior || deleteInput.value.trim() !== behavior.name) {
            return;
        }

        global.LivologUI.closeSheet();
        // 连带删掉该行为名下的全部时间记录
        global.LivologStore.removeBehaviors([behavior.id]);
        global.LivologUI.toast(t('toast.deleted'));
        close();
    }

    /** 交给 LivologUI 的多选目标：选中态变了就重画列表，删掉的是时间记录 */
    var selection = {
        onSelectionChange: refresh,
        onDelete: function (ids) {
            global.LivologStore.removeRecords(ids);
        }
    };

    global.LivologBehaviorDetail = {
        init: init,
        open: open,
        close: close,
        refresh: refresh,
        selection: selection,
        isOpen: function () {
            return isOpen;
        }
    };
})(window);
