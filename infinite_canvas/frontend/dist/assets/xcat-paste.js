/* ==================================================================
   xcat-paste.js — 在画布里 Ctrl+V 粘贴外部内容，直接建素材节点
   ------------------------------------------------------------------
   上游的粘贴只认它自己内存里的 clipboard（复制节点/连线），系统剪贴
   板里的图片、视频、音频、文字完全没处理。这里补一条 paste 监听：

     · 剪贴板里有文件  → 每个文件建一个素材节点（图片/视频/音频），
       上传复用上游 canvasGraph.appendMedia（占位、进度、失败重试都在）
     · 只有纯文本        → 建一个「素材文本」节点，内容写进 data.text
     · 在输入框里粘贴    → 完全不拦（文本节点内编辑、重命名输入框）
     · 画布内部复制的节点：上游在 keydown 里 preventDefault 过，
       浏览器根本不会派发 paste，不会与这里冲突

   节点落点：鼠标最后在画布上的位置；没有记录就用视口中心。
   多个文件横向排开，间距 480 + 48（flow 坐标）。
   ================================================================== */
(function () {
  'use strict'
  if (window.__xcatPaste) return

  var NODE_W = 480
  var NODE_H = 270
  var GAP = 48

  var last = { x: 0, y: 0, ok: false }

  function remember (ev) {
    var el = ev.target
    if (!el || !el.closest) return
    /* 只认画布区域内的位置，左栏 / 弹窗上的鼠标不算 */
    if (!el.closest('.vue-flow')) return
    last.x = ev.clientX
    last.y = ev.clientY
    last.ok = true
  }
  document.addEventListener('pointermove', remember, true)
  document.addEventListener('pointerdown', remember, true)

  function isTyping (target) {
    if (!target || !target.closest) return false
    return !!target.closest(
      "input, textarea, select, [contenteditable='true'], [contenteditable='']"
    )
  }

  function kindOf (file) {
    var mime = String((file && file.type) || '').toLowerCase()
    if (mime.indexOf('image/') === 0) return 'image'
    if (mime.indexOf('video/') === 0) return 'video'
    if (mime.indexOf('audio/') === 0) return 'audio'

    var name = String((file && file.name) || '').toLowerCase()
    if (/\.(png|jpe?g|webp|gif|bmp|avif|tiff?)$/.test(name)) return 'image'
    if (/\.(mp4|webm|mov|mkv|avi|m4v|mpe?g)$/.test(name)) return 'video'
    if (/\.(mp3|wav|ogg|m4a|flac|aac|opus|weba)$/.test(name)) return 'audio'
    return 'image'
  }

  function collectFiles (dt) {
    var out = []
    var i
    if (dt.files && dt.files.length) {
      for (i = 0; i < dt.files.length; i++) out.push(dt.files[i])
    }
    /* 从网页复制的图片有时只出现在 items 里 */
    if (!out.length && dt.items && dt.items.length) {
      for (i = 0; i < dt.items.length; i++) {
        var it = dt.items[i]
        if (it && it.kind === 'file' && it.getAsFile) {
          var f = it.getAsFile()
          if (f) out.push(f)
        }
      }
    }
    return out.filter(function (f) {
      return !!f && (f.size > 0 || f.type)
    })
  }

  function nextId () {
    var flow = window.__xcatFlow
    var max = 0
    if (flow && flow.getNodes) {
      flow.getNodes.value.forEach(function (n) {
        var v = parseInt(n.id, 10)
        if (!isNaN(v) && v > max) max = v
      })
    }
    return String(max + 1)
  }

  function anchor () {
    var flow = window.__xcatFlow
    var zoom = 1
    if (flow && flow.viewport && flow.viewport.value) {
      zoom = Number(flow.viewport.value.zoom) || 1
    }
    var sx = last.ok ? last.x : Math.round(window.innerWidth / 2)
    var sy = last.ok ? last.y : Math.round(window.innerHeight / 2)
    var point =
      flow && flow.screenToFlowCoordinate
        ? flow.screenToFlowCoordinate({ x: sx, y: sy })
        : { x: sx, y: sy }
    return { point: point, zoom: zoom }
  }

  /* 落点被占用就往右挪一格，避免连续粘贴完全叠在一起 */
  function placeClear (cx, cy, stepX) {
    var flow = window.__xcatFlow
    var list = (flow && flow.getNodes && flow.getNodes.value) || []
    var step = stepX || NODE_W + GAP
    var x = cx
    for (var guard = 0; guard < 40; guard++) {
      var left = x - NODE_W / 2
      var top = cy - NODE_H / 2
      var hit = list.some(function (n) {
        var p = (n && n.position) || {}
        return Math.abs(p.x - left) < 80 && Math.abs(p.y - top) < 80
      })
      if (!hit) return { x: left, y: top }
      x += step
    }
    return { x: cx - NODE_W / 2, y: cy - NODE_H / 2 }
  }

  function addNode (data, left, top) {
    var flow = window.__xcatFlow
    if (!flow || !flow.addNodes) return null
    var id = nextId()
    flow.addNodes([
      {
        id: id,
        type: 'demo',
        position: {
          x: Math.round(left),
          y: Math.round(top)
        },
        data: Object.assign(
          {
            label: '节点 ' + id,
            workflow: '',
            params: {},
            randomFields: {},
            inputMedia: [],
            media: [],
            index: 0
          },
          data
        )
      }
    ])
    return id
  }

  function selectLater (id) {
    setTimeout(function () {
      try {
        var flow = window.__xcatFlow
        var node = flow.getNodes.value.find(function (x) {
          return x.id === id
        })
        if (node && flow.addSelectedNodes) flow.addSelectedNodes([node])
      } catch (e) {}
    }, 40)
  }

  function createText (text, base) {
    var at = placeClear(base.point.x, base.point.y)
    var id = addNode({ text: text, role: 'asset-text' }, at.x, at.y)
    if (id) selectLater(id)
    return id
  }

  function createMedia (file, index, base) {
    var kind = kindOf(file)
    var step = NODE_W + GAP
    var at = placeClear(base.point.x + index * step, base.point.y, step)
    var id = addNode({ role: 'asset-' + kind }, at.x, at.y)
    if (!id) return null
    /* 上传走上游链路：先本地占位，后台补传，失败可在卡片上重试。
       必须延迟一拍：Vue Flow 的 addNodes 是立刻进 getNodes，但 canvasGraph
       的 nodes 数组要等 watch 同步，立刻 appendMedia 会找不到节点并静默失败。 */
    setTimeout(function () {
      try {
        if (window.__xcatGraph && window.__xcatGraph.appendMedia) {
          window.__xcatGraph.appendMedia(id, [file])
        }
      } catch (e) {}
    }, 80)
    selectLater(id)
    return id
  }

  function onPaste (ev) {
    if (ev.defaultPrevented) return
    /* 节点里的文本框 / 重命名框：让它正常粘贴文字 */
    if (isTyping(ev.target)) return

    var dt = ev.clipboardData
    if (!dt) return

    var files = collectFiles(dt)
    var text = ''
    try {
      text = String(dt.getData('text/plain') || '')
    } catch (e) {
      text = ''
    }

    if (!files.length && !text.trim()) return

    ev.preventDefault()
    ev.stopPropagation()

    if (files.length) {
      var base = anchor()
      files.forEach(function (f, i) {
        createMedia(f, i, base)
      })
      return
    }

    var b = anchor()
    createText(text, b)
  }

  document.addEventListener('paste', onPaste, true)

  window.__xcatPaste = { kindOf: kindOf, anchor: anchor }
})()
