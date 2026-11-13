/* ==========================================================================
 * 多选包围框（Selection Border）
 * --------------------------------------------------------------------------
 * 照抄 ComfyUI 内置扩展 Comfy.SelectionBorder（core-*.js 里的 drawSelectionBorder），
 * 逐条对齐它的参数 —— 单位换算保持「屏幕常量」语义：
 *
 *   if (selectedItems.size <= 1) return;          // 只在多选（≥2）时出现
 *   const b = createBounds(items, 10);            // 外扩 10 个画布单位
 *   ctx.lineWidth = 2 / scale;                    // 屏幕恒 2px
 *   ctx.strokeStyle = getComputedStyle(:root).getPropertyValue('--border')  // #494a50
 *   const d = 5 / scale; ctx.setLineDash([d, d]);// 屏幕 5 实 5 空
 *   ctx.roundRect(x, y, w, h, 8 / scale);         // 屏幕恒 8px 圆角
 *
 * 画布是 DOM（Vue Flow），所以用一层 <svg> 覆盖在 .vue-flow 上做前景层，
 * 与 ComfyUI 把边框画在 canvas 前景（节点之上）同理；pointer-events: none。
 *
 * 刷新时机不用 rAF 轮询：节点选中态是 class、位置/视口是 style transform，
 * 全都落在 .vue-flow 子树里，MutationObserver 一有变动就重算（setTimeout 0 合并），
 * 覆盖「选中变化 / 拖节点 / 平移缩放 / 增删节点 / 窗口缩放」所有情况。
 * （rAF 在无头 / 后台标签页会被浏览器暂停，轮询式实现会直接不动。）
 * ========================================================================== */
(function () {
    'use strict';
    if (window.__xcatSelBorderInstalled) return;
    window.__xcatSelBorderInstalled = true;

    var LAYER_ID = 'xcat-selborder';
    var MULTI_CLASS = 'xcat-multi-select';   /* 多选态根类：CSS 据此收起节点浮层 UI */
    var PAD = 10;       /* createBounds(items, 10) 的外扩量，画布单位 */
    var LINE_W = 2;     /* 屏幕 2px */
    var DASH = 5;       /* 屏幕 5px，实空各 5 */
    var RADIUS = 8;     /* 屏幕 8px 圆角 */

    function flow() { try { return window.__xcatFlow || null; } catch (e) { return null; } }
    function host() {
        return document.querySelector('#app .vue-flow') || document.querySelector('.vue-flow');
    }
    function zoom() {
        var f = flow();
        try {
            var vp = f && f.getViewport ? f.getViewport() : null;
            var z = vp && vp.zoom;
            return typeof z === 'number' && z > 0 ? z : 1;
        } catch (e) { return 1; }
    }
    function selectedNodes() {
        var f = flow();
        try {
            var s = f && f.getSelectedNodes ? f.getSelectedNodes.value : null;
            if (s && s.length) return s;
        } catch (e) {}
        var all = [];
        try { all = (f && f.getNodes.value) || []; } catch (e) { all = []; }
        return all.filter(function (n) { return !!n.selected; });
    }
    function cssEscape(s) {
        return window.CSS && window.CSS.escape ? window.CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&');
    }
    function nodeEl(id) {
        return document.querySelector('.vue-flow__node[data-id="' + cssEscape(id) + '"]');
    }

    var layerEl = null, rectEl = null;
    function ensureLayer() {
        var h = host();
        if (!h) return null;
        if (layerEl && h.contains(layerEl)) return layerEl;
        layerEl = document.getElementById(LAYER_ID);
        if (!layerEl) {
            layerEl = document.createElement('div');
            layerEl.id = LAYER_ID;
            var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            rectEl = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rectEl.setAttribute('fill', 'none');
            rectEl.setAttribute('stroke-width', String(LINE_W));
            rectEl.setAttribute('stroke-dasharray', DASH + ' ' + DASH);
            rectEl.setAttribute('rx', String(RADIUS));
            rectEl.setAttribute('ry', String(RADIUS));
            svg.appendChild(rectEl);
            layerEl.appendChild(svg);
            h.appendChild(layerEl);
        } else {
            rectEl = layerEl.querySelector('rect');
        }
        return layerEl;
    }
    function hide() {
        if (layerEl && layerEl.style.display !== 'none') layerEl.style.display = 'none';
    }

    var last = '';
    function draw(sel) {
        var h = host();
        if (!h) return hide();
        var minL = Infinity, minT = Infinity, maxR = -Infinity, maxB = -Infinity;
        for (var i = 0; i < sel.length; i++) {
            var el = nodeEl(sel[i].id);
            if (!el) continue;
            var r = el.getBoundingClientRect();
            if (!r.width && !r.height) continue;
            if (r.left < minL) minL = r.left;
            if (r.top < minT) minT = r.top;
            if (r.right > maxR) maxR = r.right;
            if (r.bottom > maxB) maxB = r.bottom;
        }
        if (!isFinite(minL) || !isFinite(minT)) return hide();

        var layer = ensureLayer();
        if (!layer || !rectEl) return;
        var hr = h.getBoundingClientRect();
        var pad = PAD * zoom();
        var x = minL - hr.left - pad;
        var y = minT - hr.top - pad;
        var w = (maxR - minL) + pad * 2;
        var hh = (maxB - minT) + pad * 2;

        var key = x.toFixed(1) + ',' + y.toFixed(1) + ',' + w.toFixed(1) + ',' + hh.toFixed(1);
        if (key !== last) {
            last = key;
            rectEl.setAttribute('x', x.toFixed(1));
            rectEl.setAttribute('y', y.toFixed(1));
            rectEl.setAttribute('width', w.toFixed(1));
            rectEl.setAttribute('height', hh.toFixed(1));
        }
        if (layer.style.display !== 'block') layer.style.display = 'block';
    }

    /* 多选时给 #app 挂一个根类，CSS 据此把节点上的浮层 UI 全部收起 ——
       只留主体（媒体 / 空态）。见 xcat-overrides.css「多选只留主体」节。 */
    function syncMultiClass(on) {
        var root = document.getElementById('app') || document.documentElement;
        var has = root.classList.contains(MULTI_CLASS);
        if (on && !has) root.classList.add(MULTI_CLASS);
        else if (!on && has) root.classList.remove(MULTI_CLASS);
    }

    function update() {
        var sel = selectedNodes();
        var multi = sel.length > 1;
        syncMultiClass(multi);
        if (multi) draw(sel); else hide();
    }

    var pending = false;
    function schedule() {
        if (pending) return;
        pending = true;
        window.setTimeout(function () { pending = false; update(); }, 0);
    }

    function observe() {
        var h = host();
        if (!h) { window.setTimeout(observe, 300); return; }
        var mo = new MutationObserver(function (records) {
            for (var i = 0; i < records.length; i++) {
                var t = records[i].target;
                /* 自己写 style 也会触发，跳过，避免自我循环 */
                if (t && t.nodeType === 1 && t.closest && t.closest('#' + LAYER_ID)) continue;
                schedule();
                return;
            }
        });
        mo.observe(h, {
            attributes: true,
            attributeFilter: ['class', 'style'],
            subtree: true,
            childList: true
        });
        window.addEventListener('resize', schedule);
        schedule();
    }
    observe();
})();
