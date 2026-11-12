/* ==================================================================
   xcat-edge-mid —— 连线中点圆点，点击断开这条线
   ------------------------------------------------------------------
   ComfyUI 真源（renderer/core/canvas/pathRenderer.ts）：
     calculateCenterPoint()
        spline 模式 ⇒ findPointOnBezier(0.5, p0, c1, c2, p3)
        即**曲线参数 t=0.5** 处的点，不是包围盒中点
     drawCenterMarker()
        ctx.arc(centerPos.x, centerPos.y, 5, 0, 2π) + ctx.fill()
        半径 5（画布图内单位，随缩放变），填充色 = 该线颜色
        圆点没有描边、不画那圈 7px 黑 halo（半径 5 > 7/2，正好把线盖干净）
     绘制条件：showCenterMarker && scale >= 0.6 && highQuality
     linkMarkerShape 默认 LinkMarkerShape.Circle
   点击断开：画布上这是 link 的命中点，点它删掉该 link —— Vue Flow 侧对应
   store.removeEdges([id])（与 Delete 删边同一条 action，持久化链路一致）。

   实现：往每条边的 <g class="vue-flow__edge" data-id> 里塞两个 <circle> ——
   一个透明的大命中圆（r=10，最上层接鼠标）+ 一个实心圆点（r=5，负责显示）。
   cx/cy 用 path.getPointAtLength(len/2)（与参数中点等价，且对任何 path 都成立）。
   hover 命中圆 ⇒ 圆点加 .is-hot，CSS 把它镂空成圆环（外沿不变、中间挖黑孔），
   替掉上游那个悬停就冒出来的红色叉号删除按钮（.edge-tool，本包已隐藏）。
   circle 在 viewport 的 transform 里 ⇒ 自动跟随平移/缩放，半径天然「图内单位」。
   数据只读，唯一写操作是用户点击时的 removeEdges。
   ================================================================== */
