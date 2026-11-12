/* 文本节点（asset-text / gen-text）按 Markdown 显示。
 *
 * 不改上游 bundle：.xcat-text-wrap 里原本只有一块 textarea（Vue 绑定 data.text）。
 * 这里额外插一块 .xcat-text-render，把 textarea.value 解析成 HTML 显示；
 * 平时 textarea 透明 + pointer-events:none，节点行为和其它节点一致（可拖动），
 * 双击由 xcat-text-edit.js 加 .xcat-text-editing，此时隐藏渲染层、显示源码编辑框。
 *
 * 自带一个够用的 Markdown 解析器，不依赖 CDN / npm（画布是离线 iframe）。
 * 支持：ATX 标题、段落、软换行、粗体/斜体/删除线、行内代码、围栏代码块、
 *       引用（可嵌套）、无序/有序列表（含缩进嵌套与任务列表）、GFM 表格、
 *       分割线、链接、图片、自动链接、反斜杠转义。
 * 安全：所有文本先整体 HTML 转义再解析，链接协议白名单，代码内容不会被二次解析。
 */
;(function () {
  'use strict'

  /* 段落内的单个换行渲染成 <br>（GFM breaks:true）。画布里写提示词 / 说明时
     逐行换行是刚需，CommonMark 默认的「软换行=空格」反而不好用。 */
  var BREAKS = true
  var HOLDER = '\u0001' /* 占位符边界：正常文本里不会出现 */

  function esc (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  /* URL 只放行 http/https/mailto/锚点/相对路径；javascript: / data: 一律退化成纯文本 */
  function safeUrl (u) {
    var s = String(u || '').trim().replace(/&amp;/g, '&').replace(/[\u0000-\u001f\u007f]/g, '')
    if (/^(?:javascript|vbscript|file|data)\s*:/i.test(s)) return ''
    return s
  }

  var stash = []
  function hold (html) {
    return HOLDER + (stash.push(html) - 1) + HOLDER
  }
  function restore (s) {
    return s.replace(new RegExp(HOLDER + '(\\d+)' + HOLDER, 'g'), function (_, n) {
      return stash[+n] || ''
    })
  }

  function linkHtml (text, raw) {
    var u = safeUrl(String(raw || '').trim().split(/\s+/)[0])
    if (!u) return text
    return '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + text + '</a>'
  }

  function imageHtml (alt, raw) {
    var u = safeUrl(String(raw || '').trim().split(/\s+/)[0])
    if (!u) return alt
    return '<img src="' + esc(u) + '" alt="' + alt + '" loading="lazy">'
  }

  /* 只处理强调标记，输入是「已经转义过」的文本（给链接文字用） */
  function emphasisEscaped (s) {
    return s
      .replace(/\*\*([^\n*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^\n_]+)__/g, '<strong>$1</strong>')
      .replace(/~~([^\n~]+)~~/g, '<del>$1</del>')
      .replace(/\*([^\n*]+)\*/g, '<em>$1</em>')
  }

  /* 行内解析。传入的已经是转义过的文本。 */
  function inline (raw) {
    var t = esc(raw)

    /* 反斜杠转义先抽走，避免 \* 被当成斜体标记 */
    t = t.replace(/\\([\\`*_{}\[\]()#+\-.!>~|])/g, function (_, ch) {
      return hold(esc(ch))
    })

    /* 行内代码抽走，内容不参与后续任何解析 */
    t = t.replace(/(`+)([^`\n]+?)\1/g, function (_, tick, code) {
      return hold('<code>' + code + '</code>')
    })

    /* 图片要在链接之前（![alt](url) 会被链接正则误吃） */
    t = t.replace(/!\[([^\]\n]*)\]\(([^)\n]*)\)/g, function (_, alt, u) {
      return hold(imageHtml(alt, u))
    })
    /* 链接整段抽成占位符：URL 里常见的 _ / * 不能被后面的强调规则改写 */
    t = t.replace(/\[([^\]\n]+)\]\(([^)\n]*)\)/g, function (_, label, u) {
      return hold(linkHtml(emphasisEscaped(label), u))
    })
    t = t.replace(/&lt;((?:https?:\/\/|mailto:)[^\s&]+)&gt;/g, function (_, u) {
      return hold(linkHtml(esc(safeUrl(u)), u))
    })

    t = t.replace(/\*\*([^\n*]+)\*\*/g, '<strong>$1</strong>')
    t = t.replace(/__([^\n_]+)__/g, '<strong>$1</strong>')
    t = t.replace(/~~([^\n~]+)~~/g, '<del>$1</del>')
    t = t.replace(/\*([^\n*]+)\*/g, '<em>$1</em>')
    t = t.replace(/(^|[^\w])_([^\n_]+)_(?=[^\w]|$)/g, '$1<em>$2</em>')

    if (BREAKS) {
      t = t.replace(/ {2,}\n/g, '<br>\n').replace(/\n/g, '<br>')
    } else {
      t = t.replace(/ {2,}\n/g, '<br>\n').replace(/\\\n/g, '<br>\n').replace(/\n/g, ' ')
    }
    return restore(t)
  }

  var LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/
  var HR_RE = /^ {0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/
  var HEAD_RE = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/
  var QUOTE_RE = /^ {0,3}>/
  var FENCE_RE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)\s*$/

  function isBlockStart (lines, i) {
    var l = lines[i]
    if (l == null) return true
    if (!l.trim()) return true
    return FENCE_RE.test(l) || HR_RE.test(l) || HEAD_RE.test(l) ||
      QUOTE_RE.test(l) || LIST_RE.test(l) ||
      (l.indexOf('|') >= 0 && i + 1 < lines.length && isTableDelim(lines[i + 1]))
  }

  function isTableDelim (l) {
    return /^ {0,3}\|?[\s:|\-]+\|[\s:|\-]*$/.test(l || '') && /-/.test(l || '')
  }

  function cells (l) {
    return l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(function (c) {
      return c.trim()
    })
  }

  function parseTable (lines, i) {
    var head = cells(lines[i])
    var delim = cells(lines[i + 1])
    var aligns = delim.map(function (d) {
      if (/^:.*:$/.test(d)) return 'center'
      if (/:$/.test(d)) return 'right'
      if (/^:/.test(d)) return 'left'
      return ''
    })
    var html = ['<table><thead><tr>']
    for (var c = 0; c < head.length; c++) {
      html.push('<th' + (aligns[c] ? ' style="text-align:' + aligns[c] + '"' : '') + '>' +
        inline(head[c]) + '</th>')
    }
    html.push('</tr></thead>')
    var j = i + 2
    var body = []
    while (j < lines.length && lines[j].trim() && lines[j].indexOf('|') >= 0) {
      var row = cells(lines[j])
      var tr = ['<tr>']
      for (var k = 0; k < head.length; k++) {
        tr.push('<td' + (aligns[k] ? ' style="text-align:' + aligns[k] + '"' : '') + '>' +
          inline(row[k] || '') + '</td>')
      }
      tr.push('</tr>')
      body.push(tr.join(''))
      j++
    }
    if (body.length) html.push('<tbody>' + body.join('') + '</tbody>')
    html.push('</table>')
    return { html: html.join(''), next: j }
  }

  function parseList (lines, i) {
    var first = LIST_RE.exec(lines[i])
    var base = first[1].length
    var ordered = /^\d/.test(first[2])
    var tag = ordered ? 'ol' : 'ul'
    var items = []
    while (i < lines.length) {
      var m = LIST_RE.exec(lines[i])
      if (!m || m[1].length < base) break
      if (m[1].length > base) {
        /* 缩进更深 → 递归成子列表，挂到上一个 li */
        var sub = []
        while (i < lines.length) {
          var sm = LIST_RE.exec(lines[i])
          if (!sm || sm[1].length <= base) break
          sub.push(lines[i].slice(Math.min(sm[1].length, base + 2)))
          i++
        }
        if (items.length) {
          var last = items.length - 1
          items[last] = items[last].replace(/<\/li>$/, '') +
            parseList(sub.map(function (s) { return s.replace(/^\s{0,2}/, '') }), 0).html + '</li>'
        }
        continue
      }
      if (/^\d/.test(m[2]) !== ordered) break

      var content = m[3]
      var task = /^\[([ xX])\]\s*(.*)$/.exec(content)
      var inner
      if (task) {
        var done = task[1].toLowerCase() === 'x'
        inner = '<span class="xcat-md-check' + (done ? ' is-checked' : '') + '">' +
          (done ? '✓' : '') + '</span>' + inline(task[2])
      } else {
        inner = inline(content)
      }
      i++
      /* 缩进续行并入同一项 */
      var cont = []
      while (i < lines.length && lines[i].trim() && !isBlockStart(lines, i) &&
             /^\s{2,}/.test(lines[i])) {
        cont.push(lines[i].trim())
        i++
      }
      if (cont.length) inner += (BREAKS ? '<br>' : ' ') + inline(cont.join('\n'))
      items.push('<li>' + inner + '</li>')
      /* 列表项之间的空行：允许一个，之后仍是同级列表才继续 */
      if (i < lines.length && !lines[i].trim()) {
        var k = i
        while (k < lines.length && !lines[k].trim()) k++
        if (k < lines.length && LIST_RE.test(lines[k]) &&
            LIST_RE.exec(lines[k])[1].length === base) i = k
      }
    }
    return { html: '<' + tag + '>' + items.join('') + '</' + tag + '>', next: i }
  }

  function renderMarkdown (src) {
    var lines = String(src || '').replace(/\r\n?/g, '\n').split('\n')
    var out = []
    var i = 0
    while (i < lines.length) {
      var line = lines[i]
      if (!line.trim()) { i++; continue }

      var fence = FENCE_RE.exec(line)
      if (fence) {
        var ch = fence[1][0]
        var min = fence[1].length
        var buf = []
        i++
        while (i < lines.length) {
          var close = new RegExp('^ {0,3}' + (ch === '`' ? '`' : '~') + '{' + min + ',}\\s*$')
          if (close.test(lines[i])) { i++; break }
          buf.push(lines[i]); i++
        }
        var lang = fence[2] ? ' class="language-' + esc(fence[2]) + '"' : ''
        out.push('<pre><code' + lang + '>' + esc(buf.join('\n')) + '</code></pre>')
        continue
      }

      if (HR_RE.test(line)) { out.push('<hr>'); i++; continue }

      var h = HEAD_RE.exec(line)
      if (h) {
        var lv = h[1].length
        out.push('<h' + lv + '>' + inline(h[2]) + '</h' + lv + '>')
        i++
        continue
      }

      if (QUOTE_RE.test(line)) {
        var q = []
        while (i < lines.length && QUOTE_RE.test(lines[i])) {
          q.push(lines[i].replace(/^ {0,3}>\s?/, ''))
          i++
        }
        out.push('<blockquote>' + renderMarkdown(q.join('\n')) + '</blockquote>')
        continue
      }

      if (line.indexOf('|') >= 0 && i + 1 < lines.length && isTableDelim(lines[i + 1])) {
        var tb = parseTable(lines, i)
        out.push(tb.html)
        i = tb.next
        continue
      }

      if (LIST_RE.test(line)) {
        var ls = parseList(lines, i)
        out.push(ls.html)
        i = ls.next
        continue
      }

      var para = []
      while (i < lines.length && !isBlockStart(lines, i)) { para.push(lines[i]); i++ }
      if (!para.length) { i++; continue } /* 防御：避免死循环 */
      out.push('<p>' + inline(para.join('\n')) + '</p>')
    }
    return out.join('\n')
  }

  /* ---------------- DOM 同步 ---------------- */

  function syncWrap (wrap) {
    var ta = wrap.querySelector('.xcat-text-area')
    var view = wrap.querySelector('.xcat-text-render')
    if (!ta || !view) return
    var src = ta.value || ''
    if (view._xcatMdSrc === src) return
    view._xcatMdSrc = src
    stash.length = 0
    view.innerHTML = src.trim()
      ? renderMarkdown(src)
      : '<p class="xcat-md-hint">双击输入 Markdown 文本…</p>'
  }

  function syncAll () {
    var list = document.querySelectorAll('.xcat-text-wrap')
    for (var i = 0; i < list.length; i++) {
      var wrap = list[i]
      if (!wrap.querySelector('.xcat-text-render')) {
        var view = document.createElement('div')
        view.className = 'xcat-text-render nodrag nowheel'
        wrap.appendChild(view)
      }
      syncWrap(wrap)
    }
  }

  /* 输入时立即重绘（编辑态渲染层虽隐藏，退出双击后马上就是新内容） */
  document.addEventListener('input', function (ev) {
    var ta = ev.target
    if (ta && ta.classList && ta.classList.contains('xcat-text-area')) {
      var wrap = ta.closest('.xcat-text-wrap')
      if (wrap) syncWrap(wrap)
    }
  }, true)

  /* 新节点 / 画布恢复 / 复制节点：DOM 出现就挂渲染层 */
  if (document.body) {
    new MutationObserver(function () { syncAll() })
      .observe(document.body, { childList: true, subtree: true })
  }

  /* 程序性改值（撤销、粘贴恢复、updateNodeData）不走 input 事件，定时兜底。
     比对 _xcatMdSrc 短路，节点多也不会有额外开销。 */
  setInterval(syncAll, 300)

  /* 渲染层 pointer-events:none 才能保持「鼠标放上去 = 可拖动」，因此滚轮不会
     命中它。在捕获阶段按坐标判断，把滚轮改写成渲染层滚动，并挡住 Vue Flow 缩放。 */
  document.addEventListener('wheel', function (ev) {
    var wrap = null
    var node = ev.target && ev.target.closest ? ev.target.closest('.demo-node') : null
    if (node) {
      var w = node.querySelector('.xcat-text-wrap')
      if (w) {
        var r = w.getBoundingClientRect()
        if (ev.clientX >= r.left && ev.clientX <= r.right &&
            ev.clientY >= r.top && ev.clientY <= r.bottom) wrap = w
      }
    }
    if (!wrap) return
    if (node && node.classList.contains('xcat-text-editing')) return
    var view = wrap.querySelector('.xcat-text-render')
    if (!view) return
    var max = view.scrollHeight - view.clientHeight
    if (max <= 1) return
    if ((ev.deltaY < 0 && view.scrollTop <= 0) || (ev.deltaY > 0 && view.scrollTop >= max)) return
    ev.preventDefault()
    ev.stopPropagation()
    view.scrollTop = Math.max(0, Math.min(max, view.scrollTop + ev.deltaY))
  }, { capture: true, passive: false })

  document.addEventListener('DOMContentLoaded', syncAll)
  syncAll()

  window.__xcatMarkdown = { render: renderMarkdown, sync: syncAll, escape: esc }
})()
