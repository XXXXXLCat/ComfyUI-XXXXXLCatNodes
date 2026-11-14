/* ==========================================================================
 * 画布框选（Ctrl / Cmd + 左键拖）
 * --------------------------------------------------------------------------
 * 交互语义全部照 ComfyUI litegraph：
 *   ① 触发：LGraphCanvas._processPrimaryButton 里 `e.ctrlKey || e.metaKey`
 *      且 `!e.altKey` → _setupNodeSelectionDrag，**空白与节点上都起框**；
 *      不按 Ctrl 时左键拖空白照旧平移画布（leftMouseClickBehavior = 'panning'）。
 *   ② 命中：_getItemsInRect 用 overlapBounding —— 矩形与节点**相交**即选中。
 *   ③ 实时：Comfy.Graph.LiveSelection 默认 true —— 拖动过程中就选中/取消。
 *   ④ 修饰键：resolveMarqueeSelection —— Shift = add（并集）、
 *      Alt = subtract（差集）、无修饰 = replace（仅框内）。
 *   ⑤ 单击：resolveClickSelection —— 带 toggle 修饰时，未选中 → add、已选中 → remove。
 *
 * 为什么不直接用 Vue Flow 自带框选：它的 selectionMode 只有 full / partial，
 * 不看修饰键（不支持 Shift 加选、Alt 减选），且只在 pane 空白起拖才启动，
 * 想从节点上起拖只能先禁用节点拖动 —— 都绕不开，所以这一层自己接管。
 * Vue Flow 的 selectionKeyCode 由工具栏设成永不匹配的 'xcat-none' 关掉内部框选。
 * ========================================================================== */
