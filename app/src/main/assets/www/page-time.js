/**
 * Livolog - 时间页。
 *
 * 三个视图（全部 / 时段 / 时点）由顶部视图栏切换；
 * 右下角悬浮按钮打开表单弹窗新增记录，时间按 YYYY-MM-DD-HH:mm 分段填写。
 */
(function (global) {
    'use strict';

    var VIEWS = ['all', 'year', 'month', 'week'];
    var DEFAULT_VIEW = 'all';
    var VIEW_STORAGE_KEY = 'livolog.timeView';
    /** 视图 = 看最近多少天；all 表示不限制 */
    var VIEW_DAYS = { all: 0, year: 365, month: 30, week: 7 };
    /**
     * 每个范围要显示到哪一级分组。
     * 范围内已经固定了的层级不再重复显示（否则只会出现孤零零的一个分区）：
     *   全部 → 年/月/周；最近一年 → 月/周；最近一月 → 周；最近一周 → 不分分区，直接列记录
     */
    var VIEW_LEVELS = { all: 3, year: 2, month: 1, week: 0 };
    var LEVEL_KINDS = ['week', 'month', 'year'];
    var DAY_MS = 24 * 60 * 60 * 1000;

    var listEl = null;
    var viewLabel = null;
    var viewButton = null;
    var fab = null;
    var sheet = null;
    var sheetTitle = null;
    var behaviorSelect = null;
    var typeSelect = null;
    var fieldsEl = null;
    var hintEl = null;
    var noteInput = null;
    var cancelBtn = null;
    var confirmBtn = null;

    var currentView = DEFAULT_VIEW;
    var groups = {};
    var behaviorValue = '';
    var typeValue = '';
    /** 非空表示当前表单在编辑这条已有记录，提交时走 update 而不是 add */
    var editingId = null;

    function t(key) {
        return global.LivologI18n ? global.LivologI18n.t(key) : key;
    }

    // --- 时间格式化 ---------------------------------------------------------
    // 与跟踪页共用 LivologDateTime（见 datetime.js），这里只保留
    //「一条记录怎么显示成两行」的规则。

    /** 上排：只显示「开始」那天的日期。跨天的时段也不展开，数据本身不受影响。 */
    function dateLine(record) {
        return global.LivologDateTime.formatDate(record.start);
    }

    /** 下排：时分（时段显示起止） */
    function clockLine(record) {
        if (record.type !== 'period' || record.end === null) {
            return global.LivologDateTime.formatClock(record.start);
        }
        return global.LivologDateTime.formatClock(record.start) + ' ~ ' +
            global.LivologDateTime.formatClock(record.end);
    }

    /** 分段日期时间输入统一走 LivologDateTime，这里只做一层转发方便本文件调用 */
    function buildGroup(labelText, initial, onChange) {
        return global.LivologDateTime.buildGroup(labelText, initial, onChange);
    }

    function readGroup(group) {
        return global.LivologDateTime.readGroup(group);
    }

    function toTimestamp(values) {
        return global.LivologDateTime.toTimestamp(values);
    }

    // --- 视图栏 -------------------------------------------------------------

    function setView(view, options) {
        if (VIEWS.indexOf(view) < 0) {
            view = DEFAULT_VIEW;
        }

        var changed = view !== currentView;
        var from = VIEWS.indexOf(currentView);
        var to = VIEWS.indexOf(view);

        currentView = view;
        renderViewBar();

        try {
            global.localStorage.setItem(VIEW_STORAGE_KEY, view);
        } catch (e) {
            /* 忽略 */
        }

        render();

        if (changed && (!options || options.animate !== false)) {
            global.LivologUI.animateEnter(listEl, to >= from ? 1 : -1);
        }
    }

    function renderViewBar() {
        viewLabel.textContent = t('time.range.' + currentView);
        viewButton.setAttribute('aria-expanded', 'false');
    }

    function openViewMenu() {
        var items = VIEWS.map(function (view) {
            return {
                value: view,
                label: t('time.range.' + view),
                selected: view === currentView
            };
        });

        global.LivologUI.openMenu(viewButton, items, function (value) {
            setView(value);
        });
    }

    // --- 列表 ---------------------------------------------------------------
    //
    // 记录按「年 → 月 → 周」三级分组，每一级都能展开 / 折叠。
    //
    // ⚠️ 周是**真实的自然周**：周一到周日（固定按 ISO 口径切，见 `weekKey`）。
    //    以前按「1–7 号算第 1 周」切，那个「周」跟用户日历上的周对不上
    //    （用户报「周的划分不太对」），所以换成了自然周。
    // ⚠️ 划分换成自然周后，月初/月末那一周会**横跨两个月**。这种周在**两个
    //    月份下各出现一次**，各自按本月的第几个周编号（用户 2026-09-24 明确选定）：
    //      `2026-09-W5`（9/28~9/30）与 `2026-10-W1`（10/1~10/04）指向同一周。
    //    这样每个月都是完整、连续的第 1..N 周，不会出现「9 月只有 4 个周、
    //    月尾那周跑去 10 月」这种断档。
    // ⚠️ 标签格式 `{y}-{m}-W{n}` 是用户原有约定，**不要擅自改成日期区间**
    //    （我 2026-09-24 擅改过一次，被指出「旧的地方不要乱改」）。
    //    `LivologClock` 的「每周起始日」设置只影响**显示顺序与日期标记**，
    //    不影响归组口径（归组永远按周一切，保证跨月跨年稳定）。

    /** 已折叠的分组 key；只在本次会话里记着 */
    var collapsed = {};

    /** 时间口径（时区 / 每周起始日）都从这里取，不要直接用 new Date() 的本地字段 */
    var clock = global.LivologClock;

    /**
     * 先建成完整的年/月/周三棵树，再根据当前范围决定从哪一级开始显示。
     * @returns {Array|null} null 表示不分分区（直接列记录）
     */
    function buildTree(records, levels) {
        var years = [];
        var yearIndex = {};
        var pad = global.LivologDateTime.pad;

        /*
           1. 先按自然周归组：一周一条，带上周一日期与本周覆盖到的记录。
              （用周一的 `YYYY-MM-DD` 当 key —— 跨年时 ISO 周号会跳，日期不会）

              ⚠️ `weeks` 里的顺序 = 记录顺序（时间页是**新→旧**），
              所以**绝不能拿遍历顺序当月内序号**（第一版就是这么错的：
              序号倒着发，10 月第 1 周拿到了 10 月中旬那一周）。
              序号一律按日历算，见下面第 2 步。
        */
        var weekIndex = {};
        var weeks = [];
        records.forEach(function (record) {
            var key = clock.weekKey(record.start);
            if (!weekIndex[key]) {
                weekIndex[key] = { key: key, records: [] };
                weeks.push(weekIndex[key]);
            }
            weekIndex[key].records.push(record);
        });

        /*
           2. 每周算出它覆盖到的**年月**（最多两个，跨月时才是两个），
              以及它在该月里是第几个自然周。

              月内序号 = 「包含该月 1 号的那一周算第 1 周，之后每个自然周 +1」。
              用**周一的日期**来算，别用「落在该月的第几天」（那个会和 7 天段边界
              撞车，导致同一个月份下出现两个 W1 —— 第一版就是这么错的）：

                  该月 1 号所在周的周一 = M
                  本周的周一           = W
                  序号 = (W - M) / 7 天 + 1

              跨月的那一周在两个月里会得到各自正确的序号
              （9/28~10/4 = 9 月第 5 周，同时也是 10 月第 1 周 —— 用户选定的口径）。
        */
        weeks.forEach(function (week) {
            week.months = [];
            week.monthNumbers = {};
            var start = weekStartTimestamp(week.key);

            for (var day = 0; day < 7; day++) {
                var p = clock.parts(start + day * 86400000);
                var monthKey = p.year + '-' + p.month;
                if (week.months.indexOf(monthKey) >= 0) {
                    continue;
                }
                week.months.push(monthKey);

                // 该月 1 号所在自然周的周一
                var firstOfMonth = clock.stamp(p.year, p.month, 1, 0, 0);
                var anchor = clock.weekStartOf(firstOfMonth);
                // 两个周一之间差几个整周，就说明这是本月第几个自然周
                week.monthNumbers[monthKey] =
                    Math.round((start - anchor) / (7 * 86400000)) + 1;
            }
        });

        /*
           3. 真正建树：同一周会分别挂到它覆盖的每个月份下，
              标签用该月份自己的序号（所以 `2026-09-W5` 与 `2026-10-W1`
              可能指向同一周，这是用户选定的口径）。
        */
        weeks.forEach(function (week) {
            week.months.forEach(function (monthKey) {
                var bits = monthKey.split('-');
                var monthYear = Number(bits[0]);
                var month = Number(bits[1]);

                var yearKey = 'y' + monthYear;
                if (!yearIndex[yearKey]) {
                    yearIndex[yearKey] = {
                        key: yearKey,
                        label: t('time.group.year').replace('{y}', String(monthYear)),
                        count: 0,
                        months: [],
                        monthIndex: {}
                    };
                    years.push(yearIndex[yearKey]);
                }
                var yearNode = yearIndex[yearKey];

                if (!yearNode.monthIndex[monthKey]) {
                    yearNode.monthIndex[monthKey] = {
                        key: monthKey.replace('-', 'm'),
                        label: t('time.group.month')
                            .replace('{y}', String(monthYear))
                            .replace('{m}', pad(month, 2)),
                        count: 0,
                        weeks: [],
                        weekIndex: {}
                    };
                    yearNode.months.push(yearNode.monthIndex[monthKey]);
                }
                var monthNode = yearNode.monthIndex[monthKey];

                var n = week.monthNumbers[monthKey];
                var childKey = monthKey + 'w' + week.key;
                if (!monthNode.weekIndex[childKey]) {
                    monthNode.weekIndex[childKey] = {
                        key: childKey,
                        label: t('time.group.week')
                            .replace('{y}', String(monthYear))
                            .replace('{m}', pad(month, 2))
                            .replace('{n}', String(n)),
                        count: 0,
                        records: []
                    };
                    monthNode.weeks.push(monthNode.weekIndex[childKey]);
                }
                var weekNode = monthNode.weekIndex[childKey];
                weekNode.count += week.records.length;
                week.records.forEach(function (record) {
                    weekNode.records.push(record);
                });
                monthNode.count += week.records.length;
                yearNode.count += week.records.length;
            });
        });

        if (levels >= 3) {
            return years;
        }

        var months = [];
        years.forEach(function (yearNode) {
            months = months.concat(yearNode.months);
        });
        if (levels === 2) {
            return months;
        }

        var flatWeeks = [];
        months.forEach(function (monthNode) {
            flatWeeks = flatWeeks.concat(monthNode.weeks);
        });
        if (levels === 1) {
            return flatWeeks;
        }

        return null;
    }

    /** `YYYY-MM-DD`（某周周一）→ 该日零点的时间戳 */
    function weekStartTimestamp(weekKey) {
        var bits = weekKey.split('-').map(Number);
        return clock.stamp(bits[0], bits[1], bits[2], 0, 0);
    }

    function section(node, kind, depth, buildBody) {
        var li = global.LivologUI.el('li', 'group group-' + kind);
        var opened = !collapsed[node.key];

        var head = global.LivologUI.el('button', 'group-head');
        head.type = 'button';
        head.style.paddingLeft = (20 + depth * 12) + 'px';
        head.setAttribute('aria-expanded', opened ? 'true' : 'false');
        head.appendChild(global.LivologUI.el('span', 'group-chevron'))
            .innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
            '<path d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z"/></svg>';
        head.appendChild(global.LivologUI.el('span', 'group-title', node.label));
        // 右侧标明这是哪一级（年 / 月 / 周），层级一眼能看出来
        head.appendChild(global.LivologUI.el('span', 'group-level', t('time.level.' + kind)));
        li.appendChild(head);

        var body = global.LivologUI.el('ul', 'group-body');
        body.hidden = !opened;
        if (!opened) {
            li.classList.add('is-collapsed');
        }
        buildBody(body);
        li.appendChild(body);

        // 就地折叠，不重绘整个列表，避免滚动位置跳动
        head.addEventListener('click', function () {
            var willClose = !body.hidden;
            body.hidden = willClose;
            li.classList.toggle('is-collapsed', willClose);
            head.setAttribute('aria-expanded', willClose ? 'false' : 'true');
            if (willClose) {
                collapsed[node.key] = true;
            } else {
                delete collapsed[node.key];
            }
        });

        return li;
    }

    /** 时间页的记录列表：按 .start 分天（复用共用的 appendRecordCards） */
    function appendRecords(container, records) {
        appendRecordCards(container, records, recordCard, function (record) {
            return record.start;
        });
    }

    /** 日期标记：YYYY-MM-DD, 周几（如 2026-09-19, Sat） */
    function dayMark(day) {
        var text = clock.formatDate(day) + ', ' + t('weekday.' + clock.parts(day).weekday);
        return global.LivologUI.el('li', 'day-mark', text);
    }

    /**
     * 按天排列卡片：换一天就在前面插一条日期标记。
     * 时间页与行为 / 跟踪详情页共用（三处的记录视图长得一样）。
     *
     * @param {HTMLElement} container
     * @param {Array<{time: number}>} entries 已按时间**降序**排好的条目
     * @param {(entry: object) => HTMLElement} buildCard 造一张卡片
     * @param {(entry: object) => number} [timeOf] 取时间戳，默认取 entry.time
     */
    function appendRecordCards(container, entries, buildCard, timeOf) {
        var at = timeOf || function (entry) {
            return entry.time;
        };
        var lastDay = null;

        entries.forEach(function (entry) {
            var day = global.LivologDateTime.startOfDay(at(entry));
            if (day !== lastDay) {
                lastDay = day;
                container.appendChild(dayMark(day));
            }
            container.appendChild(buildCard(entry));
        });
    }

    /**
     * 卡片左边那块主文字（行为名 / 跟踪项名）。
     * ⚠️ 描述**不再**塞在这里（用户要求描述单独占下面一整行），
     *    所以第二个参数留空即可；保留参数是为了兼容旧调用点。
     */
    function cardBody(title) {
        var body = global.LivologUI.el('div', 'card-body');
        body.appendChild(global.LivologUI.el('span', 'card-title', title));
        return body;
    }

    /**
     * 组装一张记录卡片的「上面那行」：图标 + 主文字 + 右侧时间。
     * 时间页与行为详情页共用（两边长得一样）。
     */
    function cardMain(iconName, title, record) {
        var main = global.LivologUI.el('div', 'card-main');
        main.appendChild(global.LivologUI.icon(iconName, 'card-icon'));
        main.appendChild(cardBody(title));

        var time = global.LivologUI.el('span', 'card-time');
        time.appendChild(global.LivologUI.el('span', 'card-time-date', dateLine(record)));
        time.appendChild(global.LivologUI.el('span', 'card-time-clock', clockLine(record)));
        main.appendChild(time);
        return main;
    }

    /**
     * 记录卡片的完整内容（不含多选 / 长按等交互，由各页面自己接）。
     * 上边一行 `.card-main`，描述（若有）单独占下面一整行。
     */
    function cardContent(iconName, title, record) {
        var fragment = document.createDocumentFragment();
        fragment.appendChild(cardMain(iconName, title, record));
        if (record.note) {
            fragment.appendChild(noteRow(record.note));
        }
        return fragment;
    }
    /**
     * 卡片下方的描述行。
     *
     * 折叠规则：默认只显示**一行**（多余部分裁掉），点一下展开全部、再点收起。
     * 只在「确实放不下」时才让它可点 —— 一行就放得下的短描述不加多余的交互
     * （否则用户点了没变化，以为坏了）。
     *
     * ⚠️ 文字要**可复制**：卡片本身在长按多选时是禁止选中的，
     *    这里显式放开 `user-select`，并且点击时不要冒泡到卡片
     *    （否则会点开编辑表单 / 触发多选）。
     */
    function noteRow(note) {
        var row = global.LivologUI.el('div', 'card-note-row');
        var span = global.LivologUI.el('span', 'card-note', note);
        /*
           ⚠️ 文字外面还要再套一层 span，折叠的 `-webkit-line-clamp` 加在它身上。
              不能加在 `.card-note` 上 —— 那样 `.card-note` 会变成 `-webkit-box`，
              而 `-webkit-box` **不是 flex item**，不参与父级 flex 伸缩，
              结果是 `margin-left: auto` 的箭头把空间全吃掉，文字只剩 39px 宽。
              套一层之后 `.card-note` 仍是普通 flex item（能收缩），
              截断交给内层。
        */
        var text = global.LivologUI.el('span', 'card-note-text', note);
        span.textContent = '';
        span.appendChild(text);
        row.appendChild(span);

        /*
           是否溢出要等布局完成才知道，所以先不加按钮，量完再决定。

           ⚠️ 两个坑（都踩过）：
           1. `.card-note` 是 **inline** 元素，`scrollHeight` 恒为 0，量不出溢出；
           2. 探测副本不能塞在行里量 —— 它会继承折叠后的宽度（实测只剩 130px），
              算出来的自然高度比真实值小，含换行的描述会被误判成「一行放得下」。
              所以副本挂到 `body` 上，宽度取**行的可用宽度**（row 的 padding 去掉）。
        */
        global.requestAnimationFrame(function () {
            var rowWidth = row.getBoundingClientRect().width;
            if (rowWidth <= 0) {
                return;   // 还没布局（隐藏页面），等下次渲染
            }
            var style = global.getComputedStyle(row);
            var available = rowWidth -
                (parseFloat(style.paddingLeft) || 0) -
                (parseFloat(style.paddingRight) || 0);
            if (available <= 0) {
                return;
            }

            /*
               ⚠️ 探测宽度要**再减去箭头那一列**（18px）+ 描述与箭头的间距（6px），
                  否则量出来的「自然高度」是按更宽的行宽算的，会偏矮，
                  明明要多行的描述可能被误判成「一行放得下」。
            */
            var PROBE_WIDTH = available - 18 - 6;
            if (PROBE_WIDTH <= 0) {
                return;
            }

            var probe = text.cloneNode(true);
            probe.style.position = 'absolute';
            probe.style.left = '-9999px';
            probe.style.top = '0';
            probe.style.width = PROBE_WIDTH + 'px';
            probe.style.display = 'block';
            probe.style.webkitLineClamp = 'none';
            probe.style.overflow = 'visible';
            document.body.appendChild(probe);
            var natural = probe.getBoundingClientRect().height;
            document.body.removeChild(probe);

            var single = parseFloat(global.getComputedStyle(span).lineHeight) || 18;
            if (natural <= single + 1) {
                return;   // 一行放得下，保持纯文本
            }
            row.classList.add('is-collapsible');

            /*
               折叠指示箭头（Material `expand_more`）。
               ⚠️ 只有可折叠的行才加 —— 短描述一行放得下，加个永远不动的箭头是噪音。
                  箭头本身不接事件，点击交给整行（`pointer-events: none` 一样由 CSS 控制），
                  这样点箭头和点文字行为一致。
            */
            var toggleIcon = global.LivologUI.el('span', 'card-note-toggle');
            toggleIcon.setAttribute('aria-hidden', 'true');
            toggleIcon.innerHTML = '<svg viewBox="0 0 24 24" focusable="false">' +
                '<path d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z"/></svg>';
            row.appendChild(toggleIcon);

            var toggle = function (event) {
                event.stopPropagation();
                event.preventDefault();
                row.classList.toggle('is-expanded');
                row.setAttribute('aria-expanded',
                    row.classList.contains('is-expanded') ? 'true' : 'false');
            };
            row.addEventListener('click', toggle);
            row.setAttribute('role', 'button');
            row.setAttribute('tabindex', '0');
            row.setAttribute('aria-expanded', 'false');
            row.addEventListener('keydown', function (event) {
                if (event.key === 'Enter' || event.key === ' ') {
                    toggle(event);
                }
            });
        });

        return row;
    }

    /** 单条记录卡片（与行为详情页里的列表长一样） */
    function recordCard(record) {
        var behavior = global.LivologStore.getBehavior(record.behaviorId);

        var card = global.LivologUI.el('li', 'card card-stacked');
        card.dataset.id = record.id;
        card.appendChild(cardContent(
            behavior ? behavior.icon : global.LivologIcons.fallback,
            behavior ? behavior.name : '—',
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
            // 普通点击 = 修改这条记录
            openForm(record);
        });

        return card;
    }

    /** 当前视图的起始时间；all 返回 null 表示不限制 */
    function rangeStart() {
        var days = VIEW_DAYS[currentView] || 0;
        if (!days) {
            return null;
        }
        var today = global.LivologDateTime.startOfDay(Date.now());
        return today - (days - 1) * DAY_MS;
    }

    function render() {
        if (!listEl) {
            return;
        }

        var start = rangeStart();
        var records = global.LivologStore.getRecords().filter(function (record) {
            return start === null || record.start >= start;
        });

        listEl.innerHTML = '';

        if (!records.length) {
            listEl.appendChild(global.LivologUI.emptyState(t('time.empty')));
            return;
        }

        var levels = VIEW_LEVELS[currentView] === undefined ? 3 : VIEW_LEVELS[currentView];
        var nodes = buildTree(records, levels);

        // 范围内已经固定了的层级不重复显示：最近一周就直接列记录
        if (!nodes) {
            appendRecords(listEl, records);
            return;
        }

        var kind = LEVEL_KINDS[levels - 1];
        nodes.forEach(function (node) {
            listEl.appendChild(renderNode(node, kind, 0));
        });
    }

    /** 递归渲染一个分区（年 → 月 → 周，具体到哪一级由当前范围决定） */
    function renderNode(node, kind, depth) {
        var childKind = kind === 'year' ? 'month' : (kind === 'month' ? 'week' : null);
        var children = kind === 'year' ? node.months : node.weeks;

        return section(node, kind, depth, function (body) {
            if (!childKind) {
                appendRecords(body, node.records);
                return;
            }

            (children || []).forEach(function (child) {
                body.appendChild(renderNode(child, childKind, depth + 1));
            });
        });
    }

    // --- 表单 ---------------------------------------------------------------

    /** 行为 / 类型两个下拉（自绘，统一 app 风格） */
    function createSelects() {
        behaviorSelect = global.LivologUI.createSelect(document.getElementById('time-behavior'), {
            getOptions: function () {
                return global.LivologStore.getBehaviors().map(function (behavior) {
                    return { value: behavior.id, label: behavior.name };
                });
            },
            getValue: function () {
                return behaviorValue;
            },
            onChange: function (value) {
                behaviorValue = value;
                // 换行为时把它习惯的记录类型带过来（用户仍可手改）
                applyPreferredType();
                validate();
            },
            isDisabled: function () {
                return global.LivologStore.getBehaviors().length === 0;
            },
            placeholder: function () {
                return t('time.form.needBehavior');
            }
        });

        typeSelect = global.LivologUI.createSelect(document.getElementById('time-type'), {
            getOptions: function () {
                return [
                    { value: 'moment', label: t('view.moment') },
                    { value: 'period', label: t('view.period') }
                ];
            },
            getValue: function () {
                return typeValue;
            },
            onChange: function (value) {
                /*
                   ⚠️ 用 seedForNewType 而不是 currentSeed()：跨类型必须丢弃旧时间。
                      时段默认「开始 = 1 小时前」，照搬到时点上会让「发生时间」
                      变成 1 小时前（用户报的就是这个）。
                */
                var seed = seedForNewType(value);
                typeValue = value;
                buildTimeFields(seed);
            },
            placeholder: function () {
                return t('time.form.type.none');
            }
        });
    }

    /**
     * 这个行为「偏向」的记录类型：记过的次数多的那种；一样多就用最近一次。
     * 从没记过就不猜，返回空串。
     */
    function preferredType(behaviorId) {
        if (!behaviorId) {
            return '';
        }

        // getRecords() 已经是按时间倒序，所以第一条就是这个行为最近一次的类型
        var count = {};
        var latest = '';
        global.LivologStore.getRecords().forEach(function (record) {
            if (record.behaviorId !== behaviorId || !record.type) {
                return;
            }
            if (!latest) {
                latest = record.type;
            }
            count[record.type] = (count[record.type] || 0) + 1;
        });

        var best = latest;
        Object.keys(count).forEach(function (type) {
            if (count[type] > count[best]) {
                best = type;
            }
        });
        return best;
    }

    /**
     * 按当前行为的习惯预选记录类型（只在「新增」时用）。
     * 自动填完照样能手动改，所以这里不做任何锁定。
     */
    function applyPreferredType() {
        if (editingId) {
            return;
        }

        var preferred = preferredType(behaviorValue);
        if (!preferred || preferred === typeValue) {
            return;
        }

        /*
           ⚠️ 换行为可能顺带换类型（按这个行为的习惯预选）。
              只要类型变了就**不要**沿用上一个行为的时间，否则会串味：
              上一个行为是时段（默认开始 = 1 小时前）时，切到一个时点行为后
              「发生时间」就成了 1 小时前，而不是「现在」。
        */
        var seed = seedForNewType(preferred);
        typeValue = preferred;
        buildTimeFields(seed);
        typeSelect.refresh();
    }

    /** 当前表单里已填的起止时间（读不出来就是 null） */
    function currentSeed() {
        var start = null;
        var end = null;

        if (groups.moment) {
            start = toTimestamp(readGroup(groups.moment));
        } else if (groups.start) {
            start = toTimestamp(readGroup(groups.start));
        }
        if (groups.end) {
            end = toTimestamp(readGroup(groups.end));
        }

        return { start: start, end: end };
    }

    /**
     * 换行为时要不要沿用上一份时间？
     *
     * ⚠️ 只有**同类型之间**才沿用。跨类型沿用会串味：
     *    时段（Period）默认「开始 = 1 小时前」，切到另一个时点（Moment）行为时
     *    如果照搬这个 seed，时点记录的「发生时间」就被填成 1 小时前，
     *    而不是用户期望的「现在」。所以跨类型时**丢弃**旧时间，走各自类型的默认值。
     */
    function seedForNewType(nextType) {
        return nextType === typeValue ? currentSeed() : null;
    }

    /** 类型决定时间怎么填：选之前第三行不可填写 */
    function buildTimeFields(seed) {
        fieldsEl.innerHTML = '';
        groups = {};

        var now = Date.now();
        var startAt = now;
        var endAt = now;

        if (seed && seed.start !== null) {
            // 编辑 / 同类型切换：沿用已有时间
            startAt = seed.start;
            endAt = seed.end !== null ? seed.end : seed.start;
        } else if (typeValue === 'period') {
            // 时段的默认跨度是「最近一小时」；时点（moment）用当前时间，见上方的 startAt = now
            startAt = now - 60 * 60 * 1000;
        }

        if (typeValue === 'period' && endAt <= startAt) {
            endAt = startAt + 60 * 60 * 1000;
        }

        if (typeValue === 'moment') {
            // 时点没有起止之分，给个提示文字占位（和下面 period 的「开始 / 结束」对齐）
            groups.moment = buildGroup(t('time.form.happen'), startAt, validate);
            fieldsEl.appendChild(groups.moment.root);
        } else if (typeValue === 'period') {
            groups.start = buildGroup(t('time.form.start'), startAt, validate);
            groups.end = buildGroup(t('time.form.end'), endAt, validate);
            fieldsEl.appendChild(groups.start.root);
            fieldsEl.appendChild(groups.end.root);
        }

        validate();
    }

    /**
     * 打开表单。
     * @param {object} [record] 传了就是「修改已有记录」，不传就是「新增」
     */
    function openForm(record) {
        var behaviors = global.LivologStore.getBehaviors();

        editingId = record && record.id ? record.id : null;

        if (editingId) {
            behaviorValue = record.behaviorId;
            typeValue = record.type;
        } else {
            behaviorValue = behaviors.length ? behaviors[0].id : '';
            // 新增：先按「第一个行为偏向的类型」预选，用户随时可改
            typeValue = preferredType(behaviorValue);
        }

        sheetTitle.textContent = t(editingId ? 'time.form.editTitle' : 'time.form.title');
        noteInput.value = editingId ? (record.note || '') : '';
        behaviorSelect.refresh();
        typeSelect.refresh();
        buildTimeFields(editingId ? { start: record.start, end: record.end } : null);

        global.LivologUI.openSheet(sheet);
        // 打开时也要按已有内容撑高（改已有记录时描述可能有好几行）
        autoGrow(noteInput);
    }

    /**
     * 让多行输入框按内容自动撑高。
     * ⚠️ 必须先把 height 归零再读 scrollHeight，否则框只会越撑越大、缩不回去。
     *   上限交给 CSS 的 `max-height`（还是超高就自己出现滚动条）。
     */
    function autoGrow(field) {
        field.style.height = 'auto';
        field.style.height = field.scrollHeight + 'px';
    }

    function validate() {
        var hasBehaviors = global.LivologStore.getBehaviors().length > 0;
        var type = typeValue;
        var start = null;
        var end = null;
        var hint = '';
        var ok = false;

        if (!hasBehaviors) {
            hint = t('time.form.needBehavior');
        } else if (!type) {
            hint = t('time.form.needType');
        } else if (type === 'moment') {
            start = toTimestamp(groups.moment ? readGroup(groups.moment) : null);
            if (start === null) {
                hint = t('time.form.invalidTime');
            } else {
                ok = true;
            }
        } else {
            start = toTimestamp(groups.start ? readGroup(groups.start) : null);
            end = toTimestamp(groups.end ? readGroup(groups.end) : null);
            if (start === null || end === null) {
                hint = t('time.form.invalidTime');
            } else if (end < start) {
                hint = t('time.form.endBeforeStart');
            } else {
                ok = true;
            }
        }

        hintEl.textContent = hint;
        hintEl.hidden = !hint;
        confirmBtn.disabled = !ok;

        return { ok: ok, start: start, end: end, type: type };
    }

    function submit() {
        var result = validate();
        if (!result.ok || !behaviorValue) {
            return;
        }

        if (editingId) {
            global.LivologStore.updateRecord(
                editingId,
                behaviorValue,
                result.type,
                result.start,
                result.end,
                noteInput.value
            );
        } else {
            global.LivologStore.addRecord(
                behaviorValue,
                result.type,
                result.start,
                result.end,
                noteInput.value
            );
        }

        editingId = null;
        global.LivologUI.closeSheet();

        // 只有新记录落在当前范围之外（比如在「最近一周」里补一条上个月的）才切回「全部」，
        // 保证有反馈；在范围内的记录不要动视图。
        // ⚠️ 这里以前拿 result.type 去比对，而视图早就改成范围了（all/year/month/week），
        //    比对必然不相等 → setView('moment') → 落到默认值，于是「最近一周」被重置成「全部」。
        var start = rangeStart();
        if (start !== null && result.start < start) {
            setView('all');
        }
    }

    // --- 初始化 -------------------------------------------------------------

    function init() {
        listEl = document.getElementById('time-list');
        viewLabel = document.getElementById('view-current');
        viewButton = document.getElementById('view-button');
        fab = document.getElementById('time-fab');
        sheet = document.getElementById('sheet-time');
        sheetTitle = document.getElementById('sheet-time-title');
        fieldsEl = document.getElementById('time-fields');
        hintEl = document.getElementById('time-hint');
        noteInput = document.getElementById('time-note');
        cancelBtn = document.getElementById('time-cancel');
        confirmBtn = document.getElementById('time-confirm');

        createSelects();

        viewButton.addEventListener('click', openViewMenu);
        fab.addEventListener('click', function () {
            openForm(null);
        });
        cancelBtn.addEventListener('click', function () {
            editingId = null;
            global.LivologUI.closeSheet();
        });
        confirmBtn.addEventListener('click', submit);

        /*
           描述框按内容自动撑高（上限由 CSS 的 max-height 管）。
           不这么做的话，框固定 2 行高，用户写第 3 行开始就看不到自己输的内容了
           （用户要求「即便换行也能看得很清楚」）。
        */
        noteInput.addEventListener('input', function () {
            autoGrow(noteInput);
        });

        global.LivologStore.onChange(function () {
            render();
            // 行为被删掉后，表单里的下拉要跟着更新
            behaviorSelect.refresh();
        });
        if (global.LivologI18n) {
            global.LivologI18n.onChange(function () {
                renderViewBar();
                render();
                behaviorSelect.refresh();
                typeSelect.refresh();
            });
        }

        var saved = null;
        try {
            saved = global.localStorage.getItem(VIEW_STORAGE_KEY);
        } catch (e) {
            /* 忽略 */
        }

        setView(VIEWS.indexOf(saved) >= 0 ? saved : DEFAULT_VIEW, { animate: false });
    }

    /** 交给 LivologUI 的多选目标 */
    var selection = {
        onSelectionChange: render,
        onDelete: function (ids) {
            global.LivologStore.removeRecords(ids);
        }
    };

    global.LivologTimePage = {
        init: init,
        render: render,
        openForm: openForm,
        selection: selection,
        // 行为详情页复用同一套时间格式化 / 卡片结构
        dateLine: dateLine,
        clockLine: clockLine,
        cardBody: cardBody,
        cardContent: cardContent,
        noteRow: noteRow,
        // 详情页的记录视图也按天分隔（与时间页同一个实现）
        dayMark: dayMark,
        appendRecordCards: appendRecordCards
    };
})(window);
