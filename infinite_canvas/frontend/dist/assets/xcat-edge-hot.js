/* ==================================================================
   xcat-edge-hot —— 选中节点时，把它连着的线也点亮
   ------------------------------------------------------------------
   ComfyUI 语义（LGraphCanvas.selectionView.highlightedLinks）：
     highlighted_links = 选中节点的所有 linkId（nodeLinkIds(graph, node)）
     渲染时 colors.highlighted = '#FFF'，**线宽不变**
   ⇒ 选中一个节点，与它相连的线一起变白。

   Vue Flow 没有「节点选中 ⇒ 边选中」的联动，也拿不到 CSS 选择器关系
   （边与节点是两棵兄弟子树），所以这里补一层 DOM 桥接：
     1) 读 .vue-flow__node.selected 得到选中节点 id
     2) 从 window.__xcatFlow.getEdges 拿 edge → {source,target}
     3) 给对应的 .vue-flow__edge[data-id] 加 .xcat-edge-hot（样式在
        xcat-overrides.css 里）
   只用来看（纯 class 切换），不碰画布数据，不写盘。
   ================================================================== */
;(function () {
    'use strict'

    var HOT = 'xcat-edge-hot'
    var flow = null
    var scheduled = false
    var nodesObs = null
    var edgesObs = null

    function selectedNodeIds() {
        var out = {}
        var list = document.querySelectorAll('.vue-flow__node.selected')
        for (var i = 0; i < list.length; i++) {
            var id = list[i].getAttribute('data-id')
            if (id != null) out[String(id)] = 1
        }
        return out
    }

    function sync() {
        var edges = document.querySelectorAll('.vue-flow__edge[data-id]')
        if (!edges.length) return

        var sel = selectedNodeIds()
        var anySel = false
        for (var k in sel) { anySel = true; break }

        var store = flow && flow.getEdges ? flow.getEdges.value : []
        var byId = {}
        for (var i = 0; i < store.length; i++) {
            byId[String(store[i].id)] = store[i]
        }

        for (var j = 0; j < edges.length; j++) {
            var el = edges[j]
            var e = byId[String(el.getAttribute('data-id'))]
            var on = false
            if (anySel && e) {
                on = !!sel[String(e.source)] || !!sel[String(e.target)]
            }
            if (el.classList.contains(HOT) !== on) el.classList.toggle(HOT, on)
        }
    }

    function schedule() {
        if (scheduled) return
        scheduled = true
        requestAnimationFrame(function () {
            scheduled = false
            sync()
        })
    }

    function observe() {
        var nodes = document.querySelector('.vue-flow__nodes')
        var edges = document.querySelector('.vue-flow__edges')
        if (!nodes || !edges) return false
        if (!nodesObs) {
            nodesObs = new MutationObserver(schedule)
            nodesObs.observe(nodes, {
                subtree: true,
                childList: true,
                attributes: true,
                attributeFilter: ['class']
            })
        }
        if (!edgesObs) {
            edgesObs = new MutationObserver(schedule)
            edgesObs.observe(edges, {
                subtree: true,
                childList: true,
                attributes: true,
                attributeFilter: ['class']
            })
        }
        return true
    }

    var bootTimer = setInterval(function () {
        flow = window.__xcatFlow || null
        if (flow && observe()) {
            clearInterval(bootTimer)
            schedule()
        }
    }, 400)
    setTimeout(function () { clearInterval(bootTimer) }, 30000)

    document.addEventListener('pointerup', schedule, true)
    document.addEventListener('keydown', schedule, true)
    document.addEventListener('keyup', schedule, true)
})()
