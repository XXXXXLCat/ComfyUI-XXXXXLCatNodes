/* ==================================================================
   xcat-paste.js — 在画布里 Ctrl+V 粘贴 / 拖入外部内容，直接建节点
   ------------------------------------------------------------------
   上游的粘贴只认它自己内存里的 clipboard（复制节点/连线），系统剪贴
   板里的图片、视频、音频、文字完全没处理。这里补一条 paste 监听：

     · 剪贴板里有图片/视频/音频 → 每个文件建一个素材节点，
       上传复用上游 canvasGraph.appendMedia（占位、进度、失败重试都在）
     · 剪贴板里有 .txt / .md 等文本文件 → 读文件内容建「素材文本」节点
       （asset-text，与纯文本粘贴同一种节点），内容写进 data.text；
       UTF-8 / UTF-8 BOM / UTF-16 BOM / GBK 自动识别，中文 ANSI 文件不会乱码
     · 只有纯文本 → 建一个「素材文本」节点，内容写进 data.text
     · 在输入框里粘贴 → 完全不拦（文本节点内编辑、重命名输入框）
     · 画布内部复制的节点：上游在 keydown 里 preventDefault 过，
       浏览器根本不会派发 paste，不会与这里冲突

   拖入（drop）也接了同一套：只有落在画布空白处、且这批文件里含文本文件
   才接管，纯媒体文件仍完全交给上游 onDrop；落在节点上不接管（那里由
   xcat-no-media-import.js 负责拒收素材）。

   节点落点：鼠标最后在画布上的位置（drop 用事件坐标）；没有记录就用视口中心。
   多个文件横向排开，间距 480 + 48（flow 坐标）。
   ================================================================== */
(function () {
  'use strict'
  if (window.__xcatPaste) return

  var NODE_W = 480
  var NODE_H = 270
  var GAP = 48
  /* 文本文件扩展名；另外 mime 为 text/plain / text/markdown 也认 */
  var TEXT_EXT = /\.(txt|text|md|markdown|mdown|mkd|mdx)$/i
  var TEXT_MIME = /^(?:text\/(?:plain|markdown|md|x-markdown)|application\/(?:markdown|x-markdown))/i

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

  function isTextFile (file) {
    if (!file) return false
    if (TEXT_EXT.test(String(file.name || ''))) return true
    /* 有些系统给 .md 的 mime 是 application/octet-stream 甚至空，
       扩展名已覆盖；这里只兜住「没扩展名但声明了文本类型」的文件 */
    return TEXT_MIME.test(String(file.type || ''))
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
      return !!f && (f.size > 0 || f.type || f.name)
    })
  }

  /* 文本解码：UTF-8（含 BOM）→ UTF-16 BOM → GBK → UTF-8 宽松。
     fatal:true 能在遇到非法字节时抛错，比数 U+FFFD 更准。 */
  function decodeText (buf) {
    var u8 = new Uint8Array(buf)
    if (u8.length >= 3 && u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) {
      return new TextDecoder('utf-8').decode(u8.subarray(3))
    }
    if (u8.length >= 2 && u8[0] === 0xff && u8[1] === 0xfe) {
      try { return new TextDecoder('utf-16le').decode(u8.subarray(2)) } catch (e) {}
    }
    if (u8.length >= 2 && u8[0] === 0xfe && u8[1] === 0xff) {
      try { return new TextDecoder('utf-16be').decode(u8.subarray(2)) } catch (e) {}
    }
    try { return new TextDecoder('utf-8', { fatal: true }).decode(u8) } catch (e) {}
    try { return new TextDecoder('gbk').decode(u8) } catch (e) {}
    return new TextDecoder('utf-8').decode(u8)
  }

  function readText (file) {
    return new Promise(function (resolve, reject) {
      if (file.arrayBuffer) {
        file.arrayBuffer().then(function (b) { resolve(decodeText(b)) }, reject)
        return
      }
      var fr = new FileReader()
      fr.onload = function () { resolve(decodeText(fr.result)) }
      fr.onerror = function () { reject(fr.error) }
      fr.readAsArrayBuffer(file)
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

  function anchor (sx, sy) {
    var flow = window.__xcatFlow
    var zoom = 1
    if (flow && flow.viewport && flow.viewport.value) {
      zoom = Number(flow.viewport.value.zoom) || 1
    }
    var px = typeof sx === 'number' ? sx : (last.ok ? last.x : Math.round(window.innerWidth / 2))
    var py = typeof sy === 'number' ? sy : (last.ok ? last.y : Math.round(window.innerHeight / 2))
    var point =
      flow && flow.screenToFlowCoordinate
        ? flow.screenToFlowCoordinate({ x: px, y: py })
        : { x: px, y: py }
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

  /* txt/md 文件 → asset-text（和纯文本粘贴同一种节点，不挂工作流）。
     解码是异步的，所以整批文件串行处理（见 handleFiles），避免 nextId()
     在 await 之间撞出重复 id。 */
  async function createTextFile (file, index, base) {
    var text = ''
    try { text = await readText(file) } catch (e) { text = '' }
    var step = NODE_W + GAP
    var at = placeClear(base.point.x + index * step, base.point.y, step)
    var id = addNode({ role: 'asset-text', text: text }, at.x, at.y)
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

  async function handleFiles (files, base) {
    for (var i = 0; i < files.length; i++) {
      if (isTextFile(files[i])) await createTextFile(files[i], i, base)
      else createMedia(files[i], i, base)
    }
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
      handleFiles(files, anchor())
      return
    }

    createText(text, anchor())
  }

  /* ---------------- 拖入画布空白 ---------------- */

  function dropOnBlank (ev) {
    var t = ev.target
    if (!t || !t.closest) return false
    if (t.closest('.vue-flow__node')) return false /* 节点内不接管 */
    if (isTyping(t)) return false
    return !!t.closest('.vue-flow')
  }

  function hasTextFile (dt) {
    var files = dt ? collectFiles(dt) : []
    return files.length && files.some(isTextFile)
  }

  /* 上游 App.vue 已有全局 dragover 的 preventDefault，这里只为文本文件
     补一个明确的 copy 光标；纯媒体文件完全不碰。 */
  document.addEventListener('dragover', function (ev) {
    if (!dropOnBlank(ev) || !hasTextFile(ev.dataTransfer)) return
    ev.preventDefault()
    try {
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy'
    } catch (e) {}
  }, true)

  document.addEventListener('drop', function (ev) {
    if (ev.defaultPrevented) return
    if (!dropOnBlank(ev) || !hasTextFile(ev.dataTransfer)) return
    var files = collectFiles(ev.dataTransfer)
    if (!files.length) return
    ev.preventDefault()
    ev.stopPropagation()
    handleFiles(files, anchor(ev.clientX, ev.clientY))
  }, true)

  document.addEventListener('paste', onPaste, true)

  window.__xcatPaste = {
    kindOf: kindOf,
    anchor: anchor,
    isTextFile: isTextFile,
    readText: readText,
    decodeText: decodeText,
    handleFiles: handleFiles
  }
})()
