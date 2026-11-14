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
   .fan-btn / .node-actions.is-open .fan-btn 的样式。

   2026-11-13：视觉顺序改由 xcat-overrides.css 的 flex order 保证
   （下载 / 全部下载 = 90 / 91，删除 = 99，永远在行尾；截取 / 变速 = -2 / -1）。
   这里仍 appendChild，只是把节点放进容器，不再依赖 DOM 顺序。

   2026-11-13：节点上方操作行整体改成文字按钮（用户要求），所以这里不再
   注入 svg，直接放文字「删除」；data-xcat-text 告诉覆盖层 CSS 这是自带
   文字的按钮，不要再补 ::after（上游 6 枚图标按钮靠 ::after attr(title)
   显示文字）。尺寸统一由 xcat-overrides.css 控制。
   ================================================================== */
(function () {
  'use strict';
  if (window.__xcatNodeActionBar) return;

  var SCOPE = 'data-v-abbe9e2b';
  var CLS = 'xcat-act-delete';

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
      /* is-enabled 是上游给「可用按钮」的标记，补上才能和另外 6 枚同款描边 */
      btn.className = 'fan-btn is-enabled ' + CLS + ' nodrag';
      btn.title = '删除';
      btn.setAttribute('aria-label', '删除节点');
      btn.setAttribute('data-xcat-text', '');
      btn.setAttribute(SCOPE, '');
      btn.textContent = '删除';
      ['pointerdown', 'mousedown', 'dblclick'].forEach(function (t) {
        btn.addEventListener(t, function (e) { e.stopPropagation(); });
      });
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        remove(e.currentTarget);
      });
      bar.appendChild(btn);          /* 视觉顺序由 CSS order 固定为末尾 */
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
