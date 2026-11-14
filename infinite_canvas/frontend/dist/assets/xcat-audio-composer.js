/* ==========================================================================
 * 生成音频节点：对话式面板（风格 / 歌词 + 底部工具条）
 * --------------------------------------------------------------------------
 * 目标形态（参考 MiniMax 音乐输入框）：
 *
 *   ┌───────────────────────────────────────────────┐
 *   │ 风格提示词            │  歌词                  │
 *   │ （大输入框）           │  （大输入框）           │
 *   ├───────────────────────────────────────────────┤
 *   │ [音乐|语音] [工作流 ⌄] [⚙]              [运行]  │
 *   └───────────────────────────────────────────────┘
 *   ⚙ 打开设置浮层：最大时长 / 随机种子 / 保存音频类型
 *
 * 为什么不改 Vue 的渲染结构：面板里每个控件都绑定着组件内部状态
 * （`pn(field, 值)` / 主提示词 `T` / 工作流切换 `cl` / 运行 `ct`），
 * 自己重画一套等于把这些逻辑复制一遍，上游一升级就全废。
 * 这里用「影子控件」：上游那套面板整体 CSS 隐藏（display:none 不销毁，
 * 事件照样能派发），我们在上面画新 UI，交互时把值写进隐藏控件并派发
 * input / change / click —— Vue 自己会把它当成用户输入处理。
 * 反过来，隐藏控件里的值（切工作流后变默认值、种子刷新、运行按钮文案）
 * 由轮询 + MutationObserver 同步回新 UI。
 *
 * 站点：只在 role === "gen-audio" 的面板上接管，其它生成节点完全不受影响。
 * ========================================================================== */
