/* ==================================================================
   xcat-node-names.js — 节点顶部左侧的名称标签（不动压缩 bundle）
   ------------------------------------------------------------------
   上游 .demo-node 没有标题栏（CSS 里残留的 .node-head 规则在构建产物
   中并没有对应节点），内容铺满后完全看不出这个节点是什么。这里用
   DOM 注入给每个节点加一个左上角名称胶囊：
     · 有素材时显示当前素材名（media[index].name / ref.filename）
     · 没素材时显示节点 label；label 只是自增序号时补成「节点 N」
   名称来自 window.__xcatFlow.getNodes.value（Vue Flow store），与
   DOM 的 data-id 对应；切素材、改名、拖入新文件后会自动刷新。

   为什么用注入：.demo-node 的渲染函数在压缩 bundle 里，改它要动
   patch flag；Vue 不会清理 vnode 之外追加的 DOM，注入安全。标签
   pointer-events:none，不影响拖节点 / 连线 / 卡片切素材。
   ================================================================== */
(function () {
  'use strict';
  if (window.__xcatNodeNames) return;

  var CLS = 'xcat-node-name';

  function pickName(id) {
    var f = window.__xcatFlow;
    var list = f && f.getNodes && f.getNodes.value;
    var node = Array.isArray(list) && list.find(function (n) {
      return String(n.id) === String(id);
    });
    if (!node) {
      /* store 还没准备好时退回 DOM：上游卡片带 title=素材名 */
      var host = document.querySelector('.vue-flow__node[data-id="' +
        String(id).replace(/"/g, '\\"') + '"]');
      var card = host && host.querySelector('.media-stack-card.is-active[title]');
      return (card && card.getAttribute('title')) || '';
    }
    var d = node.data || {};
    var media = Array.isArray(d.media) ? d.media : [];
    var m = media[d.index || 0] || media[0];
    var file = m ? String(m.name || (m.ref && m.ref.filename) || '').trim() : '';
    if (file) return file;
    var label = String(d.label == null ? '' : d.label).trim();
    if (!label) return '节点 ' + id;
    if (/^\d+$/.test(label)) return '节点 ' + label;
    return label;
  }

  function install() {
    var hosts = document.querySelectorAll('#app .vue-flow__node .demo-node');
    for (var i = 0; i < hosts.length; i++) {
      var host = hosts[i];
      var wrap = host.closest('.vue-flow__node');
      if (!wrap) continue;
      var el = host.querySelector('.' + CLS);
      if (!el) {
        el = document.createElement('div');
        el.className = CLS;
        host.appendChild(el);
      }
      var name = pickName(wrap.dataset.id);
      if (el.textContent !== name) {
        el.textContent = name;
        el.setAttribute('title', name);
      }
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
      var m = list[i];
      /* 自己写 title 会造成回环，跳过 */
      if (m.target && m.target.classList && m.target.classList.contains(CLS)) continue;
      if (m.addedNodes.length || m.removedNodes.length || m.type === 'attributes') {
        schedule(); break;
      }
    }
  }).observe(document.documentElement, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['title']
  });

  /* 兜底：只改 data.label 而不产生 DOM 变化的重命名 */
  setInterval(schedule, 1000);
  install();
  window.__xcatNodeNames = { install: install };
})();
