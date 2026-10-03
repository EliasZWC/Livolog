/**
 * Livolog - 统计视图的选项栏。
 *
 * 三到四行：统计类型（累积量 / 单次时长 / 每小时分布…）、图类型（直方图 / 折线图）、
 * 时间范围（开始 / 结束）、以及多字段跟踪时的「展示哪个值」。
 * 样式直接复用设置页的「左名称 / 右值」行，所以看起来和其它地方一致。
 * 起止时间是同一件事的两端，所以合成一个选项：左边标签、右边开始 / 结束上下两行。
 */
(function (global) {
    'use strict';

    var TYPES = ['bar', 'line'];

    /*
       ------------------------------------------------------------------------
       统计类型（v0.1.28）

       ⚠️ 设计成**注册表**，因为用户明确说「之后想到新的需要时再增加」。
          新增一项只需要：
            1. 在 `METRICS` 里加一条（含 i18n 标签 key + 聚合函数）
            2. 在 i18n 的 en/zh 里各加一条 `stats.metric.<id>`
          选项栏、图表渲染都会自动跟上，不用改别处。

       每条聚合函数的签名：
           aggregate(records, range) -> {
               points: [{day, value, has}],   // 横轴数据，交给 chart.js
               axis:   'day' | 'hour',        // 横轴是日期还是小时
               unit:   'duration' | 'count',  // 值的单位，决定格式化方式
           }

       ⚠️ `range` 是 {start, end} 的绝对时刻，闭区间按天理解。
       ⚠️ 时段（period）跨天要按实际重叠比例分摊，用 `chart.bucketSpans`；
          时点（moment）没有时长，只有次数。
    */
    var METRICS = {
        /*
           ⚠️ 跟踪统计专用：只作为**标签**存在，`aggregate` 不会被调用
              （跟踪数据的聚合在 `page-metric-detail.js` 里，因为要处理多字段 / 多序列）。
              放在注册表里是为了让「统计类型」那一行有统一的取值来源，
              并且让跟踪页可以用 `getMetricIds: () => ['value']` 明确表示
              「我只有一种统计类型」→ 选项栏自动不显示这一行。
        */
        value: {
            label: 'stats.metric.value',
            unit: 'number',
            axis: 'day',
            aggregate: null
        },

        // 每天的时间总和（只有时段记录才有意义）
        duration: {
            label: 'stats.metric.duration',
            unit: 'duration',
            axis: 'day',
            aggregate: function (records, range, chart) {
                var spans = records.map(function (record) {
                    if (record.type === 'period' && record.end !== null) {
                        return {
                            start: record.start,
                            end: record.end,
                            value: Math.max(0, record.end - record.start) / 60000
                        };
                    }
                    // 时点不占时长，但那一天要算作「有数据」
                    return { start: record.start, end: null, value: 0 };
                });
                return { points: chart.bucketSpans(spans, range), axis: 'day', unit: 'duration' };
            }
        },

        // 每天的记录条数
        count: {
            label: 'stats.metric.count',
            unit: 'count',
            axis: 'day',
            aggregate: function (records, range, chart) {
                var spans = records.map(function (record) {
                    return { start: record.start, end: null, value: 1 };
                });
                return { points: chart.bucketSpans(spans, range), axis: 'day', unit: 'count' };
            }
        },

        // 每天的**平均单次时长** = 当天总时长 / 当天记录条数
        // ⚠️ 分母用「当天的原始记录条数」，不是「当天有值的点数」——
        //    时点记录时长算 0 但确实占了一次，混在平均里才能反映真实均值。
        average: {
            label: 'stats.metric.average',
            unit: 'duration',
            axis: 'day',
            aggregate: function (records, range, chart) {
                var totals = {};
                var counts = {};

                records.forEach(function (record) {
                    var day = clock().startOfDay(record.start);
                    counts[day] = (counts[day] || 0) + 1;
                    if (record.type === 'period' && record.end !== null) {
                        totals[day] = (totals[day] || 0) + Math.max(0, record.end - record.start) / 60000;
                    } else if (totals[day] === undefined) {
                        totals[day] = 0;
                    }
                });

                var spans = records.map(function (record) {
                    return { start: record.start, end: null, value: 0 };
                });
                var points = chart.bucketSpans(spans, range);
                points.forEach(function (point) {
                    var day = clock().startOfDay(point.day);
                    var n = counts[day] || 0;
                    point.value = n ? (totals[day] || 0) / n : 0;
                    point.has = n > 0;
                });
                return { points: points, axis: 'day', unit: 'duration' };
            }
        },

        // 每条记录各自的时长（不按天合并）—— 用来发现某一次特别长 / 特别短
        // ⚠️ 横轴是「记录发生时刻」而不是日期：同一天多条会有多个点，
        //    这正是想要的效果（看出单次差异）。时点记录时长为 0，会被 0 高度柱表示。
        each: {
            label: 'stats.metric.each',
            unit: 'duration',
            axis: 'day',
            aggregate: function (records, range, chart) {
                var ordered = records.slice().sort(function (a, b) {
                    return a.start - b.start;
                });
                var points = ordered.map(function (record) {
                    var minutes = (record.type === 'period' && record.end !== null)
                        ? Math.max(0, record.end - record.start) / 60000
                        : 0;
                    return { day: record.start, value: minutes, has: true };
                });
                return { points: points, axis: 'day', unit: 'duration' };
            }
        },

        // 每小时时间分布：把一天切成 24 格，看几点钟在做什么
        // ⚠️ 横轴是 **0-23 点**，不是日期 —— 所以这一项与「时间范围」无关时
        //    仍然会按范围过滤记录，但画出来永远是 24 根柱。
        hourly: {
            label: 'stats.metric.hourly',
            unit: 'duration',
            axis: 'hour',
            aggregate: function (records, range, chart) {
                var buckets = [];
                var i;
                for (i = 0; i < 24; i++) {
                    buckets.push({ hour: i, minutes: 0, count: 0 });
                }

                var anyDuration = false;
                records.forEach(function (record) {
                    if (record.type === 'period' && record.end !== null) {
                        anyDuration = true;
                    }
                });

                records.forEach(function (record) {
                    if (!anyDuration) {
                        // 全是时点：按次数分布
                        buckets[clock().parts(record.start).hour].count += 1;
                        return;
                    }
                    var from = record.start;
                    var to = (record.type === 'period' && record.end !== null)
                        ? record.end
                        : record.start;
                    // 逐小时切片累加，跨天/跨小时都能正确分摊
                    var cursor = from;
                    while (cursor < to) {
                        var at = clock().parts(cursor);
                        var hourEnd = clock().stamp(
                            at.year, at.month, at.day, at.hour, 0
                        ) + 3600000;
                        var sliceEnd = Math.min(hourEnd, to);
                        buckets[at.hour].minutes += (sliceEnd - cursor) / 60000;
                        cursor = sliceEnd;
                    }
                });

                var points = buckets.map(function (bucket) {
                    return {
                        day: bucket.hour,
                        value: anyDuration ? bucket.minutes : bucket.count,
                        has: anyDuration ? bucket.minutes > 0 : bucket.count > 0
                    };
                });
                return {
                    points: points,
                    axis: 'hour',
                    unit: anyDuration ? 'duration' : 'count'
                };
            }
        }
    };

    /** 时钟（时间口径的唯一来源，别直接用 new Date 的本地字段） */
    function clock() {
        return global.LivologClock;
    }

    /** 按 id 取一条统计类型；未知 id 回退到第一条，避免旧偏好把图表搞崩 */
    function metric(id) {
        return METRICS[id] || METRICS.duration;
    }

    /**
     * 可用于**行为（时间记录）**统计的类型 id，顺序就是菜单里的顺序。
     *
     * ⚠️ 排除 `value`：那是跟踪统计专用的标签项，`aggregate` 为 null，
     *    列进行为统计的菜单会引起误导（选了没反应）甚至报错。
     */
    function metricIds() {
        return Object.keys(METRICS).filter(function (id) {
            return !!METRICS[id].aggregate;
        });
    }

    function t(key) {
        return global.LivologI18n ? global.LivologI18n.t(key) : key;
    }

    /**
     * 「左名称 / 右值 + 下拉箭头」的一行。
     * ⚠️ 箭头是必须的（用户 2026-09-22 要求）：右边的值本身看不出可以点，
     *    得给个 ▾ 才像个下拉。项目选择行与图类型行都用它。
     */
    function row(label, valueEl, onOpen) {
        var item = global.LivologUI.el('li', 'setting-item');
        var button = global.LivologUI.el('button', 'setting-action');
        button.type = 'button';
        button.setAttribute('aria-haspopup', 'menu');
        button.setAttribute('aria-expanded', 'false');
        button.appendChild(global.LivologUI.el('span', 'setting-label', label));
        button.appendChild(valueEl);
        button.appendChild(chevron());
        button.addEventListener('click', function () {
            onOpen(button);
        });
        item.appendChild(button);
        return item;
    }

    /**
     * 下拉箭头（纯装饰）。
     * 直接内联一段三角，不走图标库 —— 图标库是给用户选的「业务图标」，
     * 这种 UI 装饰不该占用图标名额，也不受用户改图标库影响。
     */
    function chevron() {
        var span = global.LivologUI.el('span', 'setting-chevron');
        span.setAttribute('aria-hidden', 'true');
        span.innerHTML = '<svg viewBox="0 0 24 24" focusable="false">' +
            '<path d="M7 10l5 5 5-5z"/></svg>';
        return span;
    }

    /**
     * @param {object} config
     *   getChartType: () => 'bar' | 'line'
     *   getRange:     () => {start: number, end: number}
     *   onChange:     (key: 'chartType'|'metric'|'start'|'end'|'series', value) => void
     *   getMetric:    () => string           当前统计类型的 id
     *   getMetricIds?: () => string[]        允许选择的统计类型（默认全部）
     *   getSeries?:   () => [{id, name}] | null
     *                 多项目跟踪时用来选「看哪几个项目」；单选时传 null
     *   getSelectedSeries?: () => string[]   当前选中的项目 id（空数组 = 全部）
     *   lockChartType?: boolean  true 则不显示「图类型」行（只有折线图这一种）
     * @returns {{root: HTMLElement, refresh: () => void}}
     */
    function build(config) {
        var list = global.LivologUI.el('ul', 'setting-list stats-options');
        var metricValue = global.LivologUI.el('span', 'setting-value');
        var chartValue = global.LivologUI.el('span', 'setting-value');

        /*
           多项目跟踪：第一行是「选哪几个项目」，默认 All。
           菜单只有两个选项 —— All / Select…；点 Select… 弹居中模态的勾选清单
           （用户 2026-09-22 明确要求这个交互，替代原来直接列项目的做法）。
           range 固定在第二行。
        */
        var series = config.getSeries ? config.getSeries() : null;
        var seriesValue = global.LivologUI.el('span', 'setting-value');
        if (series && series.length > 1) {
            list.appendChild(row(t('stats.series'), seriesValue,
                function (anchor) {
                    anchor.setAttribute('aria-expanded', 'true');
                    var selected = config.getSelectedSeries ? config.getSelectedSeries() : [];
                    var all = !selected.length;
                    global.LivologUI.openMenu(anchor, [
                        { value: '__all__', label: t('stats.series.all'), selected: all },
                        { value: '__pick__', label: t('stats.series.pick'), selected: !all }
                    ], function (value) {
                        anchor.setAttribute('aria-expanded', 'false');
                        if (value === '__all__') {
                            config.onChange('series', []);
                            return;
                        }
                        global.LivologUI.openChecklist({
                            title: t('stats.series.pick'),
                            allLabel: t('stats.series.all'),
                            confirmLabel: t('action.confirm'),
                            cancelLabel: t('action.cancel'),
                            items: series.map(function (entry) {
                                return {
                                    id: entry.id,
                                    label: entry.name,
                                    checked: all || selected.indexOf(entry.id) >= 0
                                };
                            }),
                            onConfirm: function (ids) {
                                config.onChange('series', ids);
                            }
                        });
                    });
                }));
        }

        /*
           ⚠️ 「统计类型」放在「图类型」**前面**（用户 2026-10-03 明确要求）：
              「图类别不变，但在此之前增加一个新项」。
              顺序上先定「画什么量」，再定「怎么画」，符合从上到下的决策顺序。
        */
        var availableMetrics = config.getMetricIds ? config.getMetricIds() : metricIds();
        if (availableMetrics.length > 1) {
            list.appendChild(row(t('stats.metric'), metricValue, function (anchor) {
                anchor.setAttribute('aria-expanded', 'true');
                var current = config.getMetric();
                global.LivologUI.openMenu(
                    anchor,
                    availableMetrics.map(function (id) {
                        return {
                            value: id,
                            label: t(metric(id).label),
                            selected: id === current
                        };
                    }),
                    function (value) {
                        anchor.setAttribute('aria-expanded', 'false');
                        config.onChange('metric', value);
                    }
                );
            }));
        }

        // 图类型：只有确实支持多种时才给这一行（跟踪统计固定折线图，不给）
        if (!config.lockChartType) {
            list.appendChild(row(t('stats.chartType'), chartValue, function (anchor) {
                anchor.setAttribute('aria-expanded', 'true');
                global.LivologUI.openMenu(
                    anchor,
                    TYPES.map(function (type) {
                        return {
                            value: type,
                            label: t('stats.chartType.' + type),
                            selected: type === config.getChartType()
                        };
                    }),
                    function (value) {
                        anchor.setAttribute('aria-expanded', 'false');
                        config.onChange('chartType', value);
                    }
                );
            }));
        }

        /*
           起止时间合成一个选项：**开始贴左、结束贴右**（用户 2026-09-22 要求）。
           不要左侧的「Range」标签 —— 这一行本身就是一个日期区间，说明文字是多余的；
           两端各占一边也正好让「从…到…」的语义一眼看出来。两端各自可点。
        */
        var rangeItem = global.LivologUI.el('li', 'setting-item stats-range');
        var rangeValues = global.LivologUI.el('div', 'stats-range-values');
        var startValue = timeButton('stats.pickStart', 'start');
        var endValue = timeButton('stats.pickEnd', 'end');
        startValue.classList.add('is-start');
        endValue.classList.add('is-end');
        rangeValues.appendChild(startValue);
        rangeValues.appendChild(endValue);
        rangeItem.appendChild(rangeValues);
        list.appendChild(rangeItem);

        // 两个时间各自可点，点了打开自己的日期选择；
        // 值后面跟一个箭头，因为光看日期看不出这一行能点
        function timeButton(titleKey, key) {
            var button = global.LivologUI.el('button', 'stats-range-time');
            button.type = 'button';
            button.appendChild(global.LivologUI.el('span', 'stats-range-date'));
            button.appendChild(chevron());
            button.addEventListener('click', function () {
                global.LivologDatePicker.open({
                    title: t(titleKey),
                    value: config.getRange()[key],
                    onPick: function (ms) {
                        config.onChange(key, ms);
                    }
                });
            });
            return button;
        }

        /**
         * 第一行的值：没筛选时显示 All，筛了就显示选中的项目名（逗号分隔）。
         * 不再拼「全部 + 名字」那种混合串 —— 用户要求只有 All / Select 两种状态。
         */
        function seriesLabel() {
            if (!series || series.length <= 1) {
                return '';
            }
            var selected = config.getSelectedSeries ? config.getSelectedSeries() : [];
            if (!selected.length || selected.length === series.length) {
                return t('stats.series.all');
            }
            var names = [];
            series.forEach(function (entry) {
                if (selected.indexOf(entry.id) >= 0) {
                    names.push(entry.name);
                }
            });
            return names.join(', ');
        }

        function refresh() {
            var range = config.getRange();
            if (availableMetrics.length > 1) {
                metricValue.textContent = t(metric(config.getMetric()).label);
            }
            if (!config.lockChartType) {
                chartValue.textContent = t('stats.chartType.' + config.getChartType());
            }
            startValue.querySelector('.stats-range-date').textContent =
                global.LivologDateTime.formatDate(range.start);
            endValue.querySelector('.stats-range-date').textContent =
                global.LivologDateTime.formatDate(range.end);
            // 「选项目」那一行的值
            if (series && series.length > 1) {
                seriesValue.textContent = seriesLabel();
            }
        }

        refresh();

        return { root: list, refresh: refresh };
    }

    global.LivologStats = {
        build: build,
        // 统计类型注册表：`page-behavior-detail` 用它做聚合，别处不要各自复制一份
        metric: metric,
        metricIds: metricIds
    };
})(window);