(function () {
    'use strict';
    if (window.__xcatAudioComposerInstalled) return;
    window.__xcatAudioComposerInstalled = true;

    var PANEL_CLS = 'xcat-audio';
    var STYLE_LABEL = '风格提示词';
    var STYLE_PH = '必填，音乐类型 / 情绪 / BPM / 乐器…';
    var LYRICS_PH = '必填，在此输入或粘贴歌词…';

    var ICON_GEAR =
        '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<circle cx="12" cy="12" r="3"></circle>' +
        '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>' +
        '</svg>';
    var ICON_CHEVRON =
        '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>';
    var ICON_DICE =
        '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="m18 14l4 4l-4 4m0-20l4 4l-4 4"></path>' +
        '<path d="M2 18h1.973a4 4 0 0 0 3.3-1.7l5.454-8.6a4 4 0 0 1 3.3-1.7H22M2 6h1.972a4 4 0 0 1 3.6 2.2M22 18h-6.041a4 4 0 0 1-3.3-1.8l-.359-.45"></path>' +
        '</svg>';

    function flow () {
        try { return window.__xcatFlow || null } catch (e) { return null }
    }

    function nodeOf (el) {
        var host = el.closest && el.closest('.vue-flow__node');
        if (!host) return null;
        var f = flow();
        if (!f || !f.getNodes) return null;
        var id = host.getAttribute('data-id');
        var list = f.getNodes.value || [];
        for (var i = 0; i < list.length; i++) {
            if (String(list[i].id) === id) return list[i];
        }
        return null;
    }

    function roleOf (el) {
        var node = nodeOf(el);
        if (!node) return '';
        try {
            return (window.__xcatRole ? window.__xcatRole(node.data) : '') || '';
        } catch (e) { return '' }
    }

    /* ------------------------------------------------------------ 影子控件 */

    function fire (el, type) {
        if (!el) return;
        el.dispatchEvent(new Event(type, { bubbles: true }));
    }

    function writeText (src, value) {
        if (!src) return;
        var text = String(value == null ? '' : value);
        if (src.value === text) return;
        src.value = text;
        fire(src, 'input');
    }

    function writeSelect (src, value) {
        if (!src) return;
        var text = String(value == null ? '' : value);
        if (src.value === text) return;
        src.value = text;
        fire(src, 'change');
    }

    /* ------------------------------------------------------------ 字段扫描 */

    function readField (el) {
        var labelEl = el.querySelector('.panel-field-label');
        var title = (labelEl && labelEl.getAttribute('title')) || '';
        var parts = title.split(' ');
        var key = parts.length > 1 ? parts[parts.length - 1] : '';
        var label = labelEl ? (labelEl.textContent || '').trim() : key;
        var kind = 'number';
        var ctrl = null;
        var text = el.querySelector(':scope > textarea.panel-text');
        if (text) {
            kind = 'text';
            ctrl = text;
        } else if ((ctrl = el.querySelector(':scope > .panel-random'))) {
            kind = 'random';
        } else if ((ctrl = el.querySelector(':scope > select.panel-select'))) {
            kind = 'select';
        } else if ((ctrl = el.querySelector(':scope > .panel-switch'))) {
            kind = 'switch';
        } else if ((ctrl = el.querySelector(':scope > input.panel-input-wide'))) {
            kind = 'text';
            ctrl = el.querySelector(':scope > input.panel-input-wide');
        } else if ((ctrl = el.querySelector(':scope > input.panel-input'))) {
            kind = 'number';
        }
        return { el: el, key: key, label: label, kind: kind, ctrl: ctrl };
    }

    function fieldsOf (panel) {
        var box = panel.querySelector(':scope > .panel-fields');
        var out = [];
        if (!box) return out;
        for (var i = 0; i < box.children.length; i++) {
            var el = box.children[i];
            if (el.classList && el.classList.contains('panel-field')) out.push(readField(el));
        }
        return out;
    }

    function pillsOf (panel) {
        var box = panel.querySelector('.panel-workflows');
        var out = [];
        if (!box) return out;
        var group = '';
        for (var i = 0; i < box.children.length; i++) {
            var el = box.children[i];
            if (!el.classList || !el.classList.contains('wf-pill')) continue;
            var name = (el.textContent || '').trim();
            if (el.classList.contains('xcat-wf-pill-g')) {
                group = name;
                continue;
            }
            out.push({
                name: name,
                group: group,
                active: el.classList.contains('is-active'),
                el: el
            });
        }
        return out;
    }

    /* 选项形如 ["flac", "mp3:320k", "opus:96k"]：拆成「格式」+「码率」两个下拉 */
    function splitOptions (options) {
        var formats = [];
        var byFormat = {};
        (options || []).forEach(function (raw) {
            var value = String(raw);
            var at = value.indexOf(':');
            var format = at < 0 ? value : value.slice(0, at);
            var quality = at < 0 ? '' : value.slice(at + 1);
            if (!byFormat[format]) {
                byFormat[format] = [];
                formats.push(format);
            }
            if (quality) byFormat[format].push(quality);
        });
        return { formats: formats, byFormat: byFormat };
    }

    /* ------------------------------------------------------------ UI 片段 */

    function el (tag, cls, text) {
        var node = document.createElement(tag);
        if (cls) node.className = cls;
        if (text != null) node.textContent = text;
        return node;
    }

    function labelOf (field, fallback) {
        var text = field && field.label ? field.label : fallback;
        return text || '';
    }

    /* ------------------------------------------------------------ 构建 */

    function build (panel, st) {
        if (st.root && st.root.parentNode) st.root.parentNode.removeChild(st.root);
        var fields = fieldsOf(panel);
        var lyrics = null;
        for (var i = 0; i < fields.length; i++) {
            if (fields[i].kind === 'text') { lyrics = fields[i]; break; }
        }
        var settings = fields.filter(function (f) { return f !== lyrics });
        /* 上游字段顺序按控件类型分组（select 会排到最前），这里按用户约定重排：
           最大时长 → 随机种子 → 保存音频类型。其它字段保持原相对顺序。 */
        var rowRank = { max_duration: 0, seed: 1, format: 2 };
        settings.sort(function (a, b) {
            var ra = rowRank[a.key] == null ? 9 : rowRank[a.key];
            var rb = rowRank[b.key] == null ? 9 : rowRank[b.key];
            return ra - rb;
        });

        var root = el('div', 'xcat-ac');
        root.setAttribute('data-xcat-ac', '1');

        /* ---- 两个输入区 ---- */
        var inputs = el('div', 'xcat-ac-inputs' + (lyrics ? '' : ' is-single'));
        var styleBox = el('div', 'xcat-ac-box');
        styleBox.appendChild(el('div', 'xcat-ac-label', STYLE_LABEL));
        var styleText = el('textarea', 'xcat-ac-text');
        styleText.placeholder = STYLE_PH;
        styleText.spellcheck = false;
        styleBox.appendChild(styleText);
        inputs.appendChild(styleBox);

        var lyricsText = null;
        if (lyrics) {
            var lyricBox = el('div', 'xcat-ac-box');
            lyricBox.appendChild(el('div', 'xcat-ac-label', labelOf(lyrics, '歌词')));
            lyricsText = el('textarea', 'xcat-ac-text');
            lyricsText.placeholder = LYRICS_PH;
            lyricsText.spellcheck = false;
            lyricBox.appendChild(lyricsText);
            inputs.appendChild(lyricBox);
        }

        /* ---- 底部工具条 ---- */
        var bar = el('div', 'xcat-ac-bar');

        var seg = el('div', 'xcat-ac-seg');
        var musicBtn = el('button', 'is-on', '音乐');
        musicBtn.type = 'button';
        var voiceBtn = el('button', '', '语音');
        voiceBtn.type = 'button';
        seg.appendChild(musicBtn);
        seg.appendChild(voiceBtn);
        bar.appendChild(seg);

        var wfWrap = el('div', 'xcat-ac-wf');
        var wfBtn = el('button', 'xcat-ac-wfbtn');
        wfBtn.type = 'button';
        var wfName = el('span', 'xcat-ac-wfname', '选择工作流');
        wfBtn.appendChild(wfName);
        var chev = el('span', 'xcat-ac-wfchev');
        chev.innerHTML = ICON_CHEVRON;
        wfBtn.appendChild(chev);
        wfWrap.appendChild(wfBtn);
        var wfMenu = el('div', 'xcat-ac-wfmenu');
        wfWrap.appendChild(wfMenu);
        bar.appendChild(wfWrap);

        var setWrap = el('div', 'xcat-ac-settings');
        var gear = el('button', 'xcat-ac-gear');
        gear.type = 'button';
        gear.title = '设置';
        gear.innerHTML = ICON_GEAR;
        setWrap.appendChild(gear);
        var pop = el('div', 'xcat-ac-pop');
        setWrap.appendChild(pop);
        bar.appendChild(setWrap);

        var run = el('button', 'xcat-ac-run', '运行');
        run.type = 'button';
        bar.appendChild(run);

        root.appendChild(inputs);
        root.appendChild(bar);

        /* ---- 设置浮层：官方属性面板形态（标题 + 分隔线 + 属性行） ---- */
        pop.appendChild(el('div', 'xcat-ac-title', '设置'));
        var rows = [];
        settings.forEach(function (field) {
            if (field.kind === 'text') return;
            var row = el('div', 'xcat-ac-row');
            row.appendChild(el('span', 'xcat-ac-rlabel', labelOf(field, field.key)));
            var slot = el('span', 'xcat-ac-rctl');
            row.appendChild(slot);
            var item = { field: field, row: row, slot: slot };
            if (field.kind === 'random') {
                var seedInput = el('input', 'xcat-ac-num');
                seedInput.type = 'number';
                seedInput.min = field.ctrl.querySelector('input').getAttribute('min') || '0';
                seedInput.max = field.ctrl.querySelector('input').getAttribute('max') || '';
                seedInput.step = field.ctrl.querySelector('input').getAttribute('step') || '1';
                var dice = el('button', 'xcat-ac-dice');
                dice.type = 'button';
                dice.title = '每次运行自动刷新（点击恢复固定值）';
                dice.innerHTML = ICON_DICE;
                slot.appendChild(seedInput);
                slot.appendChild(dice);
                item.seedInput = seedInput;
                item.dice = dice;
            } else if (field.kind === 'select') {
                var src = field.ctrl;
                var values = [];
                for (var oi = 0; oi < src.options.length; oi++) values.push(src.options[oi].value);
                var split = splitOptions(values);
                var fmtSel = el('select', 'xcat-ac-sel');
                split.formats.forEach(function (f) {
                    var opt = el('option', '', f);
                    opt.value = f;
                    fmtSel.appendChild(opt);
                });
                var qSel = el('select', 'xcat-ac-sel');
                slot.appendChild(fmtSel);
                slot.appendChild(qSel);
                item.fmtSel = fmtSel;
                item.qSel = qSel;
                item.split = split;
                item.srcSelect = src;
            } else if (field.kind === 'switch') {
                var box = el('input');
                box.type = 'checkbox';
                slot.appendChild(box);
                item.check = box;
            } else {
                var num = el('input', 'xcat-ac-num');
                var srcInput = field.ctrl;
                num.type = srcInput && srcInput.type === 'number' ? 'number' : 'text';
                if (srcInput) {
                    ['min', 'max', 'step'].forEach(function (attr) {
                        var v = srcInput.getAttribute(attr);
                        if (v != null) num.setAttribute(attr, v);
                    });
                }
                slot.appendChild(num);
                item.numInput = num;
            }
            pop.appendChild(row);
            rows.push(item);
        });
        if (!rows.length) {
            var empty = el('div', 'xcat-ac-row');
            empty.appendChild(el('span', 'xcat-ac-rlabel', '该工作流没有可调参数'));
            pop.appendChild(empty);
        }

        panel.appendChild(root);

        st.root = root;
        st.styleText = styleText;
        st.lyricsText = lyricsText;
        st.lyricsSrc = lyrics ? lyrics.ctrl : null;
        st.styleSrc = panel.querySelector(':scope > .panel-prompt > textarea');
        st.musicBtn = musicBtn;
        st.voiceBtn = voiceBtn;
        st.wfWrap = wfWrap;
        st.wfBtn = wfBtn;
        st.wfName = wfName;
        st.wfMenu = wfMenu;
        st.setWrap = setWrap;
        st.gear = gear;
        st.pop = pop;
        st.rows = rows;
        st.run = run;
        st.sig = signature(panel, fields);
        st.menuSig = '';
        wire(st);
        syncValues(st, true);
    }

    function signature (panel, fields) {
        return JSON.stringify({
            keys: fields.map(function (f) { return f.key + ':' + f.kind + ':' + f.label }),
            prompt: !!panel.querySelector(':scope > .panel-prompt > textarea')
        });
    }

    /* ------------------------------------------------------------ 交互 */

    function wire (st) {
        var panel = st.panel;

        /* 风格提示词 → 影子主提示词 */
        st.styleText.addEventListener('input', function () {
            writeText(st.styleSrc, st.styleText.value);
        });
        st.styleText.addEventListener('keydown', function (e) { e.stopPropagation(); });

        if (st.lyricsText) {
            st.lyricsText.addEventListener('input', function () {
                writeText(st.lyricsSrc, st.lyricsText.value);
            });
            st.lyricsText.addEventListener('keydown', function (e) { e.stopPropagation(); });
        }

        /* 音乐 / 语音（暂行为一致，仅记忆选择） */
        function setMode (mode) {
            var node = nodeOf(panel);
            if (node) {
                try {
                    if (node.data) node.data.audioMode = mode;
                    var f = flow();
                    if (f && f.updateNodeData) f.updateNodeData(node.id, { audioMode: mode });
                } catch (e) {}
            }
            st.musicBtn.classList.toggle('is-on', mode !== 'voice');
            st.voiceBtn.classList.toggle('is-on', mode === 'voice');
        }
        st.musicBtn.addEventListener('click', function (e) { e.stopPropagation(); setMode('music'); });
        st.voiceBtn.addEventListener('click', function (e) { e.stopPropagation(); setMode('voice'); });
        st.setMode = setMode;

        /* 工作流下拉 */
        st.wfBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            st.wfWrap.classList.toggle('is-open');
            closeOthers(st, 'wf');
        });
        st.wfMenu.addEventListener('click', function (e) {
            var item = e.target.closest && e.target.closest('.xcat-ac-wfitem');
            if (!item) return;
            e.stopPropagation();
            var name = item.getAttribute('data-name');
            var pills = pillsOf(panel);
            for (var i = 0; i < pills.length; i++) {
                if (pills[i].name === name) {
                    st.wfWrap.classList.remove('is-open');
                    pills[i].el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                    window.setTimeout(function () { syncValues(st, true); }, 60);
                    return;
                }
            }
        });

        /* 设置浮层 */
        st.gear.addEventListener('click', function (e) {
            e.stopPropagation();
            var on = !st.pop.classList.contains('is-open');
            st.pop.classList.toggle('is-open', on);
            st.gear.classList.toggle('is-open', on);
            if (on) {
                closeOthers(st, 'pop');
                syncValues(st, true);
            }
        });
        st.pop.addEventListener('click', function (e) { e.stopPropagation(); });

        /* 设置项 → 影子字段控件 */
        st.rows.forEach(function (item) {
            var field = item.field;
            if (item.seedInput) {
                item.seedInput.addEventListener('input', function () {
                    var src = field.ctrl.querySelector('input');
                    if (src && src.readOnly) return;
                    writeText(src, item.seedInput.value);
                });
                item.dice.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var btn = field.ctrl.querySelector('.panel-dice');
                    if (btn) btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                    window.setTimeout(function () { syncValues(st, true); }, 40);
                });
            } else if (item.fmtSel) {
                item.fmtSel.addEventListener('change', function () {
                    refreshQuality(item);
                    writeSelect(item.srcSelect, combined(item));
                });
                item.qSel.addEventListener('change', function () {
                    writeSelect(item.srcSelect, combined(item));
                });
            } else if (item.check) {
                item.check.addEventListener('change', function () {
                    var src = field.ctrl.querySelector('input[type=checkbox]');
                    if (!src) return;
                    if (src.checked !== item.check.checked) {
                        src.checked = item.check.checked;
                        fire(src, 'change');
                    }
                });
            } else if (item.numInput) {
                item.numInput.addEventListener('input', function () {
                    writeText(field.ctrl, item.numInput.value);
                });
            }
        });

        /* 运行按钮 → 影子运行按钮 */
        st.run.addEventListener('click', function (e) {
            e.stopPropagation();
            var btn = panel.querySelector(':scope > .panel-row > .panel-run');
            if (btn && !btn.disabled) btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        });
    }

    function refreshQuality (item) {
        var fmt = item.fmtSel.value;
        var list = item.split.byFormat[fmt] || [];
        item.qSel.innerHTML = '';
        list.forEach(function (q) {
            var opt = el('option', '', q);
            opt.value = q;
            item.qSel.appendChild(opt);
        });
        item.qSel.style.display = list.length ? '' : 'none';
    }

    function combined (item) {
        var fmt = item.fmtSel.value;
        var q = item.qSel.value;
        return q ? fmt + ':' + q : fmt;
    }

    function closeOthers (st, keep) {
        if (keep !== 'wf') st.wfWrap.classList.remove('is-open');
        if (keep !== 'pop') {
            st.pop.classList.remove('is-open');
            st.gear.classList.remove('is-open');
        }
    }

    /* ------------------------------------------------------------ 值同步 */

    function setText (target, value) {
        if (!target) return;
        if (document.activeElement === target) return;
        var text = String(value == null ? '' : value);
        if (target.value !== text) target.value = text;
    }

    function syncValues (st, force) {
        var panel = st.panel;
        if (!panel || !panel.isConnected || !st.root) return;

        setText(st.styleText, st.styleSrc ? st.styleSrc.value : '');
        if (st.lyricsText) setText(st.lyricsText, st.lyricsSrc ? st.lyricsSrc.value : '');

        /* 音乐 / 语音 */
        var node = nodeOf(panel);
        var mode = (node && node.data && node.data.audioMode) === 'voice' ? 'voice' : 'music';
        st.musicBtn.classList.toggle('is-on', mode === 'music');
        st.voiceBtn.classList.toggle('is-on', mode === 'voice');

        /* 工作流按钮 + 下拉 */
        var pills = pillsOf(panel);
        var active = null;
        for (var i = 0; i < pills.length; i++) if (pills[i].active) active = pills[i];
        var display = active ? shortName(active.name, active.group) : '';
        if (st.wfName.textContent !== (display || '选择工作流')) {
            st.wfName.textContent = display || '选择工作流';
            st.wfBtn.title = active ? active.name : '';
            st.wfBtn.classList.toggle('is-empty', !active);
        }
        var menuSig = JSON.stringify(pills.map(function (p) { return [p.name, p.group, p.active] }));
        if (force || menuSig !== st.menuSig) {
            st.menuSig = menuSig;
            st.wfMenu.innerHTML = '';
            pills.forEach(function (p) {
                var item = el('button', 'xcat-ac-wfitem' + (p.active ? ' is-active' : ''), shortName(p.name, p.group));
                item.type = 'button';
                item.setAttribute('data-name', p.name);
                item.title = p.name;
                st.wfMenu.appendChild(item);
            });
        }

        /* 运行按钮 */
        var runSrc = panel.querySelector(':scope > .panel-row > .panel-run');
        if (runSrc) {
            var text = (runSrc.textContent || '').trim() || '运行';
            if (st.run.textContent !== text) st.run.textContent = text;
            if (st.run.disabled !== runSrc.disabled) st.run.disabled = runSrc.disabled;
            st.run.classList.toggle('is-stop', runSrc.classList.contains('is-stop'));
        }

        /* 设置项 */
        st.rows.forEach(function (item) {
            var field = item.field;
            if (!field.ctrl) return;
            if (item.seedInput) {
                var seedSrc = field.ctrl.querySelector('input');
                var dice = field.ctrl.querySelector('.panel-dice');
                var on = !!(dice && dice.classList.contains('is-on'));
                setText(item.seedInput, seedSrc ? seedSrc.value : '');
                if (item.seedInput.readOnly !== !!(seedSrc && seedSrc.readOnly)) {
                    item.seedInput.readOnly = !!(seedSrc && seedSrc.readOnly);
                }
                item.seedInput.classList.toggle('is-random', on);
                item.dice.classList.toggle('is-on', on);
                item.dice.title = on ? '每次运行自动刷新（点击恢复固定值）' : '点击后每次运行随机刷新';
            } else if (item.fmtSel) {
                var src = item.srcSelect;
                var value = (src && src.value) || '';
                var at = value.indexOf(':');
                var fmt = at < 0 ? value : value.slice(0, at);
                var q = at < 0 ? '' : value.slice(at + 1);
                if (item.fmtSel.value !== fmt) item.fmtSel.value = fmt;
                var list = item.split.byFormat[item.fmtSel.value] || [];
                var now = [];
                for (var qi = 0; qi < item.qSel.options.length; qi++) now.push(item.qSel.options[qi].value);
                if (now.join('|') !== list.join('|')) refreshQuality(item);
                if (q) {
                    if (item.qSel.value !== q) item.qSel.value = q;
                } else if (list.length && !item.qSel.value) {
                    item.qSel.value = list[0];
                }
                item.qSel.style.display = list.length ? '' : 'none';
            } else if (item.check) {
                var sw = field.ctrl.querySelector('input[type=checkbox]');
                if (sw && item.check.checked !== sw.checked) item.check.checked = sw.checked;
            } else if (item.numInput) {
                setText(item.numInput, field.ctrl.value);
            }
        });
    }

    function shortName (name, group) {
        if (group && name.indexOf(group + '-') === 0) return name.slice(group.length + 1);
        return name;
    }

    /* ------------------------------------------------------------ 调度 */

    var states = new WeakMap();

    function ensure (panel) {
        var role = roleOf(panel);
        var st = states.get(panel);
        if (role !== 'gen-audio') {
            if (st && st.root && st.root.parentNode) st.root.parentNode.removeChild(st.root);
            panel.classList.remove(PANEL_CLS);
            states.delete(panel);
            return;
        }
        panel.classList.add(PANEL_CLS);
        if (!st) {
            st = { panel: panel, root: null, sig: '' };
            states.set(panel, st);
        }
        var fields = fieldsOf(panel);
        var sig = signature(panel, fields);
        var focused = st.root && st.root.contains(document.activeElement);
        if (!st.root || !st.root.parentNode || (!focused && sig !== st.sig)) {
            if (!focused) build(panel, st);
            else return;
        }
        syncValues(st, false);
    }

    var pending = false;
    function schedule () {
        if (pending) return;
        pending = true;
        window.setTimeout(function () {
            pending = false;
            var list = document.querySelectorAll('#app .node-panel');
            for (var i = 0; i < list.length; i++) {
                try { ensure(list[i]) } catch (e) { /* 单个面板出错不影响其它 */ }
            }
        }, 0);
    }

    function observe () {
        var host = document.querySelector('#app .vue-flow') || document.querySelector('.vue-flow');
        if (!host) { window.setTimeout(observe, 300); return; }
        /* 只盯 DOM 增删（自己挂的类会触发 attributes，监听会自激）；
           值的变化不产生 mutation，另用 400ms 轮询兜住切工作流 / 种子刷新 */
        new MutationObserver(schedule).observe(host, { childList: true, subtree: true });
        window.setInterval(schedule, 400);
        schedule();
    }

    document.addEventListener('click', function (e) {
        var target = e.target;
        document.querySelectorAll('#app .' + PANEL_CLS).forEach(function (panel) {
            var st = states.get(panel);
            if (!st) return;
            if (st.wfWrap.contains(target) || st.setWrap.contains(target)) return;
            st.wfWrap.classList.remove('is-open');
            st.pop.classList.remove('is-open');
            st.gear.classList.remove('is-open');
        });
    }, true);

    observe();
})();
