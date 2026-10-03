/**
 * Livolog - 跟踪详情页。
 *
 * 与行为详情页同构：全屏覆盖层 + 标题栏（返回 / 跟踪项名称 / 菜单）+ 视图栏（记录 / 统计）。
 *
 * 区别在**记录视图**：跟踪记录不属于时间记录，加不进时间页，
 * 所以这一页自带一个悬浮按钮作为**唯一**入口，表单是「记录时间 + 每个字段一个值」。
 * 一个跟踪项可以有多个字段（比如血压 = 高压 / 低压 / 脉搏），
 * 卡片显示「字段名 值」的列表，统计图默认看主字段（可在选项里改）。
 * 记录卡片与时间页一样支持长按多选删除。
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
    var recordFab = null;
    var viewBar = null;
    var viewLabel = null;
    var viewButton = null;

    var deleteSheet = null;
    var deleteTip = null;
    var deleteInput = null;
    var deleteConfirm = null;

    var recordSheet = null;
    var recordTitle = null;
    var recordFields = null;
    var recordHint = null;
    var recordValues = [];
    var recordConfirm = null;

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
     * 统计视图的选项：时间区间 + 看哪几个项目。
     *
     * ⚠️ 选中的项目**要记住**（用户 2026-09-22 要求）：以前每次 open() 都重置成
     *    「全部」，切出去再回来选择就没了。现在按跟踪项存进 localStorage，
     *    下次进来还是上次那几个。
     * ⚠️ 时间区间仍然每次重置（见 open()）—— 用户只提了「项目要记忆」。
     */
    var stats = { range: null, series: [] };

    /** 每个跟踪项上次选的项目：{ <metricId>: [fieldId…] }，空数组 = 全部 */
    var SERIES_KEY = 'livolog.metricSeries';

    function loadSeries(metricId) {
        try {
            var raw = global.localStorage.getItem(SERIES_KEY);
            var all = raw ? JSON.parse(raw) : {};
            var picked = all && all[metricId];
            return Array.isArray(picked) ? picked.slice() : [];
        } catch (e) {
            return [];
        }
    }

    function saveSeries(metricId, ids) {
        try {
            var raw = global.localStorage.getItem(SERIES_KEY);
            var all = raw ? JSON.parse(raw) : {};
            if (!all || typeof all !== 'object') {
                all = {};
            }
            if (ids && ids.length) {
                all[metricId] = ids.slice();
            } else {
                delete all[metricId]; // 全选 == 没有筛选，不占空间
            }
            global.localStorage.setItem(SERIES_KEY, JSON.stringify(all));
        } catch (e) {
            /* 隐私模式等情况下写不进去，忽略即可 */
        }
    }

    var group = null;
    var editingRecordId = null;

    function t(key) {
        return global.LivologI18n ? global.LivologI18n.t(key) : key;
    }

    function init() {
        root = document.getElementById('metric-detail');
        titleEl = document.getElementById('metric-detail-title');
        backBtn = document.getElementById('metric-detail-back');
        menuBtn = document.getElementById('metric-detail-menu');
        viewNav = document.getElementById('metric-detail-view-nav');
        listEl = document.getElementById('metric-detail-list');
        recordFab = document.getElementById('metric-record-fab');
        viewBar = document.getElementById('metric-detail-view-bar');
        viewLabel = document.getElementById('metric-detail-view-current');
        viewButton = document.getElementById('metric-detail-view-button');

        deleteSheet = document.getElementById('sheet-delete-metric');
        deleteTip = document.getElementById('metric-delete-tip');
        deleteInput = document.getElementById('metric-delete-input');
        deleteConfirm = document.getElementById('metric-delete-confirm');

        recordSheet = document.getElementById('sheet-metric-record');
        recordTitle = document.getElementById('sheet-metric-record-title');
        recordFields = document.getElementById('metric-record-fields');
        recordHint = document.getElementById('metric-record-hint');
        recordValues = document.getElementById('metric-record-values');
        recordConfirm = document.getElementById('metric-record-confirm');

        backBtn.addEventListener('click', function () {
            close();
        });
        menuBtn.addEventListener('click', openActions);
        viewNav.addEventListener('click', onViewNavClick);
        viewButton.addEventListener('click', openRangeMenu);
        recordFab.addEventListener('click', function () {
            openRecordForm(null);
        });

        document.getElementById('metric-delete-cancel').addEventListener('click', function () {
            global.LivologUI.closeSheet();
        });
        deleteInput.addEventListener('input', validateDelete);
        deleteInput.addEventListener('keydown', function (event) {
            if (event.key === 'Enter') {
                confirmDelete();
            }
        });
        deleteConfirm.addEventListener('click', confirmDelete);

        document.getElementById('metric-record-cancel').addEventListener('click', function () {
            editingRecordId = null;
            global.LivologUI.closeSheet();
        });
        recordConfirm.addEventListener('click', submitRecord);

        // 字段是动态生成的，用委托监听回车提交
        recordValues.addEventListener('keydown', function (event) {
            if (event.key === 'Enter') {
                submitRecord();
            }
        });
        recordValues.addEventListener('input', validateRecord);

        global.LivologMetrics.onChange(refresh);
        if (global.LivologI18n) {
            global.LivologI18n.onChange(function () {
                if (isOpen) {
                    recordTitle.textContent = t(
                        editingRecordId ? 'metric.record.editTitle' : 'metric.record.title'
                    );
                }
                refresh();
            });
        }

        // 系统返回键 / 手势返回等价于点左上角返回
        /*
           系统返回键 / 手势返回会触发 popstate。
           ⚠️ 先让**通用返回层**消化（下拉菜单 / 弹窗 / 图标选择器 / 多选栏），
              它们可能正压在详情页上面。
        */
        global.addEventListener('popstate', function () {
            if (global.LivologUI.handleBack()) {
                global.history.pushState({ livologMetric: currentId }, '');
                return;
            }
            if (isOpen) {
                close({ history: false });
            }
        });
    }

    // --- 打开 / 关闭 --------------------------------------------------------

    function open(id) {
        var metric = global.LivologMetrics.getMetric(id);
        if (!metric || isOpen) {
            return;
        }

        currentId = id;
        currentView = DEFAULT_VIEW;
        range = 'all';
        // 时间区间每次重置，但**选中的项目要记着**（用户要求）
        stats = { range: null, series: loadSeries(id) };

        // 这一页自己当多选目标（长按卡片 → 顶部操作栏 → 删除）
        global.LivologUI.bindSelection(selection);

        isOpen = true;

        root.hidden = false;
        refresh();

        global.requestAnimationFrame(function () {
            root.classList.add('is-open');
        });

        global.history.pushState({ livologMetric: id }, '');
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
        recordFab.hidden = true;

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

        var metric = global.LivologMetrics.getMetric(currentId);
        if (!metric) {
            // 被重命名成别的 id 或已删除
            close();
            return;
        }

        titleEl.textContent = metric.name;
        renderViewNav();
        recordFab.hidden = currentView !== 'records';
        renderList(metric);
    }

    /** 顶栏下方的内嵌视图导航栏（记录 / 统计） */
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

    function renderList(metric) {
        listEl.innerHTML = '';

        // 视图栏只在记录视图显示（统计视图自己有选项栏）
        viewBar.hidden = currentView !== 'records';

        if (currentView === 'stats') {
            renderStats(metric);
            return;
        }

        var records = global.LivologMetrics.getRecords(metric.id).filter(function (record) {
            var days = RANGE_DAYS[range] || 0;
            if (!days) {
                return true;
            }
            var start = global.LivologDateTime.startOfDay(Date.now()) - (days - 1) * DAY_MS;
            return record.time >= start;
        });

        renderViewBar();

        if (!records.length) {
            listEl.appendChild(global.LivologUI.emptyState(t('metric.detail.empty')));
            return;
        }

        // 与时间页同一个分段逻辑：按天插日期标记
        global.LivologTimePage.appendRecordCards(
            listEl,
            records,
            function (record) {
                return buildRecordCard(metric, record);
            },
            function (record) {
                return record.time;
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
                    renderList(global.LivologMetrics.getMetric(currentId));
                    global.LivologUI.animateEnter(listEl, to >= from ? 1 : -1);
                }
            }
        );
    }

    /** 一条记录的卡片 */
    function buildRecordCard(metric, record) {
        var card = global.LivologUI.el('li', 'card');
        card.dataset.id = record.id;
        card.appendChild(global.LivologUI.icon(metric.icon, 'card-icon'));

        // 左边：项目名 + 值（只有一个项目时就是单纯的数值）
        var body = global.LivologUI.el('div', 'card-body');
        metric.fields.forEach(function (field) {
            var value = global.LivologMetrics.valueOf(record, field.id, metric.id);
            var line = global.LivologUI.el('span', 'card-value-line');
            if (metric.fields.length > 1) {
                line.appendChild(global.LivologUI.el('span', 'card-value-key', field.name));
            }
            line.appendChild(global.LivologUI.el(
                'span',
                'card-title',
                value === null ? '—' : formatValue(value)
            ));
            body.appendChild(line);
        });
        card.appendChild(body);

        var time = global.LivologUI.el('span', 'card-time');
        time.appendChild(global.LivologUI.el(
            'span', 'card-time-date', global.LivologDateTime.formatDate(record.time)
        ));
        time.appendChild(global.LivologUI.el(
            'span', 'card-time-clock', global.LivologDateTime.formatClock(record.time)
        ));
        card.appendChild(time);

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
            // 普通点击 = 修改这条记录
            openRecordForm(record);
        });

        return card;
    }

    /** 数值去掉多余的小数位：72.50 → 72.5，1500 → 1500 */
    function formatValue(value) {
        var number = Number(value);
        if (!isFinite(number)) {
            return '—';
        }
        return String(Math.round(number * 1000) / 1000);
    }

    // --- 统计视图 -----------------------------------------------------------
    //
    // 布局：选项栏（图类型 / 时间范围）→ 图 → 统计信息文本。
    // 纵坐标 = 每天的取值合计，横轴刻度永远是日。

    /**
     * 统计区间的默认值：**有记录的最早时间 → 最晚时间**（用户 2026-09-22 要求）。
     * 以前是「最近 30 天」（还不早于第一条记录），但这样早期的记录默认看不到，
     * 用户还得手动把开始时间往前拨。现在默认就把全部记录框进来。
     */
    function defaultRange(records) {
        var bounds = global.LivologChart.rangeOf(records.map(function (record) {
            return record.time;
        }));
        return { start: bounds.start, end: bounds.end };
    }

    /** 改了一头之后保证 start ≤ end */
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

    /*
       多项目时的线型表。
       ⚠️ 组合顺序是**「形状外层循环 × 虚实内层循环」**（用户 2026-09-22 明确要求）：
           第 1 个项目 = 圆点实线
           第 2 个       = 圆点虚线
           第 3 个       = 方点实线
           第 4 个       = 方点虚线
           第 5 个       = 三角实线
           …以此类推，形状用尽再换下一个形状。
          这样相邻两条线的形状一定不同，比「先排完虚实再换形状」好认得多。
       ⚠️ 虚线只有**一种**（用户要求：花式虚线肉眼分不清），区分靠形状。
    */
    var MARKER_SHAPES = ['circle', 'square', 'triangle', 'diamond', 'cross'];

    var SERIES_STYLES = [];
    MARKER_SHAPES.forEach(function (shape) {
        SERIES_STYLES.push({ dash: null, marker: shape });
        SERIES_STYLES.push({ dash: '6 4', marker: shape });
    });

    /** 第 i 条线的样式 {dash, marker} */
    function styleOf(index) {
        return SERIES_STYLES[index % SERIES_STYLES.length];
    }

    function dashOf(index) {
        return styleOf(index).dash;
    }

    function markerOf(index) {
        return styleOf(index).marker;
    }

    /**
     * 图内图例：每条线一个「线型样例 + 项目名」，画在图表块里、图的下面。
     * 样例线的颜色 / 虚实 / 标记形状都要和真正的线一致，否则图例没意义。
     */
    function buildLegend(metric, chosen) {
        var legend = global.LivologUI.el('div', 'chart-legend');
        chosen.forEach(function (field) {
            var index = metric.fields.indexOf(field);
            var style = styleOf(index < 0 ? 0 : index);

            var entry = global.LivologUI.el('span', 'chart-legend-entry');
            var swatch = document.createElementNS(
                'http://www.w3.org/2000/svg', 'svg'
            );
            swatch.setAttribute('class', 'chart-legend-swatch');
            // 比线本身高一些，否则中间的标记会被上下裁掉
            swatch.setAttribute('viewBox', '0 -4 24 16');
            swatch.setAttribute('aria-hidden', 'true');

            var line = document.createElementNS(
                'http://www.w3.org/2000/svg', 'line'
            );
            line.setAttribute('x1', '0');
            line.setAttribute('y1', '4');
            line.setAttribute('x2', '24');
            line.setAttribute('y2', '4');
            if (style.dash) {
                line.setAttribute('stroke-dasharray', style.dash);
            }
            swatch.appendChild(line);

            // 图例样例线上也画一个同形状的小标记，和真实折线一致
            swatch.insertAdjacentHTML('beforeend',
                global.LivologChart.marker(style.marker, index, 12, 4));
            entry.appendChild(swatch);
            entry.appendChild(global.LivologUI.el('span', 'chart-legend-name', field.name));
            legend.appendChild(entry);
        });
        return legend;
    }

    function renderStats(metric) {
        var all = global.LivologMetrics.getRecords(metric.id);
        if (!all.length) {
            listEl.appendChild(global.LivologUI.emptyState(t('metric.detail.statsEmpty')));
            return;
        }

        if (!stats.range) {
            stats.range = defaultRange(all);
        }

        var fields = metric.fields;
        var range = stats.range;
        var records = all.filter(function (record) {
            var day = global.LivologDateTime.startOfDay(record.time);
            return day >= range.start && day <= range.end;
        });

        /*
           只画「选中的项目」；一个都没选（stats.series 为空数组）= 全部。
           ⚠️ 记忆下来的 id 可能已经被删掉 / 改名换成新 id 了，所以先过滤成
              「当前还存在的字段 id」，过滤完为空就当作「全部」，
              否则会画出个空图或者跟界面上显示的选择对不上。
        */
        var remembered = stats.series.filter(function (id) {
            return fields.some(function (field) {
                return field.id === id;
            });
        });
        if (remembered.length !== stats.series.length) {
            stats.series = remembered;
            saveSeries(metric.id, remembered);
        }

        var chosen = fields.filter(function (field) {
            return !stats.series.length || stats.series.indexOf(field.id) >= 0;
        });
        if (!chosen.length) {
            chosen = fields.slice();
        }

        /*
           每个项目一条折线，横轴上**一条记录一个点**（用户 2026-09-22 要求）。
           ⚠️ 以前是「按天聚合、一天一个点」，于是同一天记两次就只剩一个点，
              两条记录根本连不成线段（用户报「两个记录画不出折线」就是这个）。
              现在按记录逐条排队，两点就能连成线段。
           某个项目在某条记录上没有值 → 那个位置标记 has:false，折线跨过去（不断线）。
        */
        var ordered = records.slice().sort(function (a, b) {
            return a.time - b.time;
        });

        var series = chosen.map(function (field) {
            // 线型 / 标记按「在跟踪项字段里的位置」定，这样取消/勾选项目时同一条线的样式不变
            var index = metric.fields.indexOf(field);
            return {
                name: field.name,
                dash: dashOf(index < 0 ? 0 : index),
                marker: markerOf(index < 0 ? 0 : index),
                points: ordered.map(function (record) {
                    var value = global.LivologMetrics.valueOf(record, field.id, metric.id);
                    return {
                        day: record.time,
                        value: value === null ? 0 : value,
                        has: value !== null
                    };
                })
            };
        });

        // 横轴上每个点对应一条记录；一条都没落在区间里时给个占位
        var days = ordered.length ? ordered.map(function (record) {
            return { day: record.time };
        }) : [{ day: range.start }];

        var wrap = global.LivologUI.el('li', 'stats');

        var toolbar = global.LivologStats.build({
            getChartType: function () {
                return 'line';
            },
            getRange: function () {
                return stats.range;
            },
            /*
               ⚠️ 跟踪统计**只有一种统计类型**：「每次记录的值」。
                  所以显式传一个单元素列表 —— 选项栏据此**不显示**「统计类型」那一行
                  （`availableMetrics.length > 1` 才显示），
                  也顺便避免注册表里新增类型时这里跟着冒出一堆不适用的选项
                  （时长 / 次数那套对跟踪数据没有意义）。
            */
            getMetric: function () {
                return 'value';
            },
            getMetricIds: function () {
                return ['value'];
            },
            // 统一用折线图，所以不再给「图类型」这一行
            lockChartType: true,
            // 第一行：选看哪几个项目（多项目才显示）
            getSeries: function () {
                return fields.length > 1 ? fields : null;
            },
            getSelectedSeries: function () {
                return stats.series;
            },
            onChange: function (key, value) {
                if (key === 'series') {
                    stats.series = value;
                    saveSeries(metric.id, value);
                } else if (key !== 'field' && key !== 'chartType') {
                    stats.range = normalizeRange(stats.range, key, value);
                }
                refresh();
            }
        });
        wrap.appendChild(toolbar.root);

        var chartBlock = global.LivologUI.el('div', 'stats-chart');
        chartBlock.appendChild(global.LivologUI.el(
            'span', 'stats-chart-title', t('metric.detail.chartDaily')
        ));
        chartBlock.appendChild(global.LivologChart.buildMulti(days, series, {
            // 气泡第一行是哪一天，下面才逐项列值
            dayFormat: global.LivologChart.fullDateLabel,
            // 气泡里每行一个项目：写「项目名 值」，多项目时才带名字
            format: function (value, name) {
                return chosen.length > 1 && name
                    ? name + ' ' + formatValue(value)
                    : formatValue(value);
            }
        }));
        // 图例画在图里面（图下方），不再单独占工具栏一行
        if (chosen.length > 1) {
            chartBlock.appendChild(buildLegend(metric, chosen));
        }
        wrap.appendChild(chartBlock);

        // 统计信息只针对「主项目」（多项目量纲不同，混在一起算没有意义）
        var primary = global.LivologMetrics.primaryField(metric);
        var ordered = records.filter(function (record) {
            return global.LivologMetrics.valueOf(record, primary.id, metric.id) !== null;
        }).slice().sort(function (a, b) {
            return a.time - b.time;
        });

        var total = 0;
        var max = -Infinity;
        var min = Infinity;
        ordered.forEach(function (record) {
            var value = global.LivologMetrics.valueOf(record, primary.id, metric.id);
            total += value;
            if (value > max) max = value;
            if (value < min) min = value;
        });

        var latest = ordered.length
            ? global.LivologMetrics.valueOf(ordered[ordered.length - 1], primary.id, metric.id)
            : null;

        var list = global.LivologUI.el('dl', 'stats-list');
        [
            // 统计口径写在最前面，免得误以为是把所有项目混在一起算的
            [t('metric.detail.formula'), primary.name],
            [t('metric.detail.count'), String(ordered.length)],
            [t('metric.detail.latest'), latest === null ? '—' : formatValue(latest)],
            [
                t('metric.detail.average'),
                ordered.length ? formatValue(total / ordered.length) : '—'
            ],
            [t('metric.detail.max'), ordered.length ? formatValue(max) : '—'],
            [t('metric.detail.min'), ordered.length ? formatValue(min) : '—']
        ].forEach(function (row) {
            list.appendChild(global.LivologUI.el('dt', 'stats-key', row[0]));
            list.appendChild(global.LivologUI.el('dd', 'stats-value', row[1]));
        });
        wrap.appendChild(list);

        listEl.appendChild(wrap);
    }

    // --- 记录表单（唯一入口） -----------------------------------------------

    /**
     * @param {object|null} record 传了就是修改已有记录
     */
    function openRecordForm(record) {
        if (!currentId) {
            return;
        }

        var metric = global.LivologMetrics.getMetric(currentId);
        if (!metric) {
            return;
        }

        editingRecordId = record && record.id ? record.id : null;
        var at = editingRecordId ? record.time : Date.now();

        recordFields.innerHTML = '';
        // 时间只有「什么时候记的」一种含义，给个提示文字与下面的字段标签对齐
        group = global.LivologDateTime.buildGroup(t('time.form.happen'), at, validateRecord);
        recordFields.appendChild(group.root);

        // 每个字段一块「标签 + 输入框」，上下排：
        // 一行一个字段名 + 右对齐的输入框会让几行标签左沿参差不齐（名字长短不一），
        // 上下排则所有输入框都与上面的时间 / 名称对齐。
        recordValues.innerHTML = '';
        recordValueInputs = {};
        metric.fields.forEach(function (field) {
            var block = global.LivologUI.el('div', 'form-row form-row-stacked');
            block.appendChild(global.LivologUI.el('label', 'form-label', field.name));
            var input = document.createElement('input');
            input.className = 'form-input';
            input.type = 'text';
            input.inputMode = 'decimal';
            input.autocomplete = 'off';
            input.dataset.fieldId = field.id;
            input.placeholder = t('metric.record.valuePlaceholder');
            var existing = editingRecordId
                ? global.LivologMetrics.valueOf(record, field.id, metric.id)
                : null;
            input.value = existing === null ? '' : formatValue(existing);
            block.appendChild(input);
            recordValues.appendChild(block);
            recordValueInputs[field.id] = input;
        });

        recordTitle.textContent = t(
            editingRecordId ? 'metric.record.editTitle' : 'metric.record.title'
        );

        validateRecord();
        global.LivologUI.openSheet(recordSheet);
    }

    /** 表单里每个字段的输入框，按字段 id 索引 */
    var recordValueInputs = {};

    /** 读表单：返回 {fieldId: 值字符串}，只收有内容的 */
    function readRecordValues() {
        var out = {};
        var any = false;
        var invalid = false;
        Object.keys(recordValueInputs).forEach(function (fieldId) {
            var text = recordValueInputs[fieldId].value.trim();
            if (!text) {
                return;
            }
            var number = Number(text);
            if (!isFinite(number)) {
                invalid = true;
                return;
            }
            out[fieldId] = number;
            any = true;
        });
        return { values: out, any: any, invalid: invalid };
    }

    function validateRecord() {
        var time = group ? global.LivologDateTime.toTimestamp(
            global.LivologDateTime.readGroup(group)
        ) : null;
        var read = readRecordValues();

        var hint = '';
        if (time === null) {
            hint = t('metric.record.invalidTime');
        } else if (read.invalid) {
            hint = t('metric.record.invalidValue');
        } else if (!read.any) {
            hint = t('metric.record.invalidValue');
        }

        recordHint.textContent = hint;
        recordHint.hidden = !hint;
        recordConfirm.disabled = !!hint;

        return { ok: !hint, time: time, values: read.values };
    }

    function submitRecord() {
        var result = validateRecord();
        if (!result.ok || !currentId) {
            return;
        }

        if (editingRecordId) {
            global.LivologMetrics.updateRecord(
                editingRecordId, currentId, result.time, result.values
            );
        } else {
            global.LivologMetrics.addRecord(currentId, result.time, result.values);
        }

        editingRecordId = null;
        global.LivologUI.closeSheet();
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
                global.LivologMetricPage.openEdit(currentId);
            } else {
                openDeleteSheet();
            }
        });
    }

    // --- 删除（输入名称确认） -----------------------------------------------

    function openDeleteSheet() {
        var metric = global.LivologMetrics.getMetric(currentId);
        if (!metric) {
            return;
        }

        deleteTip.textContent = t('metric.delete.tip').replace('{name}', metric.name);
        deleteInput.value = '';
        validateDelete();
        global.LivologUI.openSheet(deleteSheet);
    }

    function validateDelete() {
        var metric = global.LivologMetrics.getMetric(currentId);
        deleteConfirm.disabled = !metric || deleteInput.value.trim() !== metric.name;
    }

    function confirmDelete() {
        var metric = global.LivologMetrics.getMetric(currentId);
        if (!metric || deleteInput.value.trim() !== metric.name) {
            return;
        }

        global.LivologUI.closeSheet();
        // 连带删掉该跟踪项名下的全部记录
        global.LivologMetrics.removeMetrics([metric.id]);
        global.LivologUI.toast(t('toast.deleted'));
        close();
    }

    /** 交给 LivologUI 的多选目标：选中态变了就重画列表，删掉的是跟踪记录 */
    var selection = {
        onSelectionChange: refresh,
        onDelete: function (ids) {
            global.LivologMetrics.removeRecords(ids);
        }
    };

    global.LivologMetricDetail = {
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