;(function () {
    'use strict'

    var NS = 'http://www.w3.org/2000/svg'
    var CLASS = 'xcat-edge-mid'
    var HIT = 'xcat-edge-mid-hit'
    var R = 5            // ComfyUI drawCenterMarker: arc(..., 5, ...)
    var HIT_R = 10       // 透明命中区半径（图内单位），比圆点大一圈好点中
    var MIN_ZOOM = 0.6   // pathRenderer: context.scale >= 0.6 才画中点标记

    var flow = null
    var scheduled = false
    var obs = null

    function schedule() {
        if (scheduled) return
        scheduled = true
        requestAnimationFrame(function () {
            scheduled = false
            sync()
        })
    }

    function viewportZoom() {
        try {
            var vp = flow && flow.getViewport ? flow.getViewport() : null
            var z = vp && vp.zoom
            if (z > 0) return z
        } catch (e) {}
        return 1
    }

    // 一条边上的两件东西：实心圆点（在下，负责显示）+ 透明命中圆（在上，接鼠标）。
    // 命中圆必须叠在圆点**上面**：否则指针落在圆心那 10px 里命中的是圆点本身，
    // 命中圆收不到 pointerenter，hover 只在圆点边缘一圈生效（实测就是这样漏的）。
    function makeMarkers(g) {
        var dot = document.createElementNS(NS, 'circle')
        dot.setAttribute('class', CLASS)
        dot.setAttribute('r', R)

        var hit = document.createElementNS(NS, 'circle')
        hit.setAttribute('class', HIT)
        hit.setAttribute('r', HIT_R)

        hit.addEventListener('pointerenter', function () {
            dot.classList.add('is-hot')
            // 给边加个类：hover 圆环时线保持本色（否则 Vue Flow 的 :hover 会把线刷白，
            // 绿环 + 白线不搭，参考图是「线与环同色 + 黑孔」）
            g.classList.add('xcat-edge-marker-hot')
        })
        hit.addEventListener('pointerleave', function () {
            dot.classList.remove('is-hot')
            g.classList.remove('xcat-edge-marker-hot')
        })

        g.appendChild(dot)
        g.appendChild(hit)
        return { hit: hit, dot: dot }
    }

    function sync() {
        // 注意：Vue Flow 给**每条边**单独建一个 <svg class="vue-flow__edges">，
        // 所以不能先取 "那个" 容器再往里找，必须全局按 data-id 遍历。
        var groups = document.querySelectorAll('.vue-flow__edge[data-id]')
        if (!groups.length) return

        var show = viewportZoom() >= MIN_ZOOM

        for (var i = 0; i < groups.length; i++) {
            var g = groups[i]
            var dot = g.querySelector('circle.' + CLASS)
            var hit = g.querySelector('circle.' + HIT)

            if (!show) {
                if (dot) { dot.style.display = 'none'; dot.classList.remove('is-hot') }
                if (hit) hit.style.display = 'none'
                continue
            }

            var path = g.querySelector('.vue-flow__edge-path')
            if (!path) continue

            var len = 0
            try { len = path.getTotalLength() } catch (e) { len = 0 }
            if (!len) {
                if (dot) { dot.style.display = 'none'; dot.classList.remove('is-hot') }
                if (hit) hit.style.display = 'none'
                continue
            }

            var mid = path.getPointAtLength(len / 2)

            if (!dot || !hit) {
                var made = makeMarkers(g)
                dot = made.dot
                hit = made.hit
            }

            dot.style.display = ''
            hit.style.display = ''
            // 只在真正变化时写属性，避免无谓的样式重算
            var cx = String(mid.x), cy = String(mid.y)
            if (dot.getAttribute('cx') !== cx) dot.setAttribute('cx', cx)
            if (dot.getAttribute('cy') !== cy) dot.setAttribute('cy', cy)
            if (hit.getAttribute('cx') !== cx) hit.setAttribute('cx', cx)
            if (hit.getAttribute('cy') !== cy) hit.setAttribute('cy', cy)
        }
    }

    function onPointerDown(ev) {
        var t = ev.target
        if (!t || !t.classList) return
        if (!t.classList.contains(CLASS) && !t.classList.contains(HIT)) return

        var g = t.parentNode
        while (g && g.classList && !g.classList.contains('vue-flow__edge')) g = g.parentNode
        if (!g || !g.getAttribute) return

        var id = g.getAttribute('data-id')
        if (id == null) return

        // 抢在 Vue Flow 的 pane 处理之前，避免顺手起框选/清选中
        ev.stopPropagation()
        ev.preventDefault()

        if (!flow || !flow.removeEdges) return
        try {
            flow.removeEdges([id])
        } catch (e) {
            console.warn('[xcat] 断开连线失败:', id, e)
        }
        schedule()
    }

    function observe() {
        // 边容器是「每条边一个 svg」，统一观察它们的公共父级（transformationpane）
        var host = document.querySelector('.vue-flow__transformationpane') ||
                   document.querySelector('.vue-flow__viewport')
        if (!host) return false
        if (!obs) {
            obs = new MutationObserver(schedule)
            obs.observe(host, {
                subtree: true,
                childList: true,          // 增删边 / 换 edge 类型
                attributes: true,         // 节点拖动 ⇒ path 的 d 变化
                attributeFilter: ['d']
            })
        }
        return true
    }

    window.addEventListener('pointerdown', onPointerDown, true)

    var bootTimer = setInterval(function () {
        flow = window.__xcatFlow || null
        if (flow && observe()) {
            clearInterval(bootTimer)
            schedule()
        }
    }, 400)
    setTimeout(function () { clearInterval(bootTimer) }, 30000)

    // 缩放切换 0.6 阈值、pan 之后兜底刷新
    document.addEventListener('wheel', schedule, { capture: true, passive: true })

    // 兜底轮询：Vue Flow 分批 patch（先挂 <g> 再写 path 的 d），observer 可能
    // 刚好在「g 已在、path 未就绪」那一刻跑完就再没动静，导致个别边走漏没有圆点。
    // 500ms 补一次，边数量级很小，开销可忽略。
    setInterval(schedule, 500)
})()
