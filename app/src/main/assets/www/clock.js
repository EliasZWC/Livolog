/**
 * Livolog - 时间口径设置（时区 / 每周起始日）。
 *
 * 这两项会改变「一天从哪一刻开始」和「哪一天算一周的头」，
 * 所以时间页的分组、日期标记、以及统计里的按天归属都要走这里，
 * 不要各自去用 `new Date(...).getDate()` 那套本地时间。
 *
 * 时区实现思路：JS 的 `Date` 只能用系统时区，没有「这个 Date 属于哪个时区」的概念。
 * 于是统一走一个绕过本地时区的转换 ——
 *   某个绝对时刻 T 在时区 Z 下的「墙上时间」数字，等于
 *   `T + offset(Z, T)` 这个绝对时刻用 **UTC** 读出来的数字。
 * 反解（墙上时间 → 绝对时刻）因为夏令时不是双射，用两次逼近足够准。
 */
(function (global) {
    'use strict';

    /** 跟随系统（不偏移） */
    var TZ_SYSTEM = 'system';

    /** 每周起始日：0 = 周天，1 = 周一（跟 Date.getDay() 同一套编号） */
    var WEEK_START_SUNDAY = 0;
    var WEEK_START_MONDAY = 1;

    /**
     * 可选时区。列的是 UTC 偏移**固定的**地区（没有夏令时），
     * 这样「挑了个时区」的行为是稳定可预期的 —— 见下面 `resolveOffset` 的说明。
     * `offset` 单位是分钟，东区为正。
     */
    var ZONES = [
        { id: 'system', offset: null },
        { id: 'utc-11', offset: -11 * 60 },
        { id: 'utc-10', offset: -10 * 60 },
        { id: 'utc-9', offset: -9 * 60 },
        { id: 'utc-8', offset: -8 * 60 },
        { id: 'utc-7', offset: -7 * 60 },
        { id: 'utc-6', offset: -6 * 60 },
        { id: 'utc-5', offset: -5 * 60 },
        { id: 'utc-4', offset: -4 * 60 },
        { id: 'utc-3', offset: -3 * 60 },
        { id: 'utc-2', offset: -2 * 60 },
        { id: 'utc-1', offset: -1 * 60 },
        { id: 'utc0', offset: 0 },
        { id: 'utc1', offset: 1 * 60 },
        { id: 'utc2', offset: 2 * 60 },
        { id: 'utc3', offset: 3 * 60 },
        { id: 'utc4', offset: 4 * 60 },
        { id: 'utc5', offset: 5 * 60 },
        { id: 'utc6', offset: 6 * 60 },
        { id: 'utc7', offset: 7 * 60 },
        { id: 'utc8', offset: 8 * 60 },
        { id: 'utc9', offset: 9 * 60 },
        { id: 'utc10', offset: 10 * 60 },
        { id: 'utc11', offset: 11 * 60 },
        { id: 'utc12', offset: 12 * 60 },
        { id: 'utc13', offset: 13 * 60 },
        { id: 'utc14', offset: 14 * 60 }
    ];

    var MODE_KEY = 'livolog.timezone';
    var WEEK_START_KEY = 'livolog.weekStart';

    var listeners = [];

    function read(key, fallback) {
        try {
            var value = global.localStorage.getItem(key);
            return value === null ? fallback : value;
        } catch (e) {
            return fallback;
        }
    }

    function write(key, value) {
        try {
            global.localStorage.setItem(key, value);
        } catch (e) {
            /* 存不下就只在本次会话生效 */
        }
    }

    function notify() {
        listeners.slice().forEach(function (listener) {
            try {
                listener();
            } catch (e) {
                /* 单个监听器出错不影响其它 */
            }
        });
    }

    // --- 时区 ---------------------------------------------------------------

    function getTimezone() {
        var id = read(MODE_KEY, TZ_SYSTEM);
        return zoneById(id) ? id : TZ_SYSTEM;
    }

    function setTimezone(id) {
        write(MODE_KEY, zoneById(id) ? id : TZ_SYSTEM);
        notify();
    }

    function zoneById(id) {
        for (var i = 0; i < ZONES.length; i++) {
            if (ZONES[i].id === id) {
                return ZONES[i];
            }
        }
        return null;
    }

    function zones() {
        return ZONES.slice();
    }

    /**
     * 当前时区相对 UTC 的偏移（分钟，东区为正）。
     *
     * ⚠️ 自己挑的时区一律用**固定偏移**，不查该地区的夏令时历史：我们列的是
     *    `UTC+8` 这种纯偏移标签，本来就只承诺偏移量；真要按地区算夏令时，
     *    得内建一整张 tzdata，为这个功能不值得。
     *    跟随系统时则由 `getTimezoneOffset()` 给出真实值（夏令时自然就对了）。
     */
    function offsetMinutes() {
        return offsetMinutesAt(Date.now());
    }

    // --- 墙上时间 ←→ 绝对时刻 -----------------------------------------------

    /**
     * 绝对时刻 → 该时区下的墙上时间，**表示成一个「假装是 UTC」的 Date**。
     * 之后一律用 `getUTCFullYear()` 这类 UTC 访问器读它，不能用本地访问器。
     */
    function wall(timestamp) {
        return new Date(timestamp + offsetMinutesAt(timestamp) * 60000);
    }

    /**
     * 墙上时间的年月日时分 → 绝对时刻。
     *
     * ⚠️ 跟随系统 + 夏令时的时候，这是**多对一**（春季被跳掉的那一小时不存在、
     *    秋季那一小时出现两次），所以严格的反解不存在。用两轮逼近取一个
     *    稳定且合理的结果就够了：第一轮按当前偏移猜，第二轮用猜出来的时刻
     *    自己所在时刻的偏移修正。
     *    自己挑的时区是固定偏移，一轮就精确，第二轮相当于原地不动。
     */
    function stamp(year, month, day, hour, minute) {
        var ymd = Date.UTC(year, month - 1, day, hour || 0, minute || 0);
        var offset = offsetMinutesAt(ymd);
        var result = ymd - offset * 60000;
        offset = offsetMinutesAt(result);
        return ymd - offset * 60000;
    }

    /**
     * 某个绝对时刻的偏移。跟随系统时按**那个时刻**查（夏令时自然就对）；
     * 自己挑的时区是固定值，参数用不上。
     */
    function offsetMinutesAt(timestamp) {
        var zone = zoneById(getTimezone());
        if (!zone || zone.offset === null) {
            return -new Date(timestamp).getTimezoneOffset();
        }
        return zone.offset;
    }

    /** 该时区下这一天的零点 */
    function startOfDay(timestamp) {
        var w = wall(timestamp);
        return stamp(w.getUTCFullYear(), w.getUTCMonth() + 1, w.getUTCDate(), 0, 0);
    }

    /** 把 Date 拆成该时区下的年月日等字段 */
    function parts(timestamp) {
        var w = wall(timestamp);
        return {
            year: w.getUTCFullYear(),
            month: w.getUTCMonth() + 1,
            day: w.getUTCDate(),
            hour: w.getUTCHours(),
            minute: w.getUTCMinutes(),
            weekday: w.getUTCDay()
        };
    }

    /** 形如 2026-09-24 */
    function formatDate(timestamp) {
        var p = parts(timestamp);
        return p.year + '-' + pad(p.month, 2) + '-' + pad(p.day, 2);
    }

    /** 形如 08:05 */
    function formatClock(timestamp) {
        var p = parts(timestamp);
        return pad(p.hour, 2) + ':' + pad(p.minute, 2);
    }

    function pad(value, length) {
        var text = String(value);
        while (text.length < length) {
            text = '0' + text;
        }
        return text;
    }

    // --- 每周起始日 ---------------------------------------------------------

    function getWeekStart() {
        var value = Number(read(WEEK_START_KEY, WEEK_START_SUNDAY));
        return value === WEEK_START_MONDAY ? WEEK_START_MONDAY : WEEK_START_SUNDAY;
    }

    function setWeekStart(value) {
        write(WEEK_START_KEY, Number(value) === WEEK_START_MONDAY
            ? String(WEEK_START_MONDAY)
            : String(WEEK_START_SUNDAY));
        notify();
    }

    /**
     * 某个日期（该时区下的年月日）所属周的**首日**的绝对时刻。
     *
     * ⚠️ 一周从哪天开始**跟随设置**（`getWeekStart()`：0 = 周日 / 1 = 周一）。
     *    用户 2026-09-29 明确：「更改起始时间就是在更改自然周的定义」。
     *
     *    这里以前固定按 ISO 的「周一为一周之首」算，注释里当时的顾虑是
     *    「换成周日起始后同一条记录会从 W4 跳到 W5，看起来像记录跑到了别的周」。
     *    但那本来就是正确的行为 —— 重新定义自然周，边界当然会移动。
     *    （v0.1.20 那条「周分组固定按周一切」的决定已被本次推翻。）
     *
     * 用「首日日期」而不是 ISO 周号做 key：跨年时周号会跳，
     * 相邻两周还要比较年份，容易出错。
     * @returns {number} 该周首日的零点（绝对时刻）
     */
    function weekStartOf(timestamp) {
        var day = startOfDay(timestamp);
        // 距「一周首日」要往回退几天
        var weekday = parts(day).weekday;
        var start = firstWeekdayIndex();
        var back = (weekday - start + 7) % 7;
        return day - back * 86400000;
    }

    /**
     * 稳定且单调的周分组键（`YYYY-MM-DD` 形式的**周首日**）。
     */
    function weekKey(timestamp) {
        return formatDate(weekStartOf(timestamp));
    }

    /**
     * 用户设置里「一周的头」在第几列（用于列表里排星期顺序，
     * 以及决定一周的显示区间）。
     * @returns {number} 0..6
     */
    function firstWeekdayIndex() {
        return getWeekStart();
    }

    /**
     * 该周 7 天的**展示顺序**（weekday 编号），从设置的「一周首日」开始。
     *
     * ⚠️ 现在分组本身已经跟随 `weekStart`（见 `weekStartOf`），
     *    所以这个顺序与 `weekStartOf` 算出的边界是**自洽**的：
     *    第一项就是该周的首日。列表若要按天排，用它即可。
     * @returns {Array<number>} 7 个 weekday 编号（0 = 周日）
     */
    function weekDaysOf() {
        var order = [0, 1, 2, 3, 4, 5, 6];
        var at = firstWeekdayIndex();
        return order.slice(at).concat(order.slice(0, at));
    }

    global.LivologClock = {
        TZ_SYSTEM: TZ_SYSTEM,
        WEEK_START_SUNDAY: WEEK_START_SUNDAY,
        WEEK_START_MONDAY: WEEK_START_MONDAY,
        zones: zones,
        getTimezone: getTimezone,
        setTimezone: setTimezone,
        offsetMinutes: offsetMinutes,
        getWeekStart: getWeekStart,
        setWeekStart: setWeekStart,
        wall: wall,
        stamp: stamp,
        parts: parts,
        pad: pad,
        startOfDay: startOfDay,
        formatDate: formatDate,
        formatClock: formatClock,
        weekStartOf: weekStartOf,
        weekKey: weekKey,
        firstWeekdayIndex: firstWeekdayIndex,
        weekDaysOf: weekDaysOf,
        onChange: function (listener) {
            listeners.push(listener);
        }
    };
})(window);
