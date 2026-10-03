/**
 * Livolog - 通用 UI 组件：弹窗（底部表单）、下拉菜单、进入动画、DOM 小工具。
 */
(function (global) {
    'use strict';

    var ANIMATION_CLASSES = ['enter-forward', 'enter-backward'];
    var ANIMATION_MS = 260;
    var TRANSITION_MS = 220;
    /** 菜单高度下限：万一上下都极窄，也保证能看见几项 + 能滚 */
    var MIN_MENU_HEIGHT = 96;
    /** 滚动条显现后，停止滚动多久淡出 */
    var SCROLL_IDLE_MS = 700;

    var scrim = null;
    var currentSheet = null;
    var menuEl = null;
    var checklistScrim = null;
    var iconPickerPanel = null;

    /*
       ------------------------------------------------------------------------
       返回键处理（v0.1.28）

       ⚠️ 为什么需要这一套：app 是个单页应用，详情页 / 弹窗 / 菜单都不是新的 URL，
          所以原生那边的 `webView.canGoBack()` 大多为 false，按返回键会**直接退出 app**
          （用户报的 bug）。详情页虽然 `pushState` 了、能靠 `popstate` 兜住，
          但弹窗、下拉菜单、图标选择器、多选栏这些**都没有**历史记录，
          系统返回键对它们完全无效。

       做法：在这里登记「可关闭的层」，原生返回键统一问 `LivologUI.handleBack()`：
         - 返回 true  = 网页自己消化掉了（关掉了某一层），原生别退
         - 返回 false = 网页没有可关的层了，原生按原逻辑退出 / 走历史

       顺序按「视觉上最上面的一层优先」：图标选择器 → 下拉菜单 → 弹窗 → 多选栏。
       ⚠️ 顺序就是优先级，改动前先想清楚谁盖在谁上面。
    */
    function backLayers() {
        return [
            {
                // 图标选择器是居中模态（z-index 22），比弹窗还高
                active: function () { return !!iconPickerPanel; },
                close: function () { iconPickerPanel.close(); }
            },
            {
                // 下拉菜单挂在 body 上（z-index 20）
                active: function () { return !!menuEl; },
                close: closeMenu
            },
            {
                active: function () { return !!checklistScrim; },
                close: closeChecklist
            },
            {
                // 底部弹窗 + 遮罩（z-index 11 / 10）
                active: function () { return !!currentSheet; },
                close: closeSheet
            },
            {
                // 长按多选的操作栏（z-index 7）
                active: function () { return selection.active; },
                close: clearSelection
            }
        ];
    }

    /**
     * 把「有没有可关闭的层」推给原生。
     *
     * ⚠️ 原生返回键的处理是**同步**的（它得当场决定是消化掉还是退出 app），
     *    而 `evaluateJavascript` 是异步的、来不及，所以改成**由网页主动上报**，
     *    原生只读缓存。每次开/关层都要调这个，别只在打开时调。
     */
    function reportBackLayer() {
        try {
            if (global.LivologNative && typeof global.LivologNative.setBackLayer === 'function') {
                global.LivologNative.setBackLayer(hasBackLayer());
            }
        } catch (e) {
            /* 浏览器预览环境没有这个桥，忽略 */
        }
    }

    /**
     * 系统返回键的统一入口。
     * @returns {boolean} true = 已关闭某一层，调用方不要再退
     */
    function handleBack() {
        var layers = backLayers();
        for (var i = 0; i < layers.length; i++) {
            if (layers[i].active()) {
                layers[i].close();
                reportBackLayer();
                return true;
            }
        }
        return false;
    }

    /** 有没有任何可关闭的层（原生可用来决定返回键行为，避免误退） */
    function hasBackLayer() {
        return backLayers().some(function (layer) { return layer.active(); });
    }

    // --- DOM 小工具 ---------------------------------------------------------

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) {
            node.className = className;
        }
        if (text !== undefined && text !== null) {
            node.textContent = text;
        }
        return node;
    }

    /** 用图标库里的 path 生成一个 <span><svg/></span> */
    function icon(name, className) {
        var span = el('span', className || 'icon');
        span.setAttribute('aria-hidden', 'true');
        span.innerHTML = '<svg viewBox="0 0 24 24" focusable="false">' +
            global.LivologIcons.get(name) + '</svg>';
        return span;
    }

    function emptyState(text) {
        return el('li', 'empty-state', text);
    }

    function t(key) {
        return global.LivologI18n ? global.LivologI18n.t(key) : key;
    }

    // --- 轻提示 -------------------------------------------------------------

    var toastEl = null;
    var toastTimer = null;

    function toast(message) {
        if (!message) {
            return;
        }

        if (!toastEl) {
            toastEl = el('div', 'toast');
            document.body.appendChild(toastEl);
        }

        toastEl.textContent = message;
        toastEl.classList.remove('is-open');
        void toastEl.offsetWidth; // 重排一次，让连续提示也能重播动画
        toastEl.classList.add('is-open');

        if (toastTimer) {
            global.clearTimeout(toastTimer);
        }
        toastTimer = global.setTimeout(function () {
            toastEl.classList.remove('is-open');
        }, 2200);
    }

    // --- 原生壳通信 ---------------------------------------------------------

    /**
     * 原生通过 evaluateJavascript 调用这里，把系统栏尺寸与版本号推给网页。
     * 网页不依赖 env(safe-area-inset-*)，而是用这些变量自己让位，
     * 这样遮罩与弹窗能真正铺满整屏（包括状态栏那一条）。
     */
    var shell = {
        version: null,
        storagePath: '',
        storageError: '',

        setInsets: function (top, right, bottom, left, keyboard) {
            var style = document.documentElement.style;
            style.setProperty('--safe-top', top + 'px');
            style.setProperty('--safe-right', right + 'px');
            style.setProperty('--safe-bottom', bottom + 'px');
            style.setProperty('--safe-left', left + 'px');
            style.setProperty('--keyboard', keyboard + 'px');
        },

        setVersion: function (name, code) {
            shell.version = { name: String(name), code: code };
            if (global.LivologSettingPage && global.LivologSettingPage.refreshVersion) {
                global.LivologSettingPage.refreshVersion();
            }
        },

        getVersion: function () {
            return shell.version;
        },

        /** 原生读完 Livolog/records.csv 后把内容与路径推过来 */
        onStorageReady: function (csv, path) {
            shell.storagePath = path || '';
            refreshStorageUi();
            if (global.LivologStore && global.LivologStore.applyStoredCsv) {
                global.LivologStore.applyStoredCsv(csv);
            }
        },

        /** 落盘结果 */
        onCsvSaved: function (ok, detail) {
            if (ok) {
                shell.storagePath = detail || shell.storagePath;
                shell.storageError = '';
            } else {
                shell.storageError = detail || 'error';
                toast(t('toast.saveFailed') + ': ' + shell.storageError);
            }
            refreshStorageUi();
        },

        /** 原生读完 metrics.csv 后把内容推过来（与 records.csv 同一个目录） */
        onMetricsReady: function (csv) {
            if (global.LivologMetrics && global.LivologMetrics.applyStoredCsv) {
                global.LivologMetrics.applyStoredCsv(csv);
            }
        },

        onMetricsSaved: function (ok, detail) {
            if (!ok) {
                toast(t('toast.saveFailed') + ': ' + (detail || 'error'));
            }
        },

        /** 只换目录、内容不变（例如切到新文件夹后的回推），不动现有数据 */
        onStoragePathChanged: function (path) {
            shell.storagePath = path || '';
            shell.storageError = '';
            refreshStorageUi();
        },

        getStoragePath: function () {
            return shell.storagePath;
        },

        getStorageError: function () {
            return shell.storageError;
        },

        /** 设置页「导出数据」的结果（原生写完后回推） */
        onExported: function (ok, detail) {
            if (!ok) {
                toast(t('toast.exportFailed').replace('{reason}', detail || ''));
                return;
            }
            if (detail) {
                toast(t('toast.exported').replace('{path}', detail));
            } else {
                toast(t('toast.exportCanceled'));
            }
        },

        // --- 应用内更新（实现在 update.js） ---------------------------------

        onUpdateAvailable: function (version, current, size, stalled) {
            if (global.LivologUpdate) {
                global.LivologUpdate.onAvailable(version, current, size, stalled);
            }
        },

        onUpdateProgress: function (percent) {
            if (global.LivologUpdate) {
                global.LivologUpdate.onProgress(percent);
            }
        },

        onUpdateReady: function () {
            if (global.LivologUpdate) {
                global.LivologUpdate.onReady();
            }
        },

        onUpdateFailed: function (reason, downloaded) {
            if (global.LivologUpdate) {
                global.LivologUpdate.onFailed(reason, downloaded);
            }
        },

        /** 语言切换时刷新更新弹窗里的文案 */
        refreshUpdate: function () {
            if (global.LivologUpdate) {
                global.LivologUpdate.refresh();
            }
        }
    };

    function refreshStorageUi() {
        if (global.LivologSettingPage && global.LivologSettingPage.refreshStoragePath) {
            global.LivologSettingPage.refreshStoragePath();
        }
    }

    global.LivologShell = shell;

    // --- 自定义下拉选择器 ---------------------------------------------------

    var CHEVRON_PATH = '<path d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z"/>';

    /** 居中对话框（图标选择）离屏幕两侧至少留出的空隙 */
    var ICON_PANEL_MARGIN = 16;

    /**
     * 用自绘控件替代原生 <select>（原生在 WebView 里弹出的是系统样式，无法统一风格）。
     *
     * @param {HTMLElement} mount 容器，会被清空并填入按钮
     * @param {object} config
     *   getOptions:  () => [{ value, label }]
     *   getValue:    () => string
     *   onChange:    (value) => void
     *   isDisabled?: () => boolean
     *   placeholder?: () => string   当前值没有对应项时显示的文字
     * @returns {{ refresh: () => void }}
     */
    function createSelect(mount, config) {
        mount.innerHTML = '';

        var button = el('button', 'form-select');
        button.type = 'button';
        button.setAttribute('aria-haspopup', 'listbox');
        button.setAttribute('aria-expanded', 'false');

        var label = el('span', 'form-select-label');
        button.appendChild(label);
        mount.appendChild(button);

        var chevron = el('span', 'select-chevron');
        chevron.setAttribute('aria-hidden', 'true');
        chevron.innerHTML = '<svg viewBox="0 0 24 24" focusable="false">' + CHEVRON_PATH + '</svg>';
        mount.appendChild(chevron);

        function current() {
            var value = config.getValue();
            var found = null;
            (config.getOptions() || []).forEach(function (option) {
                if (option.value === value && found === null) {
                    found = option;
                }
            });
            return found;
        }

        function refresh() {
            var found = current();
            label.textContent = found
                ? found.label
                : (config.placeholder ? config.placeholder() : '');
            label.classList.toggle('is-placeholder', !found);
            button.disabled = config.isDisabled ? !!config.isDisabled() : false;
        }

        button.addEventListener('click', function () {
            if (button.disabled) {
                return;
            }

            var value = config.getValue();
            var items = (config.getOptions() || []).map(function (option) {
                return {
                    value: option.value,
                    label: option.label,
                    selected: option.value === value
                };
            });

            if (!items.length) {
                return;
            }

            button.setAttribute('aria-expanded', 'true');
            openMenu(button, items, function (next) {
                button.setAttribute('aria-expanded', 'false');
                config.onChange(next);
                // 选完必须自己刷一次按钮文字，否则上面还挂着旧值
                // （onChange 里多半只是改数据 / 重画表单，不会回头照顾这个按钮）
                refresh();
            });
        });

        refresh();

        return { refresh: refresh };
    }

    /**
     * 「整行可点」的设置项选择器：左边名称、右边当前值，点整行弹下拉菜单。
     * 设置页用它；表单里就地显示下拉控件的地方仍用 createSelect。
     *
     * @param {HTMLElement} row 可点击的整行
     * @param {HTMLElement} valueEl 显示当前值的元素
     * @param {object} config 同 createSelect
     */
    function createRowPicker(row, valueEl, config) {
        function refresh() {
            var value = config.getValue();
            var found = null;
            (config.getOptions() || []).forEach(function (option) {
                if (option.value === value && found === null) {
                    found = option;
                }
            });

            valueEl.textContent = found
                ? found.label
                : (config.placeholder ? config.placeholder() : '');
            row.disabled = config.isDisabled ? !!config.isDisabled() : false;
        }

        row.addEventListener('click', function () {
            if (row.disabled) {
                return;
            }

            var value = config.getValue();
            var items = (config.getOptions() || []).map(function (option) {
                return {
                    value: option.value,
                    label: option.label,
                    selected: option.value === value
                };
            });

            if (!items.length) {
                return;
            }

            row.setAttribute('aria-expanded', 'true');
            openMenu(row, items, function (next) {
                row.setAttribute('aria-expanded', 'false');
                config.onChange(next);
            });
        });

        refresh();

        return { refresh: refresh };
    }

    /**
     * 图标选择器：行内只显示当前选中的图标，点一下弹出一整块图标面板。
     * 图标多了以后横向滑条太长，所以改成「点开再选」。
     * @param {HTMLElement} mount 容器，会被清空
     * @returns {{ select: (name: string) => void, getSelected: () => string }}
     */
    function createIconPicker(mount) {
        var names = global.LivologIcons.names();
        // 默认选中「常用」里的第一个，而不是整表第一个（整表第一个未必常用）
        var favorite = global.LivologIcons.namesIn('favorite');
        var selected = favorite.length ? favorite[0] : names[0];

        mount.innerHTML = '';

        var trigger = el('button', 'icon-trigger');
        trigger.type = 'button';
        trigger.setAttribute('aria-haspopup', 'dialog');
        trigger.setAttribute('aria-expanded', 'false');
        trigger.appendChild(icon(selected, 'icon-trigger-icon'));
        mount.appendChild(trigger);

        var panel = el('div', 'icon-panel');
        // 面板是**居中弹出的对话框**：盖在整个视窗正中间，而不是贴着表单某一角。
        // 图标有 60+ 个，挤在表单右侧那块小地方必然要么裁列、要么把页面顶宽。
        // ⚠️ 宽度只在「视窗 − 两侧留白」里取，所以永远不出屏、也不会撑宽页面。
        var rootStyle = getComputedStyle(document.documentElement);
        var optionSize = rootStyle.getPropertyValue('--icon-option').trim();
        var gapSize = rootStyle.getPropertyValue('--icon-gap').trim();
        var padSize = rootStyle.getPropertyValue('--icon-panel-pad').trim();
        var columns = parseInt(rootStyle.getPropertyValue('--icon-cols'), 10) || 7;
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');
        panel.hidden = true;

        /**
         * 按当前视口定宽：取「列数算出来的理想宽度」与「视窗宽度 − 两侧留白」的较小者。
         * 居中交给 CSS（left/top 50% + translate(-50%, -50%)）。
         */
        function place() {
            var wanted = columns * (parseFloat(optionSize) || 40) +
                (columns - 1) * (parseFloat(gapSize) || 4) +
                2 * (parseFloat(padSize) || 10);
            var available = window.innerWidth - 2 * ICON_PANEL_MARGIN;
            panel.style.width = Math.min(wanted, available) + 'px';
        }

        var toolbar = el('div', 'icon-panel-head');
        toolbar.appendChild(el('span', 'icon-panel-title', t('icon.pick')));
        var closeButton = el('button', 'icon-button');
        closeButton.type = 'button';
        closeButton.setAttribute('aria-label', t('action.close'));
        closeButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
            '<path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>' +
            '</svg>';
        toolbar.appendChild(closeButton);
        panel.appendChild(toolbar);

        // --- 搜索栏 ---------------------------------------------------------
        // 中英文都能搜（关键词表在 icons.js 的 kw 里），输入即过滤。
        var searchBar = el('div', 'icon-search');
        var searchInput = document.createElement('input');
        searchInput.className = 'icon-search-input';
        searchInput.type = 'search';
        searchInput.autocomplete = 'off';
        searchInput.setAttribute('data-i18n-placeholder', 'icon.search');
        searchInput.placeholder = t('icon.search');
        searchBar.appendChild(searchInput);
        var searchClear = el('button', 'icon-button icon-search-clear');
        searchClear.type = 'button';
        searchClear.setAttribute('aria-label', t('action.clear'));
        searchClear.hidden = true;
        searchClear.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
            '<path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>' +
            '</svg>';
        searchBar.appendChild(searchClear);
        panel.appendChild(searchBar);

        // --- 分类 + 图标 ----------------------------------------------------
        // 骨架一次建好，之后只切 hidden，不重建 DOM。
        var bodyEl = el('div', 'icon-body');
        var categoryEls = [];

        /** 一个图标按钮（分类视图与搜索结果共用，行为一致） */
        function makeOption(name) {
            var button = el('button', 'icon-option');
            button.type = 'button';
            button.dataset.icon = name;
            button.setAttribute('aria-label', name);
            button.appendChild(icon(name));
            button.addEventListener('click', function () {
                select(name);
                close();
            });
            return button;
        }

        global.LivologIcons.categories().forEach(function (category) {
            var members = global.LivologIcons.namesIn(category.id);
            if (!members.length) {
                return;
            }

            var section = el('div', 'icon-category');
            section.dataset.category = category.id;

            var head = el('button', 'icon-category-head');
            head.type = 'button';
            head.appendChild(el('span', 'icon-category-chevron')).innerHTML =
                '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
                '<path d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z"/></svg>';
            head.appendChild(el('span', 'icon-category-title', t(category.label)));
            head.appendChild(el('span', 'icon-category-count', String(members.length)));
            section.appendChild(head);

            var grid = el('div', 'icon-grid');
            members.forEach(function (name) {
                grid.appendChild(makeOption(name));
            });
            section.appendChild(grid);

            // 折叠状态：只有「常用」默认展开
            var opened = !!category.defaultOpen;
            var apply = function () {
                grid.hidden = !opened;
                head.setAttribute('aria-expanded', opened ? 'true' : 'false');
                section.classList.toggle('is-collapsed', !opened);
            };
            apply();

            head.addEventListener('click', function () {
                opened = !opened;
                apply();
            });

            bodyEl.appendChild(section);
            categoryEls.push({
                id: category.id,
                section: section,
                head: head,
                grid: grid
            });
        });
        panel.appendChild(bodyEl);

        // 搜索结果区（搜索时替掉分类视图）
        var resultsEl = el('div', 'icon-results');
        var resultsGrid = el('div', 'icon-grid');
        resultsEl.appendChild(resultsGrid);
        var emptyEl = el('p', 'icon-results-empty', t('icon.searchEmpty'));
        emptyEl.hidden = true;
        resultsEl.appendChild(emptyEl);
        resultsEl.hidden = true;
        panel.appendChild(resultsEl);

        function setQuery(query) {
            var text = String(query || '').trim();
            searchClear.hidden = !text;
            bodyEl.hidden = !!text;
            resultsEl.hidden = !text;
            if (!text) {
                return;
            }
            // 每次重新建按钮（结果通常很少，重建比同步两份列表简单）
            resultsGrid.innerHTML = '';
            var hits = global.LivologIcons.search(text);
            hits.forEach(function (name) {
                resultsGrid.appendChild(makeOption(name));
            });
            emptyEl.hidden = hits.length > 0;
        }

        searchInput.addEventListener('input', function () {
            setQuery(searchInput.value);
        });
        searchClear.addEventListener('click', function () {
            searchInput.value = '';
            setQuery('');
            searchInput.focus();
        });

        // 遮罩：面板是居中对话框，后面压一层暗底才看得出「这是个模态」。
        // ⚠️ 挂在 #app 上、用 position: fixed —— 面板要盖住整个视窗，
        //    挂在 .sheet 里会被弹窗的层叠与 overflow 限制住。
        var scrim = el('div', 'icon-scrim');
        scrim.hidden = true;
        var layer = document.getElementById('app') || document.body;
        layer.appendChild(scrim);
        layer.appendChild(panel);

        function reflect() {
            trigger.replaceChild(icon(selected, 'icon-trigger-icon'), trigger.firstChild);
            // 分类视图与搜索结果里的按钮都要跟着高亮
            Array.prototype.forEach.call(
                panel.querySelectorAll('.icon-option'),
                function (button) {
                    button.classList.toggle('is-selected', button.dataset.icon === selected);
                }
            );
        }

        function open() {
            place();
            scrim.hidden = false;
            panel.hidden = false;
            // 登记到返回键栈上（见 handleBack）
            iconPickerPanel = { close: close };
            reportBackLayer();
            // 每次打开都清掉上次的搜索词，回到分类视图
            searchInput.value = '';
            setQuery('');
            // 下一帧再加 is-open，让透明度过渡能跑起来
            requestAnimationFrame(function () {
                scrim.classList.add('is-open');
                panel.classList.add('is-open');
            });
            trigger.setAttribute('aria-expanded', 'true');
            // 选中的那个滚进可视区
            var active = panel.querySelector('.icon-option.is-selected');
            if (active && active.scrollIntoView) {
                active.scrollIntoView({ block: 'center' });
            }
        }

        function close() {
            scrim.hidden = true;
            scrim.classList.remove('is-open');
            panel.hidden = true;
            panel.classList.remove('is-open');
            trigger.setAttribute('aria-expanded', 'false');
            iconPickerPanel = null;
            reportBackLayer();
        }

        function select(name) {
            if (!global.LivologIcons.has(name)) {
                return;
            }
            selected = name;
            reflect();
        }

        trigger.addEventListener('click', function () {
            if (panel.hidden) {
                open();
            } else {
                close();
            }
        });
        closeButton.addEventListener('click', close);
        // 点遮罩关闭
        scrim.addEventListener('click', close);

        // 切语言时面板里的文案要跟着变（分类名 / 搜索框 / 空态提示）
        if (global.LivologI18n) {
            global.LivologI18n.onChange(function () {
                panel.querySelector('.icon-panel-title').textContent = t('icon.pick');
                closeButton.setAttribute('aria-label', t('action.close'));
                searchClear.setAttribute('aria-label', t('action.clear'));
                emptyEl.textContent = t('icon.searchEmpty');
                global.LivologIcons.categories().forEach(function (category) {
                    categoryEls.forEach(function (entry) {
                        if (entry.id === category.id) {
                            var title = entry.section.querySelector('.icon-category-title');
                            if (title) {
                                title.textContent = t(category.label);
                            }
                        }
                    });
                });
            });
        }

        reflect();

        return {
            select: select,
            getSelected: function () {
                return selected;
            }
        };
    }

    // --- 长按 ---------------------------------------------------------------

    var LONG_PRESS_MS = 500;
    var longPressAt = 0;

    function attachLongPress(element, handler) {
        var timer = null;

        function cancel() {
            if (timer) {
                global.clearTimeout(timer);
                timer = null;
            }
        }

        function start() {
            cancel();
            timer = global.setTimeout(function () {
                timer = null;
                longPressAt = Date.now();
                handler();
            }, LONG_PRESS_MS);
        }

        element.addEventListener('touchstart', start, { passive: true });
        element.addEventListener('touchend', cancel);
        element.addEventListener('touchmove', cancel);
        element.addEventListener('touchcancel', cancel);
        element.addEventListener('mousedown', start);
        element.addEventListener('mouseup', cancel);
        element.addEventListener('mouseleave', cancel);
    }

    /** 长按之后紧跟的那次 click 要忽略掉 */
    function justLongPressed() {
        return Date.now() - longPressAt < 400;
    }

    // --- 长按拖动排序 -------------------------------------------------------

    var SORT_HOLD_MS = 350;
    /** 长按期间手指/鼠标移动超过这个距离就当成滚动，不算长按 */
    var SORT_MOVE_TOLERANCE = 8;

    /**
     * 让列表里的卡片可以长按后拖动排序。
     * 拖动过程中就地重排（相邻卡片直接换位，不做位移补间），松手时把新顺序回调出去，
     * 由调用方写回数据层。
     *
     * @param {HTMLElement} list 列表容器（只处理它的直接子元素）
     * @param {object} config
     *   itemSelector?: string 默认 '.card'
     *   onDrop: (ids: Array<string>) => void
     */
    function attachSortable(list, config) {
        var itemSelector = config.itemSelector || '.card';
        var holdTimer = null;
        var dragEl = null;
        var pointerId = null;
        var startY = 0;
        var draggedAt = 0;

        function cards() {
            return Array.prototype.filter.call(list.children, function (child) {
                return child.matches && child.matches(itemSelector);
            });
        }

        function stopHold() {
            if (holdTimer) {
                global.clearTimeout(holdTimer);
                holdTimer = null;
            }
        }

        /** 拖动期间不让页面跟着滚：touch-action 在触摸开始后就改不动了，只能拦 touchmove */
        function preventScroll(event) {
            event.preventDefault();
        }

        /** 把被拖的卡片插到手指所在的位置 */
        function moveTo(y) {
            var siblings = cards();
            var target = null;

            siblings.forEach(function (card) {
                if (card === dragEl || target) {
                    return;
                }
                var box = card.getBoundingClientRect();
                if (y < box.top + box.height / 2) {
                    target = card;
                }
            });

            if (target) {
                if (target.previousElementSibling !== dragEl) {
                    list.insertBefore(dragEl, target);
                }
            } else if (siblings.length && siblings[siblings.length - 1] !== dragEl) {
                list.appendChild(dragEl);
            }
        }

        function startDrag(event) {
            var card = event.target.closest ? event.target.closest(itemSelector) : null;
            if (!card || !list.contains(card)) {
                return;
            }

            dragEl = card;
            pointerId = event.pointerId;
            card.classList.add('is-dragging');
            list.classList.add('is-sorting');
            document.addEventListener('touchmove', preventScroll, { passive: false });
        }

        function stopDrag(commit) {
            document.removeEventListener('touchmove', preventScroll);
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            document.removeEventListener('pointercancel', onUp);
            list.classList.remove('is-sorting');
            stopHold();

            var dragged = dragEl;
            dragEl = null;
            pointerId = null;

            if (!dragged) {
                return;
            }

            dragged.classList.remove('is-dragging');
            draggedAt = Date.now();

            if (commit !== false && config.onDrop) {
                config.onDrop(cards().map(function (card) {
                    return card.dataset.id;
                }));
            }
        }

        function onMove(event) {
            if (dragEl && (pointerId === null || event.pointerId === pointerId)) {
                moveTo(event.clientY);
            }
        }

        function onUp() {
            if (dragEl) {
                stopDrag(true);
            }
        }

        list.addEventListener('pointerdown', function (event) {
            if (dragEl || holdTimer) {
                return;
            }
            if (event.button !== undefined && event.button !== 0) {
                return;
            }
            if (!event.target.closest || !event.target.closest(itemSelector)) {
                return;
            }

            startY = event.clientY;
            var seed = event;
            holdTimer = global.setTimeout(function () {
                holdTimer = null;
                startDrag(seed);
                if (dragEl) {
                    document.addEventListener('pointermove', onMove);
                    document.addEventListener('pointerup', onUp);
                    document.addEventListener('pointercancel', onUp);
                }
            }, SORT_HOLD_MS);
        });

        // 还没到长按时间就开始移动 = 用户在滚动列表
        list.addEventListener('pointermove', function (event) {
            if (holdTimer && Math.abs(event.clientY - startY) > SORT_MOVE_TOLERANCE) {
                stopHold();
            }
        });

        list.addEventListener('pointerup', stopHold);
        list.addEventListener('pointercancel', stopHold);

        // 拖完紧跟的那次 click 不能触发卡片的正常点击（否则会点进详情页）
        list.addEventListener('click', function (event) {
            if (Date.now() - draggedAt < 400) {
                event.preventDefault();
                event.stopPropagation();
            }
        }, true);
    }

    // --- 进入动画 -----------------------------------------------------------

    /** direction < 0 从左侧进入，否则从右侧进入 */
    function animateEnter(element, direction) {
        if (!element) {
            return;
        }

        ANIMATION_CLASSES.forEach(function (className) {
            element.classList.remove(className);
        });
        void element.offsetWidth; // 强制重排，保证连续切换时动画能重播

        var className = direction < 0 ? 'enter-backward' : 'enter-forward';
        element.classList.add(className);

        global.setTimeout(function () {
            element.classList.remove(className);
        }, ANIMATION_MS);
    }

    // --- 弹窗 ---------------------------------------------------------------

    function openSheet(sheet) {
        if (!sheet) {
            return;
        }
        closeMenu();
        hideSheet(currentSheet, true);

        currentSheet = sheet;
        scrim.hidden = false;
        sheet.hidden = false;
        reportBackLayer();

        global.requestAnimationFrame(function () {
            scrim.classList.add('is-open');
            sheet.classList.add('is-open');
        });
    }

    function closeSheet() {
        hideSheet(currentSheet, false);
        currentSheet = null;
        reportBackLayer();
    }

    function hideSheet(sheet, immediate) {
        if (!sheet) {
            return;
        }

        sheet.classList.remove('is-open');
        scrim.classList.remove('is-open');

        if (immediate) {
            sheet.hidden = true;
            if (!currentSheet) {
                scrim.hidden = true;
            }
            return;
        }

        global.setTimeout(function () {
            sheet.hidden = true;
            if (!currentSheet) {
                scrim.hidden = true;
            }
        }, TRANSITION_MS);
    }

    // --- 下拉菜单 -----------------------------------------------------------

    function onDocumentPointerDown(event) {
        if (menuEl && !menuEl.contains(event.target)) {
            closeMenu();
        }
    }

    /**
     * 页面滚动时收起菜单（菜单是 `position: fixed`，不跟着滚，留着会飘在错位置）。
     *
     * ⚠️⚠️ 必须判断滚动来源，不能无条件 `closeMenu`（v0.1.27 修的 bug）：
     *    监听挂在 `window` 的**捕获**阶段，而 scroll 事件虽然不冒泡、却会在
     *    捕获阶段经过 window —— 于是**菜单自己内部滚动**也会触发这个回调，
     *    结果是「时区列表一滑就整块消失」（用户报的 bug）。
     *    菜单能滚是刚需（27 项放不下），所以这里只对**菜单之外**的滚动做收起。
     */
    function onDocumentScroll(event) {
        if (!menuEl) {
            return;
        }
        var target = event.target;
        if (target === document || target === global ||
            (target && menuEl.contains(target))) {
            return;   // 菜单自己的滚动（或无法判定来源）→ 不动它
        }
        closeMenu();
    }

    function closeMenu() {
        if (!menuEl) {
            return;
        }

        var node = menuEl;
        menuEl = null;
        reportBackLayer();

        node.classList.remove('is-open');
        document.removeEventListener('pointerdown', onDocumentPointerDown, true);
        global.removeEventListener('scroll', onDocumentScroll, true);

        global.setTimeout(function () {
            if (node.parentNode) {
                node.parentNode.removeChild(node);
            }
        }, TRANSITION_MS);
    }

    /**
     * 在 anchor 下方弹出菜单。
     * @param {Element} anchor
     * @param {Array<{value:string,label:string,selected?:boolean,danger?:boolean}>} items
     *        danger = 破坏性操作（删除等），文字标红
     * @param {(value:string)=>void} onSelect
     */
    function openMenu(anchor, items, onSelect) {
        closeMenu();

        var node = el('div', 'menu');
        node.setAttribute('role', 'menu');

        items.forEach(function (item) {
            var button = el('button', 'menu-item', item.label);
            button.type = 'button';
            button.setAttribute('role', 'menuitem');
            if (item.selected) {
                button.classList.add('is-selected');
            }
            if (item.danger) {
                button.classList.add('is-danger');
            }
            button.addEventListener('click', function () {
                closeMenu();
                onSelect(item.value);
            });
            node.appendChild(button);
        });

        document.body.appendChild(node);
        menuEl = node;
        reportBackLayer();

        var rect = anchor.getBoundingClientRect();
        var width = node.offsetWidth;
        /*
           ⚠️ 位置必须**上下都算**，不能无脑挂在 anchor 下方。
              以前只写 `top = rect.bottom + 6`，长菜单（时区 26 项、图标列表等）
              会直接冲出视口底部，而 `.menu` 又没有滚动条 ——
              下面那些选项**永远点不到**（用户抓到的 bug）。
              现在的策略：优先下方；下方放不下就往上翻；上下都放不下时，
              挑空间大的一侧，高度由 CSS 的 `max-height` 截住并出现滚动。
        */
        var MARGIN = 8;
        var GAP = 6;
        var below = global.innerHeight - rect.bottom - GAP - MARGIN;
        var above = rect.top - GAP - MARGIN;

        /*
           ⚠️ 这里量的是**内容完整高度**（还没被 `max-height` 截），
              所以要先把上一轮的 inline 高度清掉再量，否则第二次打开会拿到旧值。
        */
        node.style.maxHeight = '';
        var natural = node.offsetHeight;

        var openUp = false;
        if (natural > below && above > below) {
            openUp = true;
        }

        var available = Math.max(openUp ? above : below, MIN_MENU_HEIGHT);
        node.style.maxHeight = available + 'px';

        var left = Math.min(rect.right - width, global.innerWidth - width - MARGIN);
        node.style.left = Math.max(MARGIN, left) + 'px';
        node.style.top = (openUp
            ? rect.top - GAP - Math.min(natural, available)
            : rect.bottom + GAP) + 'px';

        // 箭头/圆角方向跟着翻转方向走，别让菜单看起来「从下面长出来」
        node.classList.toggle('is-upward', openUp);

        global.requestAnimationFrame(function () {
            node.classList.add('is-open');
        });

        global.setTimeout(function () {
            document.addEventListener('pointerdown', onDocumentPointerDown, true);
            global.addEventListener('scroll', onDocumentScroll, true);
        }, 0);
    }

    /**
     * 居中模态的**多选清单**（跟踪统计的「Select」用它挑要看哪几个项目）。
     *
     * 和 openMenu 的区别：菜单是单选 + 贴着触发元素弹，这里是**多选** + 居中模态
     * （和图标选择器同一套观感：遮罩 + 正中的面板 + 确定 / 取消）。
     *
     * @param {object} options
     *   title:    string
     *   items:    [{ id, label, checked }]
     *   allLabel: string   「全选」那一行的文案
     *   confirmLabel / cancelLabel: string
     *   onConfirm: (ids: string[]) => void   确定时回调选中的 id（空数组 = 全部）
     * @returns {{close: Function}}
     */
    function openChecklist(options) {
        closeChecklist();

        var scrim = el('div', 'checklist-scrim');
        var panel = el('div', 'checklist-panel');
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');

        panel.appendChild(el('div', 'checklist-title', options.title || ''));

        var body = el('div', 'checklist-body');
        var boxes = {};

        (options.items || []).forEach(function (item) {
            var row = el('label', 'checklist-item');
            var input = document.createElement('input');
            input.type = 'checkbox';
            input.className = 'checklist-box';
            input.checked = !!item.checked;
            input.addEventListener('change', function () {
                // 至少留一个选中，否则「什么都不选」会让人以为图表坏了
                if (!picked().length) {
                    input.checked = true;
                    return;
                }
                syncAll();
            });
            row.appendChild(input);
            row.appendChild(el('span', 'checklist-label', item.label));
            boxes[item.id] = input;
            body.appendChild(row);
        });

        // 顶部的「全选」：勾上就回到「全部」（等价于没有筛选）
        var allRow = el('label', 'checklist-item checklist-all');
        var allBox = document.createElement('input');
        allBox.type = 'checkbox';
        allBox.className = 'checklist-box';
        allRow.appendChild(allBox);
        allRow.appendChild(el('span', 'checklist-label', options.allLabel || 'All'));
        allBox.addEventListener('change', function () {
            var on = allBox.checked;
            Object.keys(boxes).forEach(function (id) {
                boxes[id].checked = on;
            });
            if (!on) {
                // 取消全选没意义（必须看点什么），恢复成全选
                allBox.checked = true;
                Object.keys(boxes).forEach(function (id) {
                    boxes[id].checked = true;
                });
            }
            syncAll();
        });
        body.insertBefore(allRow, body.firstChild);
        panel.appendChild(body);

        function picked() {
            return Object.keys(boxes).filter(function (id) {
                return boxes[id].checked;
            });
        }

        function syncAll() {
            var ids = picked();
            var allIds = Object.keys(boxes);
            allBox.checked = ids.length === allIds.length;
            allBox.indeterminate = ids.length > 0 && ids.length < allIds.length;
        }

        var actions = el('div', 'checklist-actions');
        var cancel = el('button', 'btn btn-text', options.cancelLabel || '');
        cancel.type = 'button';
        cancel.addEventListener('click', closeChecklist);

        var confirm = el('button', 'btn btn-primary', options.confirmLabel || '');
        confirm.type = 'button';
        confirm.addEventListener('click', function () {
            var ids = picked();
            var allIds = Object.keys(boxes);
            closeChecklist();
            // 全选 == 不筛选（存空数组，UI 显示 All）
            options.onConfirm(ids.length === allIds.length ? [] : ids);
        });

        actions.appendChild(cancel);
        actions.appendChild(confirm);
        panel.appendChild(actions);

        scrim.appendChild(panel);
        // 挂在 #app 上：position: fixed 会被 .page 的 overflow 裁掉
        (document.getElementById('app') || document.body).appendChild(scrim);
        checklistScrim = scrim;
        reportBackLayer();

        syncAll();

        // 点遮罩关闭
        scrim.addEventListener('click', function (event) {
            if (event.target === scrim) {
                closeChecklist();
            }
        });

        global.requestAnimationFrame(function () {
            scrim.classList.add('is-open');
        });

        return { close: closeChecklist };
    }

    function closeChecklist() {
        if (!checklistScrim) {
            return;
        }
        var node = checklistScrim;
        checklistScrim = null;
        reportBackLayer();
        node.classList.remove('is-open');
        global.setTimeout(function () {
            if (node.parentNode) {
                node.parentNode.removeChild(node);
            }
        }, 180);
    }

    // --- 卡片多选 -----------------------------------------------------------

    var selection = {
        active: false,
        ids: [],
        provider: null
    };
    var selectionBar = null;
    var selectionCount = null;

    /** 每页注册自己的回调；切页时由 app.js 重新绑定 */
    function bindSelection(provider) {
        selection.provider = provider || null;
        clearSelection();
    }

    function isSelecting() {
        return selection.active;
    }

    function isSelected(id) {
        return selection.ids.indexOf(id) >= 0;
    }

    function notifySelection() {
        if (selection.provider && selection.provider.onSelectionChange) {
            selection.provider.onSelectionChange();
        }
    }

    function openSelectionBar() {
        if (!selectionBar) {
            return;
        }
        selectionBar.hidden = false;
        global.requestAnimationFrame(function () {
            selectionBar.classList.add('is-open');
        });
    }

    function closeSelectionBar() {
        if (!selectionBar) {
            return;
        }
        selectionBar.classList.remove('is-open');
        global.setTimeout(function () {
            if (!selection.active) {
                selectionBar.hidden = true;
            }
        }, TRANSITION_MS);
    }

    function updateSelectionCount() {
        if (selectionCount) {
            selectionCount.textContent = t('selection.count').replace('{n}', String(selection.ids.length));
        }
    }

    function startSelection(id) {
        if (!selection.provider || selection.active) {
            return;
        }
        selection.active = true;
        selection.ids = id ? [id] : [];
        updateSelectionCount();
        openSelectionBar();
        notifySelection();
        reportBackLayer();
    }

    function toggleSelection(id) {
        if (!selection.active) {
            return;
        }

        var index = selection.ids.indexOf(id);
        if (index >= 0) {
            selection.ids.splice(index, 1);
        } else {
            selection.ids.push(id);
        }

        if (!selection.ids.length) {
            clearSelection();
            return;
        }

        updateSelectionCount();
        notifySelection();
    }

    function clearSelection() {
        var wasActive = selection.active;
        selection.active = false;
        selection.ids = [];
        if (wasActive) {
            closeSelectionBar();
        }
        notifySelection();
        reportBackLayer();
    }

    function deleteSelected() {
        var ids = selection.ids.slice();
        var provider = selection.provider;

        selection.active = false;
        selection.ids = [];
        closeSelectionBar();
        reportBackLayer();

        if (provider && provider.onDelete) {
            provider.onDelete(ids);
        }
    }

    // --- 初始化 -------------------------------------------------------------

    function init() {
        scrim = document.getElementById('scrim');
        if (scrim) {
            scrim.addEventListener('click', closeSheet);
        }

        selectionBar = document.getElementById('selection-bar');
        selectionCount = document.getElementById('selection-count');
        if (selectionBar) {
            var closeButton = document.getElementById('selection-close');
            var deleteButton = document.getElementById('selection-delete');
            if (closeButton) {
                closeButton.addEventListener('click', clearSelection);
            }
            if (deleteButton) {
                deleteButton.addEventListener('click', deleteSelected);
            }
        }

        document.addEventListener('keydown', function (event) {
            if (event.key !== 'Escape') {
                return;
            }
            if (menuEl) {
                closeMenu();
            } else if (currentSheet) {
                closeSheet();
            }
        });

        watchScrollbars();

        /*
           告诉原生「当前没有可关闭的层」。
           ⚠️ 必须上报一次初始状态：页面可能是在某个层展开时被重载的
              （比如渲染进程被回收后重建），原生的缓存值会停在旧状态。
        */
        reportBackLayer();
    }

    /**
     * 滚动条「用时显现、闲时淡出」。
     *
     * ⚠️ 为什么要这么绕：`::-webkit-scrollbar` 一旦声明样式就会变成**常驻**，
     *    在移动端窄屏上一条 4px 的滑块从头到尾贴在右边很吵（用户明确否过一次）。
     *    但完全不画又不行 —— 菜单这种「下面还有好几项」的容器没提示，用户会以为丢了。
     *    折中做法：默认透明，**正在滚动时**加 `.is-scrolling` 显现，停手后淡出。
     *
     * 用**事件委托**挂在 `document` 上（捕获阶段拿 scroll，因为 scroll 不冒泡），
     * 这样后续动态插入的容器（菜单、图标面板…）自动生效，不用一个个注册。
     */
    function watchScrollbars() {
        var timers = new WeakMap();

        var reveal = function (node) {
            if (!node || node.nodeType !== 1) {
                return;
            }
            // 只在「内容确实超出、真的能滚」时才显现，内容少的容器不闪一下
            if (node.scrollHeight <= node.clientHeight + 1 &&
                node.scrollWidth <= node.clientWidth + 1) {
                return;
            }
            node.classList.add('is-scrolling');
            global.clearTimeout(timers.get(node));
            timers.set(node, global.setTimeout(function () {
                node.classList.remove('is-scrolling');
            }, SCROLL_IDLE_MS));
        };

        document.addEventListener('scroll', function (event) {
            reveal(event.target === document ? document.documentElement : event.target);
        }, true);
    }

    global.LivologUI = {
        init: init,
        el: el,
        icon: icon,
        emptyState: emptyState,
        t: t,
        animateEnter: animateEnter,
        createSelect: createSelect,
        createRowPicker: createRowPicker,
        createIconPicker: createIconPicker,
        attachLongPress: attachLongPress,
        justLongPressed: justLongPressed,
        attachSortable: attachSortable,
        toast: toast,
        openSheet: openSheet,
        closeSheet: closeSheet,
        isSheetOpen: function () {
            return !!currentSheet;
        },
        currentSheet: function () {
            return currentSheet;
        },
        openMenu: openMenu,
        closeMenu: closeMenu,
        openChecklist: openChecklist,
        closeChecklist: closeChecklist,
        bindSelection: bindSelection,
        isSelecting: isSelecting,
        isSelected: isSelected,
        startSelection: startSelection,
        toggleSelection: toggleSelection,
        clearSelection: clearSelection,
        // 返回键：原生查这个（同步），也直接调 handleBack 关闭最上面那层
        handleBack: handleBack,
        hasBackLayer: hasBackLayer,
        reportBackLayer: reportBackLayer
    };
})(window);
