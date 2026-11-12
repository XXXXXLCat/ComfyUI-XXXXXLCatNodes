/* 素材文本节点：双击进入编辑，其余状态与普通节点一致（可拖动、可选中）。
 *
 * 实现方式：textarea 平时 pointer-events:none（见 xcat-overrides.css），
 * 鼠标事件穿透到 .demo-node，于是 hover 是 grab、按住能拖、单击能选中。
 * 在节点上双击时给 .demo-node 加 .xcat-text-editing，textarea 才接管鼠标。
 * 点击节点外部 / Esc / 焦点移出 → 退出编辑并 blur，键盘事件交还画布。
 */
;(function () {
  'use strict'

  var editing = null /* 正在编辑的 .demo-node */

  function nodeOf (el) {
    return el && el.closest ? el.closest('.demo-node') : null
  }

  function areaOf (node) {
    return node ? node.querySelector('.xcat-text-area') : null
  }

  function enter (node) {
    if (editing && editing !== node) exit()
    var ta = areaOf(node)
    if (!ta) return
    node.classList.add('xcat-text-editing')
    editing = node
    try {
      ta.focus({ preventScroll: true })
      var n = (ta.value || '').length
      ta.setSelectionRange(n, n)
    } catch (e) {}
  }

  function exit () {
    if (!editing) return
    var node = editing
    editing = null
    node.classList.remove('xcat-text-editing')
    var ta = areaOf(node)
    /* 不 blur 的话 Delete / 方向键会被 textarea 吃掉，节点删不掉 */
    if (ta && document.activeElement === ta) {
      try { ta.blur() } catch (e) {}
    }
  }

  /* 双击节点任意位置进入编辑；已经在编辑时放行，交给浏览器选词 */
  document.addEventListener(
    'dblclick',
    function (ev) {
      var node = nodeOf(ev.target)
      if (!node || !areaOf(node)) return
      if (node.classList.contains('xcat-text-editing')) return
      /* 顶部按钮行不参与（文本节点目前只有删除按钮，防误触） */
      if (ev.target.closest && ev.target.closest('.node-actions, button')) return
      /* 拦住冒泡，避免画布 double-click 缩放 */
      ev.preventDefault()
      ev.stopPropagation()
      enter(node)
    },
    true
  )

  /* 点空白处 / 点别的节点 → 退出 */
  document.addEventListener(
    'pointerdown',
    function (ev) {
      if (!editing) return
      if (editing.contains(ev.target)) return
      exit()
    },
    true
  )

  /* Esc 退出；顺带吃掉这次按键，避免触发画布快捷键 */
  document.addEventListener(
    'keydown',
    function (ev) {
      if (!editing) return
      if (ev.key === 'Escape' || ev.key === 'Esc') {
        ev.stopPropagation()
        exit()
      }
    },
    true
  )

  /* Tab / 程序性聚焦跑到别处时也退出 */
  document.addEventListener(
    'focusin',
    function (ev) {
      if (!editing) return
      if (editing.contains(ev.target)) return
      exit()
    },
    true
  )

  /* 节点被删除时清掉悬挂引用 */
  var observer = new MutationObserver(function () {
    if (editing && !document.contains(editing)) editing = null
  })
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true })
  }

  window.__xcatTextEdit = { enter: enter, exit: exit, get editing () { return editing } }
})()
