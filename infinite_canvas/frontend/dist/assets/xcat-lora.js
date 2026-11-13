/* 画布「LoRA 栈」节点（role = "lora"）—— 一份可增删的 {文件, 强度, 启用} 列表。
 *
 * 为什么是自管 DOM：画布节点是 Vue 编译产物，改组件等于重写 render 函数；
 * 这里往 .vue-flow__node[data-id] 里塞一层绝对定位的 .xcat-lora-body，
 * 完整盖住节点原有内容（空素材框 / 上传按钮 / 顶部按钮条都由 CSS 收起）。
 * 面板是节点容器的兄弟元素，节点拖动、缩放（transform 在父级）会自然跟随，
 * 不需要监听位置。
 *
 * 数据契约（与 bundle 内 xcatRole / 后端 _inject_loras 对齐）：
 *   data.role = "lora"
 *   data.loras = [{ name: "子目录/xxx.safetensors" | "", strength: 1.0, enabled: true }]
 * 运行生成节点时由 window.__xcatLorasFor(nodeId) 沿上游连线收集，
 * 后端把整条链插到该工作流 MODEL 源头（UNet / Checkpoint 加载器）之后。
 */
(function () {
  'use strict'
  if (window.__xcatLoraNode) return

  var FLOW = function () { return window.__xcatFlow || null }
  var BODY_CLASS = 'xcat-lora-body'
  var MENU_CLASS = 'xcat-lora-menu'
  var MAX_ROWS = 20
  /* 节点高度跟着行数长：默认卡片只有 270，四行就塞不下、会被底部「添加」按钮压住。
     只设下限（270），上限不锁 —— 加多少行就长多高，列表不滚动。 */
  var MIN_H = 270
  var STRENGTH_STEP = 0.01
  var STRENGTH_MIN = -100
  var STRENGTH_MAX = 100

  /* 每个节点上一次渲染时的数据签名：比对它就知道数据被谁改了（撤销/加载画布/粘贴） */
  var signatures = new Map()

  /* ---------------------------------------------------------------- 数据 */

  function nodeById (id) {
    var flow = FLOW()
    if (!flow || !flow.getNodes) return null
    return (flow.getNodes.value || []).find(function (n) { return n.id === id }) || null
  }

  function role (node) {
    try {
      return (window.__xcatRole ? window.__xcatRole(node.data) : '') || ''
    } catch (e) { return '' }
  }

  function loraList (node) {
    var d = node && node.data
    if (!d) return []
    if (!Array.isArray(d.loras)) d.loras = []
    return d.loras
  }

  /* 数据回写：直接改响应式对象，再走 updateNodeData 让画布记住（自动保存）。
     两者缺一不可 —— 只改对象不调 updateNodeData，撤销栈与磁盘都拿不到。 */
  function save (node) {
    var flow = FLOW()
    try {
      if (flow && flow.updateNodeData) flow.updateNodeData(node.id, { loras: JSON.parse(JSON.stringify(loraList(node))) })
    } catch (e) {}
    signatures.set(node.id, JSON.stringify(loraList(node)))
    render(node)
  }

  function addLora (node) {
    var list = loraList(node)
    if (list.length >= MAX_ROWS) return
    list.push({ name: '', strength: 1.0, enabled: true })
    save(node)
  }

  /* -------------------------------------------------------------- 强度数值 */

  /* 统一两位小数显示；内部仍按「百分之一」存，避免 0.1+0.2 那类浮点抖 */
  function fmtStrength (v) {
    var n = Number(v)
    if (!isFinite(n)) n = 1
    return (Math.round(n * 100) / 100).toFixed(2)
  }

  function clampStrength (v) {
    var n = Number(v)
    if (!isFinite(n)) return 1
    n = Math.round(n * 100) / 100
    return Math.max(STRENGTH_MIN, Math.min(STRENGTH_MAX, n))
  }

  /* 改强度后只更新数值、不整块重画：连续点 +/- 不会因为 DOM 被替换而断掉，
     输入框里的光标也不会跳。数据照样回写（撤销栈 / 自动保存都要）。
     注意按 index 重新取一次条目：updateNodeData 会把 data 换成新副本，
     闭包里抓的旧对象随后就成了孤儿，接着写就写丢。 */
  function commitStrength (node, index, value, numEl) {
    var v = clampStrength(value)
    if (numEl) numEl.value = fmtStrength(v)
    var list = loraList(node)
    var item = list[index]
    if (!item) return
    item.strength = v
    var flow = FLOW()
    try {
      if (flow && flow.updateNodeData) flow.updateNodeData(node.id, { loras: JSON.parse(JSON.stringify(list)) })
    } catch (e) {}
    signatures.set(node.id, JSON.stringify(loraList(node)))
  }

  /* ------------------------------------------------------------ LoRA 列表 */

  var ALL = null          /* null = 还没拉过；[] = 拉过但为空 */
  var loading = null

  function loadLoras () {
    if (ALL) return Promise.resolve(ALL)
    if (loading) return loading
    /* 直接问 ComfyUI 自己：LoraLoaderModelOnly 的 lora_name 就是 loras 目录的
       文件名列表（含子目录），和节点里手选的下拉完全同源，不另开后端接口。 */
    loading = fetch('/object_info/LoraLoaderModelOnly')
      .then(function (r) { return r.ok ? r.json() : null })
      .then(function (d) {
        var info = d && d.LoraLoaderModelOnly
        var opts = info && info.input && info.input.required && info.input.required.lora_name
        var list = (opts && opts[0]) || []
        ALL = Array.isArray(list) ? list.slice() : []
        return ALL
      })
      .catch(function () { ALL = []; return ALL })
      .then(function (v) { loading = null; return v })
    return loading
  }

  function baseName (name) {
    var i = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'))
    return i >= 0 ? name.slice(i + 1) : name
  }

  function dirName (name) {
    var i = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'))
    return i > 0 ? name.slice(0, i) : ''
  }

  /* ---------------------------------------------------------------- 菜单 */

  var menuEl = null
  var menuFor = null      /* 当前菜单正在编辑的 {node, index} */

  function closeMenu () {
    if (menuEl && menuEl.parentNode) menuEl.parentNode.removeChild(menuEl)
    menuEl = null
    menuFor = null
  }

  function pickLora (node, index, button) {
    if (menuFor && menuFor.node === node && menuFor.index === index) { closeMenu(); return }
    closeMenu()
    menuFor = { node: node, index: index }

    var box = document.createElement('div')
    box.className = MENU_CLASS
    box.setAttribute('role', 'listbox')

    var search = document.createElement('input')
    search.className = 'xcat-lora-search'
    search.type = 'text'
    search.placeholder = '搜索 LoRA 文件名'
    box.appendChild(search)

    var listEl = document.createElement('div')
    listEl.className = 'xcat-lora-options'
    box.appendChild(listEl)

    var current = (loraList(node)[index] || {}).name || ''

    function paint (keyword) {
      listEl.innerHTML = ''
      var kw = String(keyword || '').trim().toLowerCase()
      var items = (ALL || []).filter(function (n) {
        return !kw || n.toLowerCase().indexOf(kw) !== -1
      })
      if (!items.length) {
        var empty = document.createElement('div')
        empty.className = 'xcat-lora-empty'
        empty.textContent = ALL && ALL.length ? '没有匹配的 LoRA' : 'loras 目录里没有文件'
        listEl.appendChild(empty)
        return
      }
      /* 选中项排最前，其余保持 ComfyUI 的目录顺序；只渲染前 300 条，够用且不卡 */
      items.sort(function (a, b) {
        if (a === current) return -1
        if (b === current) return 1
        return 0
      })
      items.slice(0, 300).forEach(function (name) {
        var row = document.createElement('button')
        row.type = 'button'
        row.className = 'xcat-lora-option' + (name === current ? ' is-on' : '')
        var b = document.createElement('span')
        b.className = 'xcat-lora-option-name'
        b.textContent = baseName(name)
        row.appendChild(b)
        var d = dirName(name)
        if (d) {
          var s = document.createElement('span')
          s.className = 'xcat-lora-option-dir'
          s.textContent = d
          row.appendChild(s)
        }
        row.addEventListener('click', function (ev) {
          ev.stopPropagation()
          var item = loraList(node)[index]
          if (!item) return
          item.name = name
          if (!(Number(item.strength) > 0 || Number(item.strength) < 0)) item.strength = 1.0
          save(node)
          closeMenu()
        })
        listEl.appendChild(row)
      })
    }

    search.addEventListener('input', function () { paint(search.value) })
    paint('')

    ;(document.getElementById('app') || document.body).appendChild(box)

    /* 贴着按钮下方展开，越界往左/上翻 */
    var r = button.getBoundingClientRect()
    var w = box.offsetWidth
    var h = box.offsetHeight
    var left = r.left
    var top = r.bottom + 6
    if (left + w > window.innerWidth - 12) left = window.innerWidth - w - 12
    if (top + h > window.innerHeight - 12) top = Math.max(12, r.top - h - 6)
    box.style.left = Math.round(Math.max(12, left)) + 'px'
    box.style.top = Math.round(top) + 'px'
    menuEl = box
    search.focus()

    /* 列表还没回来时先画空态，回来再补 */
    if (!ALL) loadLoras().then(function () { if (menuEl === box) paint(search.value) })
  }

  /* ---------------------------------------------------------------- 渲染 */

  function makeButton (cls, text) {
    var b = document.createElement('button')
    b.type = 'button'
    b.className = cls
    if (text != null) b.textContent = text
    return b
  }

  /* 量出「完整展开」需要的高度，写进 .demo-node 的 CSS 变量，由样式表把节点高度撑起来
     （node 容器高度是内容撑的，因此同步跟着长）。只保底 270，不设上限。
     量法：绝对定位 + 定宽，把面板临时设成 height:auto，此时 offsetHeight 就是内容
     高度；量完立刻还原，不发生可见跳动。 */
  function fitHeight (el) {
    var host = el.parentElement
    var demo = host && host.querySelector('.demo-node')
    if (!demo) return
    el.style.height = 'auto'
    var natural = el.offsetHeight
    el.style.height = ''
    var h = Math.max(MIN_H, Math.round(natural) || MIN_H)
    if (demo.style.getPropertyValue('--xcat-lora-h') !== h + 'px') {
      demo.style.setProperty('--xcat-lora-h', h + 'px')
    }
  }

  /* 增删行的固定顺序：先渲染「已有行」，再补「添加」行 —— 行数变化时整体重画最简单，
     但输入中（焦点在面板里）不重画，否则会打断打字。 */
  function render (node) {
    var el = bodyOf(node.id)
    if (!el) return
    el.innerHTML = ''

    var head = document.createElement('div')
    head.className = 'xcat-lora-head'
    var title = document.createElement('span')
    title.className = 'xcat-lora-title'
    title.textContent = 'LoRA 栈'
    head.appendChild(title)
    var list = loraList(node)
    var count = document.createElement('span')
    count.className = 'xcat-lora-count'
    count.textContent = list.length ? String(list.length) : '未配置'
    head.appendChild(count)
    el.appendChild(head)

    var listEl = document.createElement('div')
    listEl.className = 'xcat-lora-list'
    el.appendChild(listEl)

    if (!list.length) {
      var empty = document.createElement('div')
      empty.className = 'xcat-lora-hint'
      empty.textContent = '点下面的「添加 LoRA」选模型；运行时按顺序接在该工作流的模型加载器后面。'
      listEl.appendChild(empty)
    }

    list.forEach(function (item, index) {
      var row = document.createElement('div')
      row.className = 'xcat-lora-row' + (item.enabled === false ? ' is-off' : '')

      var pick = makeButton('xcat-lora-pick nodrag nopan')
      var label = document.createElement('span')
      label.className = 'xcat-lora-name'
      label.textContent = item.name ? baseName(item.name) : '选择 LoRA 文件'
      if (!item.name) label.classList.add('is-empty')
      pick.appendChild(label)
      var arrow = document.createElement('span')
      arrow.className = 'xcat-lora-caret'
      arrow.textContent = '▾'
      pick.appendChild(arrow)
      if (item.name) pick.title = item.name
      pick.addEventListener('click', function (ev) {
        ev.stopPropagation()
        pickLora(node, index, pick)
      })
      row.appendChild(pick)

      /* 强度：−  1.00  +（每次 0.01，两位小数；数值本身也可直接输入） */
      var stepper = document.createElement('div')
      stepper.className = 'xcat-lora-stepper nodrag nopan'

      var minus = makeButton('xcat-lora-step', '−')
      minus.title = '强度 −0.01'
      stepper.appendChild(minus)

      var strength = document.createElement('input')
      strength.className = 'xcat-lora-num'
      strength.type = 'text'
      strength.inputMode = 'decimal'
      strength.autocomplete = 'off'
      strength.spellcheck = false
      strength.value = fmtStrength(item.strength != null ? item.strength : 1)
      strength.title = '模型强度（−100 ~ 100，两位小数；0 表示不加载）'

      minus.addEventListener('click', function (ev) {
        ev.stopPropagation()
        commitStrength(node, index, Number(strength.value || 0) - STRENGTH_STEP, strength)
      })

      strength.addEventListener('focus', function () { strength.select() })
      strength.addEventListener('change', function () {
        commitStrength(node, index, strength.value, strength)
      })
      strength.addEventListener('keydown', function (ev) {
        /* 文本框没有原生步进，自己补上下键；Enter 立即提交 */
        if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
          ev.preventDefault()
          var d = ev.key === 'ArrowUp' ? STRENGTH_STEP : -STRENGTH_STEP
          commitStrength(node, index, Number(strength.value || 0) + d, strength)
        } else if (ev.key === 'Enter') {
          commitStrength(node, index, strength.value, strength)
          strength.blur()
        }
      })
      strength.addEventListener('pointerdown', function (ev) { ev.stopPropagation() })
      stepper.appendChild(strength)

      var plus = makeButton('xcat-lora-step', '+')
      plus.title = '强度 +0.01'
      plus.addEventListener('click', function (ev) {
        ev.stopPropagation()
        commitStrength(node, index, Number(strength.value || 0) + STRENGTH_STEP, strength)
      })
      stepper.appendChild(plus)

      row.appendChild(stepper)

      var toggle = makeButton('xcat-lora-toggle nodrag nopan' + (item.enabled === false ? '' : ' is-on'))
      toggle.title = item.enabled === false ? '已停用（点击启用）' : '已启用（点击停用）'
      toggle.addEventListener('click', function (ev) {
        ev.stopPropagation()
        /* 同样按索引取最新条目：改强度后 data 已被换成新副本 */
        var cur = loraList(node)[index]
        if (!cur) return
        cur.enabled = cur.enabled === false
        save(node)
      })
      row.appendChild(toggle)

      var del = makeButton('xcat-lora-del nodrag nopan', '×')
      del.title = '移除这一条'
      del.addEventListener('click', function (ev) {
        ev.stopPropagation()
        loraList(node).splice(index, 1)
        save(node)
      })
      row.appendChild(del)

      listEl.appendChild(row)
    })

    var add = makeButton('xcat-lora-add nodrag nopan', '+ 添加 LoRA')
    add.disabled = list.length >= MAX_ROWS
    add.addEventListener('click', function (ev) {
      ev.stopPropagation()
      addLora(node)
    })
    el.appendChild(add)

    /* 一句用法提示：这个节点本身不跑工作流，全靠下游生成节点带着跑 */
    var foot = document.createElement('div')
    foot.className = 'xcat-lora-foot'
    foot.textContent = '连到生成节点即生效：运行时按顺序接在该工作流的模型加载器后面'
    el.appendChild(foot)

    fitHeight(el)
  }

  /* ------------------------------------------------------------ 挂载/同步 */

  function bodyOf (id) {
    return document.querySelector('.vue-flow__node[data-id="' + cssEscape(id) + '"] > .' + BODY_CLASS)
  }

  function cssEscape (v) {
    if (window.CSS && CSS.escape) return CSS.escape(String(v))
    return String(v).replace(/["\\]/g, '\\$&')
  }

  function ensurePanel (nodeEl, node) {
    if (!node || role(node) !== 'lora') return
    if (nodeEl.querySelector('.' + BODY_CLASS)) return
    var body = document.createElement('div')
    /* 只带 nopan：面板铺满整个节点，若也带 nodrag，Vue Flow 会把所有按下都当成
       「点在控件上」，节点就彻底拖不动了。nopan 只挡滚轮平移画布，
       里面的按钮/输入框各自标 nodrag，互不影响。 */
    body.className = BODY_CLASS + ' nopan'
    nodeEl.appendChild(body)
    render(node)
  }

  function sweep () {
    var flow = FLOW()
    if (!flow || !flow.getNodes) return
    var nodes = flow.getNodes.value || []
    /* 清掉已经不是 lora 的面板（撤销/改 role 的情况） */
    document.querySelectorAll('.' + BODY_CLASS).forEach(function (el) {
      var host = el.parentElement
      var id = host && host.dataset ? host.dataset.id : ''
      var n = id ? nodeById(id) : null
      if (!n || role(n) !== 'lora') el.remove()
    })
    nodes.forEach(function (n) {
      if (role(n) !== 'lora') return
      var el = document.querySelector('.vue-flow__node[data-id="' + cssEscape(n.id) + '"]')
      if (!el) return
      ensurePanel(el, n)
      /* 面板还在但节点被 Vue 重建成默认 270（.demo-node 换了新元素）：把高度补回去 */
      var body = el.querySelector('.' + BODY_CLASS)
      var demo = el.querySelector('.demo-node')
      if (body && demo && !demo.style.getPropertyValue('--xcat-lora-h')) fitHeight(body)
    })
  }

  /* 数据可能在别处被改（撤销、加载画布、复制粘贴）：比对签名后重画。
     面板里正在打字时不重画，避免打断输入。 */
  function syncData () {
    var flow = FLOW()
    if (!flow || !flow.getNodes) return
    ;(flow.getNodes.value || []).forEach(function (n) {
      if (role(n) !== 'lora') { signatures.delete(n.id); return }
      var el = bodyOf(n.id)
      if (!el) return
      var sig = JSON.stringify(loraList(n))
      var prev = signatures.get(n.id)
      if (sig === prev) return
      signatures.set(n.id, sig)
      if (el.contains(document.activeElement)) return
      render(n)
    })
  }

  /* --------------------------------------------------------- 运行时收集 */

  /* 生成节点运行时用：沿上游连线找 role==="lora" 的节点，按「离得远的先应用」
     顺序拼成一串（串联时上游的先加载）。带 visited 防环。 */
  function lorasFor (nodeId) {
    var flow = FLOW()
    if (!flow || !flow.getEdges || !flow.getNodes) return []
    var edges = flow.getEdges.value || []
    var out = []
    var seen = new Set()

    function walk (id, depth) {
      if (seen.has(id) || depth > 8) return
      seen.add(id)
      edges.forEach(function (e) {
        if (e.target !== id) return
        var up = nodeById(e.source)
        if (!up) return
        if (role(up) === 'lora') {
          /* 上游还有 lora 就再往上走一层，保证「越靠模型加载器越先应用」 */
          walk(up.id, depth + 1)
          loraList(up).forEach(function (item) {
            if (!item || !item.name) return
            if (item.enabled === false) return
            var s = Number(item.strength)
            if (!isFinite(s) || s === 0) return
            out.push({ name: item.name, strength: Math.max(-100, Math.min(100, s)), enabled: true })
          })
        }
      })
    }

    walk(nodeId, 0)
    return out
  }

  /* ---------------------------------------------------------------- 事件 */

  document.addEventListener('pointerdown', function (ev) {
    if (!menuEl) return
    var t = ev.target
    if (t && t.closest && (t.closest('.' + MENU_CLASS) || t.closest('.xcat-lora-pick'))) return
    closeMenu()
  }, true)

  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') closeMenu()
  })
  window.addEventListener('resize', closeMenu)

  var tries = 0
  var timer = setInterval(function () {
    sweep()
    if (++tries > 40) clearInterval(timer)
  }, 250)

  /* DOM 变化极频繁（Vue 每次选中、hover 都在改），合并成一次扫描，
     并且用 sweeping 拦住自己 render 造成的回流。 */
  var pendingSweep = 0
  function scheduleSweep () {
    if (pendingSweep) return
    pendingSweep = setTimeout(function () {
      pendingSweep = 0
      sweep()
    }, 60)
  }

  var obs = new MutationObserver(scheduleSweep)
  obs.observe(document.body, { childList: true, subtree: true })

  setInterval(syncData, 400)

  window.__xcatLoraNode = {
    render: render,
    sweep: sweep,
    close: closeMenu,
    load: loadLoras
  }
  window.__xcatLorasFor = lorasFor
})()
