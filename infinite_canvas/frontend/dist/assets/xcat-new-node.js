/* 新建节点入口（八选一）：① 左栏「新建节点」按钮下拉；② 画布空白处双击弹出。
 *
 * 为什么独立脚本：dist 是打包产物，直接改组件等于重写整块渲染函数；
 * 这里用 DOM 注入一个结构和左栏原生 lib-tab 完全一致的按钮，样式靠 data-v-1b766fe4 命中。
 *
 * 节点数据契约（与 bundle 内 xcatRole 对齐）：
 *   data.role = asset-image | asset-video | asset-audio | asset-text
 *             | gen-image   | gen-video   | gen-audio   | gen-text
 * 素材类 workflow 恒为空；生成类取第一个工作流。
 *
 * 双击画布：上游 zoomOnDoubleClick 会缩放，这里在捕获阶段拦掉，
 * 改成在鼠标位置弹出节点类型面板，选中的节点以双击点为中心落下。
 */
(function () {
  'use strict'
  if (window.__xcatNodeMenu) return

  var SVG_NS = 'http://www.w3.org/2000/svg'
  var V = 'data-v-1b766fe4'
  var NODE_W = 480
  var NODE_H = 270
  var EDGE_PAD = 12

  var GROUPS = [
    {
      title: '素材节点',
      hint: '只承载素材，不接工作流',
      items: [
        { role: 'asset-image', label: '素材图片', path: ['M3 3h18v18H3z', 'm21 15-5-5L5 21', 'M8.5 8.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0'] },
        { role: 'asset-video', label: '素材视频', path: ['M3 3h18v18H3z', 'M7 3v18', 'M17 3v18', 'M3 8h4', 'M3 16h4', 'M17 8h4', 'M17 16h4'] },
        { role: 'asset-audio', label: '素材音频', path: ['M9 18V5l12-2v13', 'M6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6', 'M18 13a3 3 0 1 0 0 6 3 3 0 0 0 0-6'] },
        { role: 'asset-text', label: '素材文本', path: ['M4 7V4h16v3', 'M9 20h6', 'M12 4v16'] }
      ]
    },
    {
      title: '生成节点',
      hint: '接工作流、可运行',
      items: [
        { role: 'gen-image', label: '生成图片', path: ['m12 3 1.9 5.8L20 10.7l-6.1 1.9L12 18.4l-1.9-5.8L4 10.7l6.1-1.9z', 'M5 3v4', 'M3 5h4'] },
        { role: 'gen-video', label: '生成视频', path: ['M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z', 'm6.2 5.3 3.1 3.9', 'm12.4 3.4 3.1 4', 'M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z'] },
        { role: 'gen-audio', label: '生成音频', path: ['M2 10v3', 'M6 6v11', 'M10 3v18', 'M14 8v7', 'M18 5v13', 'M22 10v3'] },
        { role: 'gen-text', label: '生成文本', path: ['M4 6h16', 'M4 11h11', 'M4 16h7', 'm18 13 .6 1.9 1.9.6-1.9.6-.6 1.9-.6-1.9-1.9-.6 1.9-.6z'] }
      ]
    }
  ]

  function svg (paths, size) {
    var el = document.createElementNS(SVG_NS, 'svg')
    el.setAttribute(V, '')
    el.setAttribute('viewBox', '0 0 24 24')
    el.setAttribute('width', String(size || 16))
    el.setAttribute('height', String(size || 16))
    el.setAttribute('fill', 'none')
    el.setAttribute('stroke', 'currentColor')
    el.setAttribute('stroke-width', '2')
    el.setAttribute('stroke-linecap', 'round')
    el.setAttribute('stroke-linejoin', 'round')
    el.setAttribute('aria-hidden', 'true')
    paths.forEach(function (d) {
      var p = document.createElementNS(SVG_NS, 'path')
      p.setAttribute(V, '')
      p.setAttribute('d', d)
      el.appendChild(p)
    })
    return el
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

  async function defaultWorkflow () {
    try {
      var r = await fetch('/infinite_canvas/api/workflows')
      var d = await r.json()
      var list = (d && d.workflows) || []
      return (list[0] && list[0].name) || ''
    } catch (e) {
      return ''
    }
  }

  /* at: flow 坐标（可选）。给了就以该点为中心落节点，否则用视口中心。 */
  async function createNode (role, at) {
    var flow = window.__xcatFlow
    if (!flow) return
    var id = nextId()
    var gen = role.indexOf('gen-') === 0
    var wf = gen ? await defaultWorkflow() : ''
    var pos = at || { x: window.innerWidth / 2, y: window.innerHeight / 2 }
    if (!at) {
      pos = flow.screenToFlowCoordinate
        ? flow.screenToFlowCoordinate({ x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 2) })
        : pos
    }
    flow.addNodes([{
      id: id,
      type: 'demo',
      position: {
        x: Math.round(pos.x - NODE_W / 2),
        y: Math.round(pos.y - NODE_H / 2)
      },
      data: {
        label: '节点 ' + id,
        workflow: wf,
        params: {},
        randomFields: {},
        inputMedia: [],
        media: [],
        index: 0,
        text: (role === 'asset-text' || role === 'gen-text') ? '' : undefined,
        role: role
      }
    }])
    // 选中新建出来的节点（Vue Flow 内部维护 selected 状态）
    setTimeout(function () {
      try {
        var n = flow.getNodes.value.find(function (x) { return x.id === id })
        if (n && flow.addSelectedNodes) flow.addSelectedNodes([n])
      } catch (e) {}
    }, 30)
  }

  /* ---------------- 菜单 ---------------- */

  var menuEl = null
  var lastClosed = 0 /* 刚因为点击空白关掉菜单的时间戳：紧接着的 dblclick 不再重开 */

  function closeMenu () {
    if (menuEl && menuEl.parentNode) menuEl.parentNode.removeChild(menuEl)
    menuEl = null
    var b = document.querySelector('.xcat-new-tab')
    if (b) b.classList.remove('is-open')
  }

  function closeByPointer () {
    if (!menuEl) return
    closeMenu()
    lastClosed = Date.now()
  }

  function clamp (v, min, max) {
    return Math.max(min, Math.min(v, max))
  }

  /* canvas: 双击画布模式的紧凑网格样式（同 xcat-overrides.css 的 .is-canvas） */
  function buildMenu (opt) {
    var canvas = !!opt.canvas
    var box = document.createElement('div')
    box.className = 'xcat-nodemenu' + (canvas ? ' is-canvas' : '')
    box.setAttribute('role', 'menu')

    if (canvas) {
      var head = document.createElement('div')
      head.className = 'xcat-nodemenu-cap'
      var t = document.createElement('span')
      t.className = 'xcat-nodemenu-caption'
      t.textContent = '新建节点'
      var k = document.createElement('span')
      k.className = 'xcat-nodemenu-key'
      k.textContent = 'Esc 关闭'
      head.appendChild(t)
      head.appendChild(k)
      box.appendChild(head)
    }

    GROUPS.forEach(function (g, gi) {
      if (gi) {
        var sep = document.createElement('div')
        sep.className = 'xcat-nodemenu-sep'
        box.appendChild(sep)
      }
      var gh = document.createElement('div')
      gh.className = 'xcat-nodemenu-head'
      var gt = document.createElement('span')
      gt.className = 'xcat-nodemenu-title'
      gt.textContent = g.title
      var gd = document.createElement('span')
      gd.className = 'xcat-nodemenu-hint'
      gd.textContent = g.hint
      gh.appendChild(gt)
      gh.appendChild(gd)
      box.appendChild(gh)

      var host = box
      if (canvas) {
        host = document.createElement('div')
        host.className = 'xcat-nodemenu-grid'
        box.appendChild(host)
      }

      g.items.forEach(function (it) {
        var b = document.createElement('button')
        b.type = 'button'
        b.className = 'xcat-nodemenu-item'
        b.setAttribute('role', 'menuitem')
        b.setAttribute('data-role', it.role)
        b.appendChild(svg(it.path, 16))
        var s = document.createElement('span')
        s.textContent = it.label
        b.appendChild(s)
        b.addEventListener('click', function (ev) {
          ev.stopPropagation()
          ev.preventDefault()
          var at = opt.point
          closeMenu()
          createNode(it.role, at)
        })
        host.appendChild(b)
      })
    })

    // 挂进 #app 才能拿到 --cg-* 令牌（变量定义在 #app 上）
    ;(document.getElementById('app') || document.body).appendChild(box)
    menuEl = box
    return box
  }

  function openMenu (btn) {
    if (menuEl) { closeMenu(); return }
    var box = buildMenu({})
    var r = btn.getBoundingClientRect()
    var h = box.offsetHeight
    box.style.left = Math.round(r.right + 8) + 'px'
    box.style.top = Math.round(Math.min(r.top, window.innerHeight - h - EDGE_PAD)) + 'px'
    btn.classList.add('is-open')
  }

  /* 双击画布：面板贴着鼠标出现，超出视口就往左上翻 */
  function openAt (x, y, point) {
    closeMenu()
    var box = buildMenu({ canvas: true, point: point })
    var w = box.offsetWidth
    var h = box.offsetHeight
    var left = x + 8
    var top = y + 8
    if (left + w > window.innerWidth - EDGE_PAD) left = x - w - 8
    if (top + h > window.innerHeight - EDGE_PAD) top = y - h - 8
    box.style.left = Math.round(clamp(left, EDGE_PAD, window.innerWidth - w - EDGE_PAD)) + 'px'
    box.style.top = Math.round(clamp(top, EDGE_PAD, window.innerHeight - h - EDGE_PAD)) + 'px'
  }

  function makeButton () {
    var btn = document.createElement('button')
    btn.setAttribute(V, '')
    btn.type = 'button'
    btn.className = 'lib-tab xcat-new-tab'
    btn.title = '新建节点（也可在画布空白处双击）'
    btn.appendChild(svg(['M12 5v14', 'M5 12h14'], 16))
    var label = document.createElement('span')
    label.setAttribute(V, '')
    label.className = 'xcat-tab-label'
    label.textContent = '新建节点'
    btn.appendChild(label)
    btn.addEventListener('click', function (ev) {
      ev.stopPropagation()
      openMenu(btn)
    })
    return btn
  }

  function mount () {
    var exit = document.querySelector('.library-tabs .xcat-exit-tab')
    if (!exit) return false
    if (document.querySelector('.xcat-new-tab')) return true
    exit.insertAdjacentElement('afterend', makeButton())
    return true
  }

  /* 点菜单外 / 左栏按钮外 → 立即收起（比 click 跟手；按钮自身放行以免 toggle 失效） */
  document.addEventListener(
    'pointerdown',
    function (ev) {
      if (!menuEl) return
      var t = ev.target
      if (!t || !t.closest) return
      if (t.closest('.xcat-nodemenu') || t.closest('.xcat-new-tab')) return
      closeByPointer()
    },
    true
  )

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' || e.key === 'Esc') closeMenu()
  })
  window.addEventListener('resize', closeMenu)
  document.addEventListener('wheel', closeMenu, { capture: true, passive: true })

  /* 画布空白双击 → 节点类型面板。
     上游 zoomOnDoubleClick 会在这里放大，捕获阶段先拦掉。
     注意：文本节点自己的双击编辑在 xcat-text-edit.js，先排除节点内部。 */
  document.addEventListener(
    'dblclick',
    function (ev) {
      var t = ev.target
      if (!t || !t.closest) return
      if (!t.closest('.vue-flow')) return
      if (t.closest('.vue-flow__node')) return
      if (t.closest('.vue-flow__panel, .vue-flow__minimap, .vue-flow__controls, .node-panel, .library-dock, .xcat-nodemenu')) return

      /* 刚点空白把菜单关掉的那一串双击：只当作「关闭」，别再开 */
      ev.preventDefault()
      ev.stopPropagation()
      if (Date.now() - lastClosed < 350) return
      if (menuEl) { closeMenu(); return }

      var flow = window.__xcatFlow
      var point = flow && flow.screenToFlowCoordinate
        ? flow.screenToFlowCoordinate({ x: ev.clientX, y: ev.clientY })
        : { x: ev.clientX, y: ev.clientY }
      openAt(ev.clientX, ev.clientY, point)
    },
    true
  )

  /* 文本节点不接收媒体文件：拖入直接吞掉，避免 media 里塞进看不见的数据。
     捕获阶段拦截，赶在 Vue Flow 的 drop 处理之前。 */
  document.addEventListener(
    'drop',
    function (ev) {
      var el = ev.target && ev.target.closest ? ev.target.closest('.vue-flow__node') : null
      if (!el) return
      var flow = window.__xcatFlow
      if (!flow || !flow.getNodes) return
      var id = el.getAttribute('data-id')
      var n = flow.getNodes.value.find(function (x) { return x.id === id })
      var role = n && window.__xcatRole ? window.__xcatRole(n.data) : ''
      if (role === 'asset-text') {
        ev.preventDefault()
        ev.stopPropagation()
      }
    },
    true
  )

  window.__xcatNodeMenu = { openAt: openAt, close: closeMenu, create: createNode }

  var tries = 0
  var timer = setInterval(function () {
    if (mount() || ++tries > 120) clearInterval(timer)
  }, 250)

  var obs = new MutationObserver(function () { mount() })
  obs.observe(document.body, { childList: true, subtree: true })
})()
