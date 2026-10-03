/**
 * Livolog - 统计图。
 *
 * 用内联 SVG 手绘，不引第三方图表库；颜色全部走 CSS 变量，跟随主题。
 * 横坐标刻度**永远是日**；纵坐标由调用方决定含义（时长 / 次数 / 取值）。
 *
 * 两种图：
 *   - 直方图 bar ：纵轴从 0 起，适合「每天累计了多少」
 *   - 折线图 line：纵轴按数据的最小/最大取值铺开，适合看走势（比如体重）；
 *     没记录的那几天直接跨过去（连到上一个数据点），不会把「没数据」画成 0、也不断开
 */
(function (global) {
    'use strict';

    var WIDTH = 320;
    var HEIGHT = 170;
    /*
       ⚠️ 左右内边距必须相等，否则「绘图区」会偏（SVG 本身撑满宽度、居中，
          但绘图区是从 PAD_X 画到 WIDTH-PAD_X 的）。
          左边要放纵轴刻度数字（text-anchor: end，贴在 PAD_X - 6 处），
          所以要按最长刻度留够 —— 像 130.48 这种带小数的值有 6 个字符，
          窄了会被裁掉前面几位（曾经 PAD_X=26 就裁成 "0.48"）。
    */
    var PAD_X = 38;
    var PAD_TOP = 14;
    var PAD_BOTTOM = 26;
    var DAY_MS = 24 * 60 * 60 * 1000;

    /** 词条查找（气泡里的周几要跟着语言变），没加载 i18n 时退回 key 本身 */
    function t(key) {
        return global.LivologI18n && global.LivologI18n.t
            ? global.LivologI18n.t(key)
            : key;
    }

    /**
     * 数据点标记的半径（viewBox 单位）。
     * ⚠️ 320×170 的 viewBox 在手机上会被缩到 300 多 px 显示，2.6 单位画出来
     *    只有几个物理像素，几种形状根本分不出来（用户 2026-09-22 反馈「点太小」）。
     *    4.2 在真机上约 8~9 物理像素，形状能看清，又不至于把折线糊住。
     */
    var MARKER_SIZE = 4.2;

    /** 取某个时间戳所在自然日的零点（按设置里的时区口径） */
    function startOfDay(ms) {
        return global.LivologClock.startOfDay(ms);
    }

    /** 横轴刻度：月-日（不补零，窄屏更省空间） */
    function dateLabel(ms) {
        var p = global.LivologClock.parts(ms);
        return p.month + '-' + p.day;
    }

    /**
     * 气泡日期行：`2026-09-20 周日`。
     * ⚠️ 全 app 的日期一律 `YYYY-MM-DD`（`LivologClock.formatDate`），
     *    这里也必须照这个写 —— 我 v0.1.20 新加时随手写成了 `09/20`，被用户指出。
     *    横轴刻度（`dateLabel`）另有约定：只写 `9-20`，因为窄屏放不下三个完整日期。
     */
    function fullDateLabel(ms) {
        var weekday = global.LivologClock.parts(ms).weekday;
        return global.LivologClock.formatDate(ms) + ' ' + t('weekday.' + weekday);
    }

    function tickLabel(value) {
        return String(Math.round(value * 100) / 100);
    }

    /**
     * 横轴刻度文案。
     *
     * ⚠️ 两种横轴：
     *    - `day`（默认）：`day` 是时间戳 → 走 `dateLabel`（`9-20`）或 `axisLabel`
     *    - `hour`：`day` 其实是 0-23 的**小时序号**，不能传给 `dateLabel`
     *      （否则会被当成 1970 年的某个时间戳，标出莫名其妙的日期）。
     */
    function axisTickLabel(value, axis, axisLabel) {
        if (axisLabel) {
            return axisLabel(value);
        }
        return axis === 'hour' ? value + ':00' : dateLabel(value);
    }

    /**
     * @param {Array<{day: number, value: number, has: boolean}>} points 按时间升序，每个点代表一天
     * @param {{type?: 'bar'|'line', axis?: 'day'|'hour',
     *          axisLabel?: (v:number)=>string,
     *          dayFormat?: (v:number)=>string,
     *          format?: (value: number) => string}} [options]
     *        format 决定「点某一天时气泡里显示的文案」（默认取整数值）
     * @returns {SVGElement}
     */
    function build(points, options) {
        var list = points && points.length ? points : [{ day: Date.now(), value: 0, has: false }];
        var type = options && options.type === 'line' ? 'line' : 'bar';
        var axis = (options && options.axis) || 'day';
        var axisLabel = options && options.axisLabel;

        var plotW = WIDTH - PAD_X - PAD_X;
        var plotH = HEIGHT - PAD_TOP - PAD_BOTTOM;
        var baseY = PAD_TOP + plotH;

        var max = -Infinity;
        var min = Infinity;
        var hasAny = false;
        list.forEach(function (point) {
            if (!point.has) {
                return;
            }
            hasAny = true;
            if (point.value > max) max = point.value;
            if (point.value < min) min = point.value;
        });

        if (type === 'line' && hasAny) {
            // 折线图看走势：最小值贴底、最大值贴顶，否则像体重这种
            // 数值集中在 70 附近的曲线会被压成贴在 0 基线上的一条直线
            if (max === min) {
                max += 1;
                min -= 1;
            }
        } else {
            min = 0;
            if (!(max > 0)) max = 1;
        }

        var span = max - min || 1;
        function toY(value) {
            return baseY - ((value - min) / span) * plotH;
        }

        var slot = plotW / list.length;
        var barW = Math.max(1, Math.min(slot - 3, 22));

        var parts = [
            '<line class="chart-grid" x1="' + PAD_X + '" y1="' + PAD_TOP +
                '" x2="' + (WIDTH - PAD_X) + '" y2="' + PAD_TOP + '" />',
            '<line class="chart-axis" x1="' + PAD_X + '" y1="' + baseY +
                '" x2="' + (WIDTH - PAD_X) + '" y2="' + baseY + '" />',
            '<text class="chart-tick" x="' + (PAD_X - 6) + '" y="' +
                (PAD_TOP + 4) + '" text-anchor="end">' + tickLabel(max) + '</text>',
            '<text class="chart-tick" x="' + (PAD_X - 6) + '" y="' +
                (baseY + 4) + '" text-anchor="end">' + tickLabel(min) + '</text>'
        ];

        function centerX(index) {
            return PAD_X + index * slot + slot / 2;
        }

        if (type === 'line') {
            parts = parts.concat(buildLine(list, toY, centerX));
        } else {
            list.forEach(function (point, index) {
                if (!point.has || point.value <= 0) {
                    return;
                }
                var height = Math.max(2, ((point.value - min) / span) * plotH);
                var x = PAD_X + index * slot + (slot - barW) / 2;
                parts.push(
                    '<rect class="chart-bar" data-index="' + index + '" x="' + x.toFixed(1) +
                    '" y="' + (baseY - height).toFixed(1) + '" width="' + barW.toFixed(1) +
                    '" height="' + height.toFixed(1) + '" rx="2" />'
                );
            });
        }

        // 横轴只标「首 / 中 / 尾」三处刻度，避免挤成一团
        [0, Math.floor((list.length - 1) / 2), list.length - 1]
            .filter(function (value, index, array) {
                return array.indexOf(value) === index;
            })
            .forEach(function (index) {
                var anchor = index === 0
                    ? 'start'
                    : (index === list.length - 1 ? 'end' : 'middle');
                parts.push(
                    '<text class="chart-tick" x="' + centerX(index).toFixed(1) + '" y="' +
                    (baseY + 17) + '" text-anchor="' + anchor + '">' +
                    axisTickLabel(list[index].day, axis, axisLabel) + '</text>'
                );
            });

        // 每天一整列透明命中区：点一下就能看到那天的具体数值
        var tips = list.map(function (point, index) {
            return {
                has: point.has,
                day: point.day,
                value: point.value,
                cx: centerX(index),
                top: type === 'line'
                    ? toY(point.value)
                    : baseY - Math.max(2, ((point.value - min) / span) * plotH)
            };
        });

        list.forEach(function (point, index) {
            parts.push(
                '<rect class="chart-hit" data-index="' + index + '" x="' +
                (PAD_X + index * slot).toFixed(1) + '" y="' + PAD_TOP + '" width="' +
                slot.toFixed(1) + '" height="' + plotH + '" />'
            );
        });

        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        // ⚠️ 根的 class 只能管到「这是一张图」——不能把 chart-bar / chart-line 也写上去。
        // stroke / stroke-width 在 SVG 里是**可继承**的，根上带了就会渗到所有子元素，
        // 连刻度文字都被描边，看上去又粗又糊。
        svg.setAttribute('class', 'chart');
        svg.setAttribute('data-chart-type', type);
        svg.setAttribute('viewBox', '0 0 ' + WIDTH + ' ' + HEIGHT);
        svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        svg.setAttribute('role', 'img');
        svg.innerHTML = parts.join('');

        attachTips(svg, tips, {
            type: type,
            baseY: baseY,
            format: options && options.format,
            dayFormat: options && options.dayFormat
        });

        return svg;
    }

    /**
     * 点某一天就在那个点上方/下方浮一个数值气泡（再点一次收起）。
     * 气泡画在 SVG 里（viewBox 坐标），所以跟着图一起缩放。
     */
    function attachTips(svg, tips, config) {
        var layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        layer.setAttribute('class', 'chart-tip');
        layer.setAttribute('hidden', 'true');
        svg.appendChild(layer);

        var current = -1;

        function clear() {
            layer.setAttribute('hidden', 'true');
            layer.innerHTML = '';
        }

        function show(index) {
            var tip = tips[index];
            var text = config.format
                ? String(config.format(tip.value))
                : String(Math.round(tip.value * 100) / 100);
            var dayFormat = config.dayFormat || fullDateLabel;
            var dayText = dayFormat(tip.day);

            var lines = [{ text: dayText, head: true }, { text: text, head: false }];
            var lineH = 15;
            var headGap = 3;
            var boxW = 0;
            lines.forEach(function (line) {
                boxW = Math.max(boxW, line.text.length * 6.2 + 16);
            });
            var boxH = lines.length * lineH + 8 + headGap;
            var boxX = Math.min(
                Math.max(tip.cx - boxW / 2, PAD_X),
                WIDTH - PAD_X - boxW
            );
            // 优先浮在柱顶 / 折线点上方；上面没地方就压到它下面
            var boxY = tip.top - boxH - 7;
            if (boxY < 2) {
                boxY = tip.top + 7;
            }

            var inner =
                '<rect x="' + boxX.toFixed(1) + '" y="' + boxY.toFixed(1) +
                '" width="' + boxW.toFixed(1) + '" height="' + boxH.toFixed(1) +
                '" rx="6" />';

            var y = boxY + 13;
            lines.forEach(function (line) {
                inner += '<text' + (line.head ? ' class="chart-tip-head"' : '') +
                    ' x="' + (boxX + boxW / 2).toFixed(1) + '" y="' + y.toFixed(1) +
                    '" text-anchor="middle">' + line.text + '</text>';
                y += lineH + (line.head ? headGap : 0);
            });

            if (config.type === 'line') {
                inner = '<line class="chart-guide" x1="' + tip.cx.toFixed(1) +
                    '" y1="' + PAD_TOP + '" x2="' + tip.cx.toFixed(1) +
                    '" y2="' + config.baseY + '" />' + inner;
            }

            layer.innerHTML = inner;
            layer.removeAttribute('hidden');
        }

        svg.addEventListener('click', function (event) {
            var hit = event.target.closest ? event.target.closest('.chart-hit') : null;
            if (!hit) {
                return;
            }

            var index = Number(hit.getAttribute('data-index'));
            if (!tips[index] || !tips[index].has) {
                return;   // 那天没有记录，不弹气泡
            }

            if (current === index) {
                current = -1;
                clear();
                return;
            }

            current = index;
            show(index);
        });
    }

    /**
     * 折线：把「有记录」的天按顺序连成一条线。
     * 中间没有记录的天不画点、也不断线，直接跨过去连到上一个数据点。
     */
    function buildLine(list, toY, centerX) {
        var parts = [];
        var points = [];
        list.forEach(function (point, index) {
            if (point.has) {
                points.push({ index: index, value: point.value });
            }
        });

        function x(index) {
            return centerX(index).toFixed(1);
        }

        function y(value) {
            return toY(value).toFixed(1);
        }

        if (points.length >= 2) {
            parts.push('<polyline class="chart-line" points="' +
                points.map(function (item) {
                    return x(item.index) + ',' + y(item.value);
                }).join(' ') + '" />');
        }

        // 点不多时把每个点都标出来，便于看清孤立的那几次记录
        if (points.length <= 40) {
            points.forEach(function (item) {
                parts.push('<circle class="chart-dot" data-index="' + item.index +
                    '" cx="' + x(item.index) + '" cy="' + y(item.value) + '" r="2.4" />');
            });
        }

        return parts;
    }

    /**
     * 把「时段」拆到每一天再归到给定区间里。
     * 跨天的记录（比如 23:00 → 次日 07:00）会按实际跨过的时长分摊，
     * 而不是整段都算在开始那天；时点记录（end 为空）整份归到当天。
     *
     * @param {Array<{start: number, end?: number|null, value: number}>} items
     * @param {{start: number, end: number}} range 起止时间戳（两端都含当天）
     * @returns {Array<{day: number, value: number, has: boolean}>}
     */
    function bucketSpans(items, range) {
        var start = startOfDay(range.start);
        var end = startOfDay(range.end);
        if (end < start) {
            var swap = start;
            start = end;
            end = swap;
        }

        var days = Math.round((end - start) / DAY_MS) + 1;
        var points = [];
        for (var i = 0; i < days; i += 1) {
            points.push({ day: start + i * DAY_MS, value: 0, has: false });
        }

        function add(dayMs, amount) {
            var slot = Math.round((dayMs - start) / DAY_MS);
            if (slot < 0 || slot >= days) {
                return;
            }
            points[slot].value += amount;
            // 碰到过的天都算「有数据」，哪怕只分到十几分钟
            points[slot].has = true;
        }

        (items || []).forEach(function (item) {
            var from = Number(item.start);
            if (!isFinite(from)) {
                return;
            }

            var amount = Number(item.value) || 0;
            var to = (item.end === null || item.end === undefined) ? from : Number(item.end);
            if (!isFinite(to) || to < from) {
                to = from;
            }

            // 时点：整份归到当天
            if (to === from) {
                add(startOfDay(from), amount);
                return;
            }

            var total = to - from;
            var cursor = from;
            while (cursor < to) {
                var dayStart = startOfDay(cursor);
                var sliceEnd = Math.min(to, dayStart + DAY_MS);
                add(dayStart, amount * ((sliceEnd - cursor) / total));
                cursor = sliceEnd;
            }
        });

        return points;
    }

    /**
     * 把事件按天归到给定区间里（时点用，整份记在当天）。
     * @param {Array<number>} times 事件时间戳
     * @param {Array<number>} values 与 times 一一对应的取值
     * @param {{start: number, end: number}} range 起止时间戳（两端都含当天）
     * @returns {Array<{day: number, value: number, has: boolean}>}
     */
    function bucketByDay(times, values, range) {
        var start = startOfDay(range.start);
        var end = startOfDay(range.end);
        if (end < start) {
            var swap = start;
            start = end;
            end = swap;
        }

        var days = Math.round((end - start) / DAY_MS) + 1;
        var points = [];
        for (var i = 0; i < days; i += 1) {
            points.push({ day: start + i * DAY_MS, value: 0, has: false });
        }

        (times || []).forEach(function (ms, index) {
            var slot = Math.round((startOfDay(ms) - start) / DAY_MS);
            if (slot < 0 || slot >= days) {
                return;
            }
            points[slot].value += Number(values[index]) || 0;
            points[slot].has = true;
        });

        return points;
    }

    /** 一批时间戳里第一天 / 最后一天（都归到零点） */
    function rangeOf(times) {
        if (!times || !times.length) {
            var today = startOfDay(Date.now());
            return { start: today, end: today };
        }

        var min = times[0];
        var max = times[0];
        times.forEach(function (ms) {
            if (ms < min) min = ms;
            if (ms > max) max = ms;
        });
        return { start: startOfDay(min), end: startOfDay(max) };
    }

    /**
     * 多序列折线图：同一个横轴（日）上画好几条线，用**不同的线型**区分。
     * 用在跟踪项的统计里 —— 一条记录有好几个项目（高压 / 低压 / 脉搏），
     * 每个项目一条线；用户不再选「看哪个值」，而是一次看全，
     * 靠 `dash`（实线 / 虚线 / 点线…）区分是哪一项。
     *
     * ⚠️ 和单序列 build(points, {type:'line'}) 的区别：
     *    - 纵轴范围取所有序列的并集（共用一根轴才可比）
     *    - 只画线，不画柱子（项目之间量纲可能不同，但至少线型能区分）
     *
     * @param {Array<{day: number}>} days 横轴（按升序的每一天）
     * @param {Array<{name: string, points: Array<{day:number, value:number, has:boolean}>,
     *                dash: string|null}>} series
     * @param {{format?: (value:number)=>string, tipFormat?: (seriesIndex:number, value:number)=>string}} [options]
     * @returns {SVGElement}
     */
    /**
     * 数据点标记。多序列时靠**形状**区分（不能只用虚线纹理：几种虚线肉眼分不清，
     * 用户 2026-09-22 明确说「实线一个虚线一个就行了，其他用叉什么的」）。
     *
     * @param {string} shape  'circle' | 'square' | 'triangle' | 'cross' | 'diamond'
     * @param {number} index  序列序号（用于 class，方便单独调样式）
     * @param {number} x
     * @param {number} y
     * @returns {string} SVG 片段
     */
    function marker(shape, index, x, y) {
        var cls = 'chart-dot chart-series-' + index;
        var cx = x.toFixed(1);
        var cy = y.toFixed(1);
        var r = MARKER_SIZE;
        switch (shape) {
        case 'square':
            return '<rect class="' + cls + '" x="' + (x - r).toFixed(1) + '" y="' +
                (y - r).toFixed(1) + '" width="' + (r * 2) + '" height="' + (r * 2) + '" />';
        case 'triangle':
            return '<polygon class="' + cls + '" points="' +
                cx + ',' + (y - r * 1.3).toFixed(1) + ' ' +
                (x - r * 1.2).toFixed(1) + ',' + (y + r).toFixed(1) + ' ' +
                (x + r * 1.2).toFixed(1) + ',' + (y + r).toFixed(1) + '" />';
        case 'diamond':
            return '<polygon class="' + cls + '" points="' +
                cx + ',' + (y - r * 1.4).toFixed(1) + ' ' +
                (x + r * 1.4).toFixed(1) + ',' + cy + ' ' +
                cx + ',' + (y + r * 1.4).toFixed(1) + ' ' +
                (x - r * 1.4).toFixed(1) + ',' + cy + '" />';
        case 'cross':
            // 叉：两条短线（不填充，靠 stroke）
            var d = r * 1.35;
            return '<path class="' + cls + ' chart-dot-cross" d="M' +
                (x - d).toFixed(1) + ',' + (y - d).toFixed(1) + 'L' +
                (x + d).toFixed(1) + ',' + (y + d).toFixed(1) + 'M' +
                (x + d).toFixed(1) + ',' + (y - d).toFixed(1) + 'L' +
                (x - d).toFixed(1) + ',' + (y + d).toFixed(1) + '" />';
        default:
            return '<circle class="' + cls + '" cx="' + cx + '" cy="' + cy +
                '" r="' + r + '" />';
        }
    }

    function buildMulti(days, series, options) {        var list = days && days.length ? days : [{ day: Date.now() }];
        var plotW = WIDTH - PAD_X - PAD_X;
        var plotH = HEIGHT - PAD_TOP - PAD_BOTTOM;
        var baseY = PAD_TOP + plotH;

        var max = -Infinity;
        var min = Infinity;
        var hasAny = false;
        (series || []).forEach(function (item) {
            (item.points || []).forEach(function (point) {
                if (!point.has) {
                    return;
                }
                hasAny = true;
                if (point.value > max) max = point.value;
                if (point.value < min) min = point.value;
            });
        });

        if (hasAny) {
            if (max === min) {
                max += 1;
                min -= 1;
            }
        } else {
            min = 0;
            max = 1;
        }

        // 上下各留 8% 余量，免得最高 / 最低点贴着边框
        var pad = (max - min) * 0.08 || 1;
        max += pad;
        min -= pad;

        var span = max - min || 1;
        function toY(value) {
            return baseY - ((value - min) / span) * plotH;
        }

        var slot = plotW / list.length;

        function centerX(index) {
            return PAD_X + index * slot + slot / 2;
        }

        var parts = [
            '<line class="chart-grid" x1="' + PAD_X + '" y1="' + PAD_TOP +
                '" x2="' + (WIDTH - PAD_X) + '" y2="' + PAD_TOP + '" />',
            '<line class="chart-axis" x1="' + PAD_X + '" y1="' + baseY +
                '" x2="' + (WIDTH - PAD_X) + '" y2="' + baseY + '" />',
            '<text class="chart-tick" x="' + (PAD_X - 6) + '" y="' +
                (PAD_TOP + 4) + '" text-anchor="end">' + tickLabel(max) + '</text>',
            '<text class="chart-tick" x="' + (PAD_X - 6) + '" y="' +
                (baseY + 4) + '" text-anchor="end">' + tickLabel(min) + '</text>'
        ];

        // 每条序列：把有数据的天按顺序连起来（没记录的天跨过去，不断线）
        (series || []).forEach(function (item, seriesIndex) {
            var points = [];
            (item.points || []).forEach(function (point) {
                var index = list.findIndex(function (day) {
                    return day.day === point.day;
                });
                if (index >= 0 && point.has) {
                    points.push({ index: index, value: point.value });
                }
            });
            if (points.length < 2) {
                /*
                   只有一个点（比如两条记录都在同一天）时，光画个 2.6px 的圆点，
                   整张图看起来是空的（用户报过「图表为空」）。这里补一条**横贯绘图区**
                   的短基线 + 放大的标记，让「这天有什么值」一眼能看见。
                */
                points.forEach(function (entry) {
                    var x = centerX(entry.index);
                    var y = toY(entry.value);
                    var style = item.dash ? ' stroke-dasharray="' + item.dash + '"' : '';
                    parts.push('<line class="chart-line chart-series-' + seriesIndex +
                        '" x1="' + (x - slot / 2 + 4).toFixed(1) + '" y1="' + y.toFixed(1) +
                        '" x2="' + (x + slot / 2 - 4).toFixed(1) + '" y2="' + y.toFixed(1) +
                        '"' + style + ' />');
                    parts.push(marker(item.marker, seriesIndex, x, y));
                });
                return;
            }

            var style = item.dash ? ' stroke-dasharray="' + item.dash + '"' : '';
            parts.push('<polyline class="chart-line chart-series-' + seriesIndex +
                '" points="' + points.map(function (entry) {
                    return centerX(entry.index).toFixed(1) + ',' + toY(entry.value).toFixed(1);
                }).join(' ') + '"' + style + ' />');

            if (points.length <= 40) {
                // 点标记也按序列换形状，这样即使线密集也能靠标记区分
                points.forEach(function (entry) {
                    parts.push(marker(item.marker, seriesIndex,
                        centerX(entry.index), toY(entry.value)));
                });
            }
        });

        /*
           横轴标「首 / 中 / 尾」三处日期。
           ⚠️ 现在横轴上一个点 = 一条记录，同一天的多个点会算出同一个日期标签，
              首/中/尾三处可能重复（出现两个一样的 "9-22"），所以要按**日期**去重：
              先取首/中/尾，若与已选标签的日期相同就往前/后挪一个不同的天。
        */
        var tickIndexes = [];
        [0, Math.floor((list.length - 1) / 2), list.length - 1]
            .forEach(function (index) {
                if (index < 0 || index >= list.length || tickIndexes.indexOf(index) >= 0) {
                    return;
                }
                var label = dateLabel(list[index].day);
                var dup = tickIndexes.some(function (picked) {
                    return dateLabel(list[picked].day) === label;
                });
                if (!dup) {
                    tickIndexes.push(index);
                }
            });
        tickIndexes.sort(function (a, b) {
            return a - b;
        });
        tickIndexes.forEach(function (index, position) {
            var anchor = position === 0
                ? 'start'
                : (position === tickIndexes.length - 1 ? 'end' : 'middle');
            parts.push(
                '<text class="chart-tick" x="' + centerX(index).toFixed(1) + '" y="' +
                (baseY + 17) + '" text-anchor="' + anchor + '">' +
                dateLabel(list[index].day) + '</text>'
            );
        });

        // 每天一整列透明命中区：点一下列出那一天各序列的值
        var tips = list.map(function (day, index) {
            var values = [];
            var has = false;
            (series || []).forEach(function (item) {
                (item.points || []).forEach(function (point) {
                    if (point.day !== day.day) {
                        return;
                    }
                    values.push({ name: item.name, value: point.value, has: point.has });
                    if (point.has) {
                        has = true;
                    }
                });
            });
            return { day: day.day, cx: centerX(index), values: values, has: has };
        });

        list.forEach(function (day, index) {
            parts.push(
                '<rect class="chart-hit" data-index="' + index + '" x="' +
                (PAD_X + index * slot).toFixed(1) + '" y="' + PAD_TOP + '" width="' +
                slot.toFixed(1) + '" height="' + plotH + '" />'
            );
        });

        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'chart');
        svg.setAttribute('data-chart-type', 'line');
        svg.setAttribute('viewBox', '0 0 ' + WIDTH + ' ' + HEIGHT);
        svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        svg.setAttribute('role', 'img');
        svg.innerHTML = parts.join('');

        attachMultiTips(svg, tips, options, baseY);
        return svg;
    }

    /**
     * 多序列的气泡：第一行是哪一天，下面每行一个「项目名 值」。
     *
     * ⚠️ 第一行必须是日期（用户要求）：只列数值的话，点完根本不知道看的是哪一天，
     *    尤其是横轴刻度只标了首/中/尾三处、或者同一天有多个点的时候。
     */
    function attachMultiTips(svg, tips, options, baseY) {
        var layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        layer.setAttribute('class', 'chart-tip');
        layer.setAttribute('hidden', 'true');
        svg.appendChild(layer);

        var current = -1;

        function clear() {
            layer.setAttribute('hidden', 'true');
            layer.innerHTML = '';
        }

        function show(index) {
            var tip = tips[index];
            var rows = tip.values.filter(function (row) {
                return row.has;
            });
            var format = (options && options.format) || function (value) {
                return String(Math.round(value * 100) / 100);
            };
            var dayFormat = (options && options.dayFormat) || fullDateLabel;

            // 第一行日期，其余每行一个项目
            var lines = [{ text: dayFormat(tip.day), head: true }];
            rows.forEach(function (row) {
                lines.push({ text: format(row.value, row.name), head: false });
            });

            var lineH = 15;
            var headGap = 3;
            var boxH = lines.length * lineH + 8 + headGap;
            var boxW = 0;
            lines.forEach(function (line) {
                boxW = Math.max(boxW, line.text.length * 6.2 + 16);
            });
            var boxX = Math.min(
                Math.max(tip.cx - boxW / 2, PAD_X),
                WIDTH - PAD_X - boxW
            );
            var boxY = PAD_TOP + 2;

            var inner =
                '<line class="chart-guide" x1="' + tip.cx.toFixed(1) +
                '" y1="' + PAD_TOP + '" x2="' + tip.cx.toFixed(1) +
                '" y2="' + baseY + '" />' +
                '<rect x="' + boxX.toFixed(1) + '" y="' + boxY.toFixed(1) +
                '" width="' + boxW.toFixed(1) + '" height="' + boxH.toFixed(1) +
                '" rx="6" />';

            var y = boxY + 14;
            lines.forEach(function (line) {
                inner += '<text' + (line.head ? ' class="chart-tip-head"' : '') +
                    ' x="' + (boxX + boxW / 2).toFixed(1) + '" y="' + y.toFixed(1) +
                    '" text-anchor="middle">' + line.text + '</text>';
                y += lineH + (line.head ? headGap : 0);
            });

            layer.innerHTML = inner;
            layer.removeAttribute('hidden');
        }

        svg.addEventListener('click', function (event) {
            var hit = event.target.closest ? event.target.closest('.chart-hit') : null;
            if (!hit) {
                return;
            }
            var index = Number(hit.getAttribute('data-index'));
            if (!tips[index] || !tips[index].has) {
                return;
            }
            if (current === index) {
                current = -1;
                clear();
                return;
            }
            current = index;
            show(index);
        });
    }

    global.LivologChart = {
        build: build,
        buildMulti: buildMulti,
        /** 供图例复用：画出与折线一致的标记（形状见 marker()） */
        marker: marker,
        bucketByDay: bucketByDay,
        bucketSpans: bucketSpans,
        rangeOf: rangeOf,
        startOfDay: startOfDay,
        dateLabel: dateLabel,
        fullDateLabel: fullDateLabel
    };
})(window);
