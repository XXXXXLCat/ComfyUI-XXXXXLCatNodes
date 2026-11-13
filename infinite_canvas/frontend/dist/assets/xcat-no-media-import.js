/* ==================================================================
   xcat-no-media-import.js — 生成节点（以及素材文本节点）不接受媒体文件
   ------------------------------------------------------------------
   用户要求：生成节点不允许导入图片 / 视频 / 音频，不能拖进节点里。
   查过上游源码，能把媒体塞进已有节点的路径只有这几条：

     App.vue onDrop (files)                    → appendMedia(nodeId, files)
     App.vue onDrop (FILE_ASSET_DRAG_TYPE)     → appendItems(targetId, ...)
     Node/index.vue 空节点「点击上传」         → file input → appendMedia
     App.vue onDrop (ASSET_DRAG_TYPE)          → 落到节点上本来就 return

   所以这里在 document 捕获阶段拦 dragover / drop：命中生成节点就
   preventDefault + stopPropagation，让上游的 onDrop 根本收不到。
   click / change 两道是兜底，防以后又冒出新的上传入口。

   放行：工作流运行产物走 appendItems（useGraph.js:1677），完全不经过
   这些 DOM 事件；连线输入写的是 inputMedia，也不受影响。
   面板素材条 .media-strip 内部的排序拖放（ASSET_DRAG_TYPE、无文件）
   也放行，否则已有素材顺序会拖不动。

   视觉反馈：拖到被拒节点上时显示禁止光标（dropEffect='none'），
   节点描红并给一行说明；离开 / 结束拖拽时清掉。
   ================================================================== */
;(function () {
  'use strict'
  if (window.__xcatNoMediaImport) return

  var ASSET = 'application/x-infinite-canvas-asset'
  var FILE_ASSET = 'application/x-infinite-canvas-file-asset'
  var DENY_CLASS = 'xcat-drop-denied'
  var DENY_MS = 1500

  function flowNodes () {
    var f = window.__xcatFlow
    return (f && f.getNodes && f.getNodes.value) || []
  }

  function roleOf (wrap) {
    if (!wrap) return ''
    var id = wrap.getAttribute('data-id')
    var n = flowNodes().find(function (x) { return String(x.id) === String(id) })
    if (!n) return ''
    return window.__xcatRole ? window.__xcatRole(n.data) : (n.data && n.data.role) || ''
  }

  /* 生成类四种 + 素材文本（文本节点本来就不收媒体，顺手统一到这里）+ LoRA 栈
     （它只有一份 lora 列表，没有任何媒体语义） */
  function denied (role) {
    return role.indexOf('gen-') === 0 || role === 'asset-text' || role === 'lora'
  }

  function wrapOf (t) {
    return t && t.closest ? t.closest('.vue-flow__node') : null
  }

  function typesOf (ev) {
    var dt = ev.dataTransfer
    if (!dt || !dt.types) return []
    return Array.prototype.slice.call(dt.types)
  }

  function hasFiles (ev, types) {
    var dt = ev.dataTransfer
    return !!((dt && dt.files && dt.files.length) || types.indexOf('Files') >= 0)
  }

  function mark (wrap, role) {
    var demo = wrap.querySelector('.demo-node')
    if (!demo) return
    demo.setAttribute(
      'data-xcat-deny-text',
      role === 'lora'
        ? 'LoRA 节点不接受素材'
        : role.indexOf('gen-') === 0
          ? '生成节点不接受素材，请在下方运行工作流'
          : '文本节点不接受图片 / 视频 / 音频'
    )
    demo.classList.add(DENY_CLASS)
  }

  function unmark (demo) {
    if (!demo) return
    demo.classList.remove(DENY_CLASS)
    demo.removeAttribute('data-xcat-deny-text')
  }

  function unmarkAll () {
    var list = document.querySelectorAll('#app .demo-node.' + DENY_CLASS)
    for (var i = 0; i < list.length; i++) unmark(list[i])
  }

  /* 生成节点上没有上传按钮了（bundle 模板改成说明文字），这两条是兜底 */
  document.addEventListener('click', function (ev) {
    var b = ev.target && ev.target.closest ? ev.target.closest('.node-upload') : null
    if (!b) return
    var wrap = wrapOf(b)
    var role = roleOf(wrap)
    if (!denied(role)) return
    ev.preventDefault()
    ev.stopPropagation()
  }, true)

  document.addEventListener('change', function (ev) {
    var inp = ev.target
    if (!inp || !inp.classList || !inp.classList.contains('node-file-input')) return
    var wrap = wrapOf(inp)
    if (!denied(roleOf(wrap))) return
    try { inp.value = '' } catch (e) {}
    ev.preventDefault()
    ev.stopPropagation()
  }, true)

  /* 拖拽经过被拒节点：吃掉 dragover，让上游 onDragOver 不高亮画布，
     并把 dropEffect 设成 none —— 浏览器直接显示禁止光标。 */
  document.addEventListener('dragover', function (ev) {
    var wrap = wrapOf(ev.target)
    var role = roleOf(wrap)
    if (!denied(role)) return
    /* 面板素材条里拖动已有素材只是在排序，不新增，放行 */
    if (ev.target.closest && ev.target.closest('.media-strip')) {
      var types = typesOf(ev)
      if (types.indexOf(ASSET) >= 0 && !hasFiles(ev, types) && types.indexOf(FILE_ASSET) < 0) return
    }
    ev.preventDefault()
    ev.stopPropagation()
    try {
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'none'
    } catch (e) {}
    unmarkAll()
    mark(wrap, role)
    /* 上游 dragging ref 可能在拖进节点之前就被设成 true，手动收一下高亮 */
    var fw = document.querySelector('.flow-wrap')
    if (fw) fw.classList.remove('is-drop-file')
  }, true)

  /* 有些浏览器 dropEffect=none 仍会派发 drop：照样吞掉，别让文件落到节点里 */
  document.addEventListener('drop', function (ev) {
    var wrap = wrapOf(ev.target)
    var role = roleOf(wrap)
    if (!denied(role)) return
    if (ev.target.closest && ev.target.closest('.media-strip')) {
      var types = typesOf(ev)
      if (types.indexOf(ASSET) >= 0 && !hasFiles(ev, types) && types.indexOf(FILE_ASSET) < 0) return
    }
    ev.preventDefault()
    ev.stopPropagation()
    unmarkAll()
    mark(wrap, role)
    var demo = wrap.querySelector('.demo-node')
    clearTimeout(demo && demo.__xcatDenyTimer)
    if (demo) {
      demo.__xcatDenyTimer = setTimeout(function () { unmark(demo) }, DENY_MS)
    }
  }, true)

  function clearOnLeave (ev) {
    var t = ev.target
    var wrap = wrapOf(t)
    if (!wrap) return
    if (ev.relatedTarget && wrap.contains(ev.relatedTarget)) return
    unmark(wrap.querySelector('.demo-node'))
  }

  document.addEventListener('dragleave', clearOnLeave, true)
  document.addEventListener('dragend', function () { unmarkAll() }, true)

  window.__xcatNoMediaImport = { denied: denied, roleOf: roleOf }
})()
