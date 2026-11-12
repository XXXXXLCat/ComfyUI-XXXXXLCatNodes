/* ==================================================================
   xcat-node-actionbar.js — 把「删除节点」并进上方操作按钮行的末尾
   ------------------------------------------------------------------
   上游把 .node-delete 渲染成 .demo-node 的独立子元素，绝对定位在右上角
   （top/right:-17px、38×38、hover 才出现）。用户要求它作为操作按钮行的
   最后一项，和另外 6 枚 .fan-btn 同款、同一行。

   做法：不动 Vue 的 vnode —— .node-delete 是 v-if(hover) 产物，每次 hover
   离开再进入都会被重新创建，直接把它 appendChild 到 .node-actions 里会被
   Vue 的下一次 patch 挪回原位。这里改成：
     · CSS 隐藏原来的 .node-delete（但保留它在 DOM 里，事件 handler 还在）
     · 往 .node-actions 末尾注入一枚同款 .fan-btn，点击时调用原按钮的
       .click()，删除逻辑完全走上游（清理进度 / 连线 / 素材引用）
     · 原按钮若因 hover 状态不存在，退回 __xcatFlow.removeNodes([id])

   注入元素补上 Actions 组件的 scoped id data-v-abbe9e2b，才能命中上游
   .fan-btn / .node-actions.is-open .fan-btn 的样式；尺寸由
   xcat-overrides.css 的一行规则统一成 32×32 / svg 16×16。
   ================================================================== */
(function () {
  'use strict';
  if (window.__xcatNodeActionBar) return;

  var SCOPE = 'data-v-abbe9e2b';
  var CLS = 'xcat-act-delete';
  var ICON =
    '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' +
    '<path d="M4 7h16M9 7V5h6v2M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12' +
    'M10 11v6M14 11v6" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    'stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function remove(btn) {
    var host = btn.closest('.demo-node');
    var orig = host && host.querySelector(':scope > .node-delete');
    if (orig) { orig.click(); return; }
    /* 兜底：hover 状态异常导致原按钮不存在时直接删节点 */
    var wrap = btn.closest('.vue-flow__node');
    var id = wrap && wrap.dataset.id;
    var f = window.__xcatFlow;
    if (id && f && typeof f.removeNodes === 'function') f.removeNodes([id]);
  }

  function install() {
    var bars = document.querySelectorAll('#app .demo-node .node-actions');
    for (var i = 0; i < bars.length; i++) {
      var bar = bars[i];
      if (bar.querySelector('.' + CLS)) continue;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'fan-btn ' + CLS + ' nodrag';
      btn.title = '删除节点';
      btn.setAttribute('aria-label', '删除节点');
      btn.setAttribute(SCOPE, '');
      btn.innerHTML = ICON;
      ['pointerdown', 'mousedown', 'dblclick'].forEach(function (t) {
        btn.addEventListener(t, function (e) { e.stopPropagation(); });
      });
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        remove(e.currentTarget);
      });
      bar.appendChild(btn);          /* 永远排最后 */
    }
  }

  var queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () { queued = false; install(); });
  }

  new MutationObserver(function (list) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].addedNodes.length || list[i].removedNodes.length ||
          list[i].type === 'attributes') { schedule(); break; }
    }
  }).observe(document.documentElement, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['class']
  });

  setInterval(schedule, 1000);
  install();
  window.__xcatNodeActionBar = { install: install };
})();
