/* ==========================================================================
 * 生成节点面板：唯一文本字段与主提示词左右并排
 * --------------------------------------------------------------------------
 * 生成节点的面板结构由上游决定，固定是「主提示词（第一条 textarea 字段）
 * 独占一行 → 其余字段一行 → 运行按钮一行」。文生音乐这类工作流只有两个
 * 文本字段（风格提示词 + 歌词），上下堆叠会让提示词区白白占掉半屏高度，
 * 歌词又被压成 200×60 的小框。
 *
 * 这里只做「布局重排」，不碰数据也不碰 Vue 的渲染结构：
 *   命中条件 —— 面板有主提示词，字段列表的第一项是文本字段（textarea /
 *   宽输入框），且其余字段里没有第二个文本字段。
 *   命中后给 .node-panel 挂 .xcat-panel-split，由 xcat-overrides.css 用
 *   grid 把「主提示词」与「第一个字段」放到同一行的左右两列。
 *
 * 为什么用 JS 挂类而不是纯 :has()：条件里要表达「其余字段没有文本字段」，
 * :has(:not(...)) 的组合既难读又需要把长选择器复制到每条规则上；挂个类
 * 之后 CSS 只用一条短前缀。
 *
 * 刷新用 MutationObserver（面板是 v-if 渲染的，切换工作流 / 选中节点都会
 * 重建子树）；不用 rAF —— 页面不可见时 rAF 会被浏览器暂停。
 * ========================================================================== */
(function () {
    'use strict';
    if (window.__xcatPanelSplitInstalled) return;
    window.__xcatPanelSplitInstalled = true;

    var CLS = 'xcat-panel-split';
    /* 主提示词框自己不带标题（上游只用 placeholder），并排后右侧字段有「歌词」
       小标题、左侧没有会让两列上边缘错开一行，这里补一个同名标签 */
    var PROMPT_LABEL = '提示词';
    var LABEL_ATTR = 'data-xcat-label';

    /* 字段里的文本控件：textarea 或 text 类型的宽输入框 */
    function isTextField(field) {
        return !!field.querySelector(':scope > textarea.panel-text, :scope > input.panel-input-wide');
    }

    function fieldKids(fields) {
        var out = [];
        for (var i = 0; i < fields.children.length; i++) {
            var el = fields.children[i];
            if (el.classList && el.classList.contains('panel-field')) out.push(el);
        }
        return out;
    }

    function sync(panel) {
    /* 由 shadcn-vue 面板整体接管的节点（音频 .xcat-audio / 通用 .xcat-np）
       自己负责两列布局，这里让路，避免给隐藏的影子控件再挂并排类。 */
    if (panel.classList.contains('xcat-audio') || panel.classList.contains('xcat-np')) {
        if (panel.classList.contains(CLS)) panel.classList.remove(CLS);
        return;
    }
        var on = false;
        var prompt = panel.querySelector(':scope > .panel-prompt');
        var fields = panel.querySelector(':scope > .panel-fields');
        if (prompt && fields) {
            var kids = fieldKids(fields);
            if (kids.length && isTextField(kids[0])) {
                on = true;
                for (var i = 1; i < kids.length; i++) {
                    if (isTextField(kids[i])) { on = false; break; }
                }
            }
        }
        if (on !== panel.classList.contains(CLS)) panel.classList.toggle(CLS, on);
        if (on && prompt && prompt.getAttribute(LABEL_ATTR) !== PROMPT_LABEL) {
            prompt.setAttribute(LABEL_ATTR, PROMPT_LABEL);
        }
    }

    function scan() {
        var list = document.querySelectorAll('#app .node-panel');
        for (var i = 0; i < list.length; i++) sync(list[i]);
    }

    var pending = false;
    function schedule() {
        if (pending) return;
        pending = true;
        window.setTimeout(function () { pending = false; scan(); }, 0);
    }

    function observe() {
        var host = document.querySelector('#app .vue-flow') || document.querySelector('.vue-flow');
        if (!host) { window.setTimeout(observe, 300); return; }
        /* 只盯 DOM 增删：自己写的 class 会触发 attributes，别监听（否则自激） */
        var mo = new MutationObserver(schedule);
        mo.observe(host, { childList: true, subtree: true });
        schedule();
    }

    observe();
})();