(function () {
    'use strict';
    if (window.__xcatMarqueeInstalled) return;
    window.__xcatMarqueeInstalled = true;

    var BOX_ID = 'xcat-marquee-box';
    var state = null;

    function flow() { try { return window.__xcatFlow || null; } catch (e) { return null; } }
    function nodes() {
        var f = flow();
        try { return (f && f.getNodes.value) || []; } catch (e) { return []; }
    }
    function host() {
        return document.querySelector('#app .vue-flow') || document.querySelector('.vue-flow');
    }
    function isReadOnly() {
        return document.documentElement.classList.contains('xcat-canvas-hand');
    }
    /* 输入类元素里 Ctrl+拖是「选文字」，不能抢 */
    function inEditable(t) {
        return !!(t && t.closest && t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'));
    }
    /* 端口 / 按钮 / 拖拽手柄 / 标记了 nodrag 的元素不接管，保持各自原有交互 */
    function inWidget(t) {
        return !!(t && t.closest && t.closest('button, a, .vue-flow__handle, .nodrag, .xcat-nodrag, .card-delete, .media-dot, input[type="range"]'));
    }
    function ensureBox() {
        var h = host();
        if (!h) return null;
        var b = document.getElementById(BOX_ID);
        if (!b) {
            b = document.createElement('div');
            b.id = BOX_ID;
            b.className = 'vue-flow__selection xcat-marquee-box';
            b.style.display = 'none';
            h.appendChild(b);
        }
        return b;
    }
    function hideBox() {
        var b = document.getElementById(BOX_ID);
        if (b) b.style.display = 'none';
    }
    function nodeRect(id) {
        var el = document.querySelector('.vue-flow__node[data-id="' + (window.CSS && window.CSS.escape ? window.CSS.escape(id) : id) + '"]');
        return el ? el.getBoundingClientRect() : null;
    }
    function overlap(a, b) {
        return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
    }
    function selectedSet() {
        var s = new Set();
        nodes().forEach(function (n) { if (n.selected) s.add(n.id); });
        return s;
    }
    function setSelected(ids) {
        nodes().forEach(function (n) {
            var on = ids.has(n.id);
            if (!!n.selected !== on) n.selected = on;
        });
    }
    function nodeAt(x, y) {
        var el = document.elementFromPoint(x, y);
        var n = el && el.closest && el.closest('.vue-flow__node');
        return n ? n.getAttribute('data-id') : null;
    }

    /* 画矩形 + 按修饰键算目标集合 */
    function apply(e) {
        if (!state) return;
        var b = ensureBox();
        var h = host();
        if (!b || !h) return;
        var hr = h.getBoundingClientRect();
        var l = Math.min(state.x, state.cx), t = Math.min(state.y, state.cy);
        var w = Math.abs(state.cx - state.x), hh = Math.abs(state.cy - state.y);
        b.style.display = 'block';
        b.style.left = (l - hr.left) + 'px';
        b.style.top = (t - hr.top) + 'px';
        b.style.width = w + 'px';
        b.style.height = hh + 'px';

        var r = { left: l, top: t, right: l + w, bottom: t + hh };
        var hit = new Set();
        nodes().forEach(function (n) {
            var nr = nodeRect(n.id);
            if (nr && overlap(r, nr)) hit.add(n.id);
        });

        var target;
        if (e && e.altKey) {
            target = new Set(Array.from(state.base).filter(function (id) { return !hit.has(id); }));
        } else if ((e && e.shiftKey) || state.shift) {
            target = new Set(Array.from(state.base).concat(Array.from(hit)));
        } else {
            target = hit;
        }
        setSelected(target);
        state.hit = hit;
    }

    function detach() {
        document.removeEventListener('pointermove', onMove, true);
        document.removeEventListener('pointerup', onUp, true);
        document.removeEventListener('pointercancel', onCancel, true);
    }
    function onMove(e) {
        if (!state) return;
        state.cx = e.clientX;
        state.cy = e.clientY;
        if (!state.moved && Math.abs(state.cx - state.x) + Math.abs(state.cy - state.y) > 3) state.moved = true;
        if (state.moved) {
            e.preventDefault();
            apply(e);
        }
    }
    function onUp(e) {
        if (!state) return;
        var st = state;
        detach();
        if (st.moved) {
            apply(e);
            window.setTimeout(function () { if (st) hideBox(); }, 0);
        } else {
            /* Ctrl + 单击 = 切换选中（resolveClickSelection：add / remove）。
               以「按下那一刻」的状态为准（ComfyUI 的 isSelected 也是 press 时取的），
               并延后一帧写入 —— Vue Flow 自己还会在 pointerup 之后跑一次 click 处理，
               同步写会被它覆盖。 */
            var id = nodeAt(e.clientX, e.clientY) || st.pressNodeId;
            var was = st.pressWasSelected;
            if (id) {
                window.setTimeout(function () {
                    var n = nodes().filter(function (x) { return x.id === id; })[0];
                    if (n) n.selected = !was;
                }, 0);
            }
            hideBox();
        }
        state = null;
    }
    function onCancel() {
        detach();
        hideBox();
        state = null;
    }

    document.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        if (!(e.ctrlKey || e.metaKey)) return;   /* 无 Ctrl 走原生：左键拖空白 = 平移 */
        if (e.altKey) return;                    /* Alt+拖 仍是上游的剪线套索 */
        if (isReadOnly()) return;                /* H 只读：不框选 */
        if (inEditable(e.target) || inWidget(e.target)) return;
        var f = flow();
        if (!f) return;
        try {
            if (f.elementsSelectable && f.elementsSelectable.value === false) return;
        } catch (_) {}

        e.preventDefault();
        e.stopPropagation();
        var pid = nodeAt(e.clientX, e.clientY);
        var pn = pid ? nodes().filter(function (x) { return x.id === pid; })[0] : null;
        state = {
            x: e.clientX, y: e.clientY, cx: e.clientX, cy: e.clientY,
            base: selectedSet(), shift: !!e.shiftKey, moved: false, hit: null,
            pressNodeId: pid, pressWasSelected: !!(pn && pn.selected)
        };
        document.addEventListener('pointermove', onMove, true);
        document.addEventListener('pointerup', onUp, true);
        document.addEventListener('pointercancel', onCancel, true);
    }, true);

    /* Esc 取消正在进行的框选 */
    window.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && state) onCancel();
    }, true);
})();
