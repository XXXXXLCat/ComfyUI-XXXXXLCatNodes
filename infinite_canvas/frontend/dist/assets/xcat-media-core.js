/* ==================================================================
   xcat-media-core.js — 节点媒体编辑公共内核（2026-11-13）
   ------------------------------------------------------------------
   音频节点「截取 / 变速」与视频节点「提取音轨 / 分离音视频 / 截取片段 /
   截取视频帧」共用以下能力，避免每个功能各写一份：

     makeButton()      节点上方统一规格的文字按钮（is-enabled + scoped id）
     createProbe()     后端 Python 是否重启的探测（旧进程会把 POST 落到静态
                       路由，返回纯文本 405/404，而不是 JSON）
     request()         fetch + 先读文本再 JSON.parse，非 JSON 给可操作提示
     buildResultNodes() 把后端返回的 files[] 批量建成新素材节点并写入媒体，
                       失败整体回滚 removeNodes
     warnHtml/setWarn  弹窗里「后端未重启」横幅
     activeMedia()     从节点 DOM 反查当前素材（按 kind 过滤）

   产物约定：后端 files[] 每项 {filename,name,subfolder,type,role}，
   role 决定新节点是 asset-audio / asset-video / asset-image；原节点永不替换。
   ================================================================== */
(function () {
  'use strict';
  if (window.__xcatMediaCore) return;

  var SCOPE = 'data-v-abbe9e2b';
  var NODE_W = 480, NODE_H = 270, GAP_X = 80, GAP_Y = 40;

  function flow () { return window.__xcatFlow; }
  function graph () { return window.__xcatGraph; }
  function q (sel, root) { return (root || document).querySelector(sel); }
  function qa (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function clamp (v, a, b) { return v < a ? a : (v > b ? b : v); }
  function esc (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function nodeById (id) {
    var f = flow();
    if (!f || !f.getNodes) return null;
    return f.getNodes.value.find(function (n) { return n.id === id; }) || null;
  }

  function refOf (item) {
    if (item.ref && item.ref.filename) {
      return {
        filename: String(item.ref.filename),
        subfolder: String(item.ref.subfolder || ''),
        type: String(item.ref.type || 'input')
      };
    }
    try {
      var u = new URL(item.url, location.origin);
      return {
        filename: u.searchParams.get('filename') || '',
        subfolder: u.searchParams.get('subfolder') || '',
        type: u.searchParams.get('type') || 'input'
      };
    } catch (e) { return { filename: '', subfolder: '', type: 'input' }; }
  }

  /* wrap 是 .vue-flow__node；kind 传 'audio' / 'video' 等做过滤 */
  function activeMedia (wrap, kind) {
    var id = wrap && wrap.dataset ? wrap.dataset.id : null;
    var n = id ? nodeById(id) : null;
    if (!n) return null;
    var media = (n.data && n.data.media) || [];
    var idx = clamp(Number(n.data && n.data.index) || 0, 0, Math.max(0, media.length - 1));
    var cur = media[idx];
    if (!cur || (kind && cur.kind !== kind)) return null;
    return { id: id, node: n, item: cur, ref: refOf(cur) };
  }

  function toast (text, isError) {
    var host = q('#app') || document.body;
    var el = document.createElement('div');
    el.className = 'xcat-ae-toast' + (isError ? ' is-error' : '');
    el.textContent = text;
    host.appendChild(el);
    setTimeout(function () { el.remove(); }, 3200);
  }

  /* 节点上方操作行的文字按钮。与 xcat-audio-edit.js 的 makeBtn 同规格：
     is-enabled 描边、scoped id、data-xcat-text 阻止 CSS 再补 ::after。 */
  function makeButton (cls, label, onClick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'fan-btn is-enabled ' + cls + ' nodrag';
    b.title = label;
    b.setAttribute('aria-label', label);
    b.setAttribute('data-xcat-text', '');
    b.setAttribute(SCOPE, '');
    b.textContent = label;
    ['pointerdown', 'mousedown', 'dblclick', 'click'].forEach(function (t) {
      b.addEventListener(t, function (e) { e.stopPropagation(); });
    });
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      onClick(b);
    });
    return b;
  }

  /* defs: [{cls, label, open(ctx, wrap, btn)}]；ctx = activeMedia() 的结果。
     上游每次 hover 都会重建 .node-actions，所以每次 install 既要补注入，
     也要重新按「当前素材类型」决定显示与否 —— 与 xcat-audio-edit.js 一致，
     否则图片 / 音频 / 空节点上也会挂着一堆点了没反应的视频按钮。 */
  function installButtons (barSelector, defs, kind) {
    qa(barSelector).forEach(function (bar) {
      defs.forEach(function (d) {
        if (q('.' + d.cls, bar)) return;
        bar.appendChild(makeButton(d.cls, d.label, function (btn) {
          var wrap = btn.closest('.vue-flow__node');
          var ctx = activeMedia(wrap, kind);
          if (!ctx || !wrap) return;
          d.open(ctx, wrap, btn);
        }));
      });
    });
    qa(defs.map(function (d) { return barSelector + ' .' + d.cls; }).join(',')).forEach(function (b) {
      var wrap = b.closest('.vue-flow__node');
      b.style.display = activeMedia(wrap, kind) ? '' : 'none';
    });
  }

  /* 后端 Python 改了路由就必须重启 ComfyUI。旧进程里同路径会被静态文件路由
     接走，返回 text/plain 的 "405: Method Not Allowed" / "404: Not Found"，
     直接 res.json() 只会抛一个看不懂的 JSONDecodeError。 */
  function createProbe (api) {
    var ready = false, checked = false;
    return {
      get ready () { return ready; },
      invalidate: function () { ready = false; checked = false; },
      check: function () {
        if (checked) return Promise.resolve(ready);
        return fetch(api, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}'
        }).then(function (res) {
          var ct = res.headers.get('content-type') || '';
          return res.text().then(function (raw) {
            try { return /json/i.test(ct) && !!JSON.parse(raw); }
            catch (e) { return false; }
          });
        }).then(function (ok) {
          ready = ok;
          checked = ok;              /* 失败不缓存，重启后重开窗口即恢复 */
          return ok;
        }).catch(function () {
          ready = false; checked = false;
          return false;
        });
      }
    };
  }

  /* label 只用于错误文案：「音频 / 视频处理接口未就绪」 */
  function request (api, payload, signal, label) {
    return fetch(api, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: signal || undefined
    }).then(function (res) {
      return res.text().then(function (raw) {
        var data;
        try { data = JSON.parse(raw); }
        catch (e) {
          throw new Error((label || '媒体') + '处理接口未就绪（HTTP ' + res.status +
            '）：后端 Python 尚未重启，请完全重启 ComfyUI 后重试（只刷新浏览器无效）');
        }
        if (!res.ok) throw new Error((data && data.error) || ('HTTP ' + res.status));
        return data;
      });
    });
  }

  function warnHtml (text) {
    return '<div class="xcat-ae-warn" id="xcat-ae-warn" hidden>' + text + '</div>';
  }
  function setWarn (modal, ready, statusText) {
    if (!modal) return;
    var w = q('#xcat-ae-warn', modal);
    if (w) w.hidden = !!ready;
    var s = q('#xcat-ae-status', modal);
    if (!s) return;
    if (!ready && statusText) {
      s.textContent = statusText;
      s.classList.add('is-error');
    } else if (ready && s.textContent === statusText) {
      s.textContent = '';
      s.classList.remove('is-error');
    }
  }

  /* ---------------------------------------------------------- 产物节点 */
  /* 三个坑都踩过，别再改回去：
     1) appendItems() 操作的是 useGraph 自己的 nodes ref（bundle 里 TM() 的
        t=te([])），而 __xcatFlow 是 Vue Flow 实例。两侧靠 watch + nextTick
        双向同步，所以「先建节点、延迟 80ms 再 appendItems 写 media」这个老
        写法在连续生成时必然踩空：要么 appendItems 找不到节点，要么上游
        watch 用旧快照把 Vue Flow 侧的新节点推回去（hook 日志里 setNodes 后
        after 是 "1,2,3,4,5"，下一拍 appendItems 的 before 又退回 "1,2,3,4"）。
        正解照上游 spawnItemsNodeAt：节点自带 data.media，一次 addNodes 完成，
        完全不经过 appendItems。
     2) 别用 f.setNodes(旧.concat(新)) 整体赋值。整体替换会触发上游正/反向
        watch 的 pause/resume 竞争，实测新节点在下一拍就被旧快照覆盖掉。
        增量 addNodes 才是上游自己（onDblClick 的 _()、spawnItemsNodeAt）的路径。
     3) 上游 spawnDetachedNode 虽然改的是真源 t.value，但它用闭包自增计数器 r
        分配 id，和 xcat-new-node.js 的 nextId()（按现有节点 max+1）不同步 ——
        菜单新建的节点 id 是 "1" 时，r 仍从 0 开始，会生成重复 id。
     所以：自己算唯一 id + addNodes 增量添加，media 直接放进 data。
     4) 最关键的一条：视口外的节点加不进去。上游 / Vue Flow 会把可见区域外、
        没能完成初始化的节点丢掉（实测 zoom .7、窗口 1424×805 时，可见 flow
        区域只有约 2034×1150；y=2000 的节点 addNodes 后 getNodes 里直接没有）。
        老 placeClear 只会无限往下累加 y，连续第 4 个产物必然掉出可见区，
        表现成「toast 成功但节点凭空消失」。现在改成在当前可见区内按网格找空位。
     ================================================================== */

  /* 当前视口对应的 flow 坐标可见矩形（留 24px 边距） */
  function visibleRect () {
    var f = flow();
    var vp = (f && f.viewport && f.viewport.value) || { x: 0, y: 0, zoom: 0.7 };
    var z = Number(vp.zoom) || 0.7;
    var pad = 24;
    var x = -Number(vp.x || 0) / z + pad;
    var y = -Number(vp.y || 0) / z + pad;
    return {
      x: x, y: y,
      w: Math.max(NODE_W + pad, (window.innerWidth || 1280) / z - pad * 2),
      h: Math.max(NODE_H + pad, (window.innerHeight || 800) / z - pad * 2)
    };
  }

  /* 在可见区网格里找离期望位置最近、且不与现有节点重叠的空位。
     all 必须包含本次批次里已经算好的节点，否则多产物会叠在一起。 */
  function placeClear (x, y, all) {
    var r = visibleRect();
    var stepX = NODE_W + GAP_X, stepY = NODE_H + GAP_Y;
    var cols = Math.max(1, Math.floor((r.w + GAP_X) / stepX));
    var rows = Math.max(1, Math.floor((r.h + GAP_Y) / stepY));
    var wantX = clamp(x, r.x, r.x + r.w - NODE_W);
    var wantY = clamp(y, r.y, r.y + r.h - NODE_H);

    function overlaps (px, py) {
      for (var i = 0; i < all.length; i++) {
        var o = all[i];
        var ow = Number(o.data && o.data.w) || NODE_W;
        var oh = Number(o.data && o.data.h) || NODE_H;
        if (px < o.position.x + ow && o.position.x < px + NODE_W &&
            py < o.position.y + oh && o.position.y < py + NODE_H) return true;
      }
      return false;
    }

    if (!overlaps(wantX, wantY)) return { x: Math.round(wantX), y: Math.round(wantY) };

    var spots = [];
    for (var row = 0; row < rows; row++) {
      for (var col = 0; col < cols; col++) {
        var px = r.x + col * stepX, py = r.y + row * stepY;
        spots.push({
          x: px, y: py,
          d: Math.abs(px - wantX) + Math.abs(py - wantY)
        });
      }
    }
    spots.sort(function (a, b) { return a.d - b.d; });
    for (var j = 0; j < spots.length; j++) {
      if (!overlaps(spots[j].x, spots[j].y)) {
        return { x: Math.round(spots[j].x), y: Math.round(spots[j].y) };
      }
    }
    /* 可见区全满：至少保证落在可见区，别再往视口外堆 */
    return { x: Math.round(wantX), y: Math.round(wantY) };
  }

  function uniqueId (used, seed) {
    var v = seed;
    while (used.indexOf(String(v)) >= 0) v += 1;
    return String(v);
  }

  function buildResultNodes (files, srcId) {
    var f = flow(), g = graph();
    if (!f || !f.getNodes || !f.addNodes || !g || !g.itemsFromRefs) {
      return Promise.reject(new Error('画布尚未就绪'));
    }
    var existing = f.getNodes.value || [];
    var used = existing.map(function (n) { return String(n.id); });
    var max = 0;
    existing.forEach(function (n) {
      var v = parseInt(n.id, 10);
      if (!isNaN(v) && v > max) max = v;
    });
    var src = nodeById(srcId);
    var x = (src ? src.position.x : 0) + NODE_W + GAP_X;
    var y = src ? src.position.y : 0;
    var created = [], added = [];
    try {
      files.forEach(function (file) {
        var items = g.itemsFromRefs([{
          filename: file.filename,
          name: file.name,
          subfolder: file.subfolder || '',
          type: file.type || 'input'
        }]);
        if (!items.length) throw new Error('无法构造媒体项');
        /* 每轮都用同一期望点，由 placeClear 依据「已有节点 + 本批已建节点」
           在可见区里挑空位；不要再手动累加 y，否则又会掉出视口。 */
        var p = placeClear(x, y, existing.concat(added));
        max += 1;
        var id = uniqueId(used, max);
        used.push(id);
        created.push(id);
        added.push({
          id: id, type: 'demo',
          position: { x: Math.round(p.x), y: Math.round(p.y) },
          data: {
            label: file.name || ('节点 ' + id), workflow: '', params: {}, randomFields: {},
            inputMedia: [], media: items.slice(0, 1), index: 0,
            role: file.role || 'asset-image'
          }
        });
      });
      /* 一次增量添加即可：节点自带 media，跨 store 的 appendItems 时序问题
         不复存在。上游 spawnItemsNodeAt / onDblClick 也是这么建的。 */
      if (added.length) f.addNodes(added);
      return Promise.resolve(created);
    } catch (err) {
      if (created.length) { try { f.removeNodes(created); } catch (_) {} }
      return Promise.reject(err);
    }
  }

  window.__xcatMediaCore = {
    SCOPE: SCOPE, NODE_W: NODE_W, NODE_H: NODE_H, GAP_X: GAP_X, GAP_Y: GAP_Y,
    flow: flow, graph: graph, q: q, qa: qa, clamp: clamp, esc: esc,
    nodeById: nodeById, refOf: refOf, activeMedia: activeMedia,
    toast: toast, makeButton: makeButton, installButtons: installButtons,
    createProbe: createProbe, request: request,
    warnHtml: warnHtml, setWarn: setWarn,
    buildResultNodes: buildResultNodes
  };
})();
