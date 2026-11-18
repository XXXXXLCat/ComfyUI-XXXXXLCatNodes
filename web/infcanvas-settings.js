/* 画布设置面板（可扩展框架）。
 *
 * 侧栏「设置」按钮打开本弹窗。所有设置项都在下面的 SETTINGS 注册表里声明：
 * 以后新增设置只需往 SETTINGS 追加一项，面板会自动渲染，open()/渲染逻辑不用改。
 *
 * 外壳与控件逐字复用宿主 class（DialogOverlay / BaseModalLayout / Switch），
 * 不引入自定义配色或自造样式。设置值存在 localStorage，键名即设置项 id，
 * 与 core.js 的 storageRead/storageWrite 用同一种 JSON 格式，便于 core 侧读取。 */
(() => {
  const NS = (window.InfCanvas = window.InfCanvas || {});
  const t = (key, params) => (NS.i18n ? NS.i18n.t(key, params) : key);

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  };

  /* 与 core.js storageRead/storageWrite 同格式（JSON.stringify / parse）。 */
  const readVal = (id, def) => {
    try {
      const raw = localStorage.getItem(id);
      return raw === null ? def : JSON.parse(raw);
    } catch (error) { return def; }
  };
  const writeVal = (id, value) => {
    try { localStorage.setItem(id, JSON.stringify(value)); } catch (error) { /* storage unavailable */ }
  };

  /* ---- 设置注册表：新增设置往这里加一项即可 ----
     type 目前支持 "switch"；以后加别的类型时，在 renderRows 里加一个分支。 */
  const SETTINGS = [
    {
      id: "InfCanvas.ShowPreviewText",
      type: "switch",
      label: "显示预览文本",
      desc: "生成图片或视频时，一并显示工作流中的预览文本（默认关闭）",
      def: false,
      get: () => readVal("InfCanvas.ShowPreviewText", false),
      set: (value) => writeVal("InfCanvas.ShowPreviewText", value),
    },
    {
      id: "InfCanvas.Setting.AutoSave",
      type: "switch",
      label: "自动保存画布",
      desc: "开启后，画布改动会在下方设定的秒数后自动保存（默认关闭，静默保存不弹提示）",
      def: false,
      get: () => readVal("InfCanvas.Setting.AutoSave", false),
      set: (value) => writeVal("InfCanvas.Setting.AutoSave", value),
    },
    {
      id: "InfCanvas.Setting.AutoSaveDelay",
      type: "number",
      label: "自动保存间隔（秒）",
      desc: "画布停止改动多少秒后自动保存，最小 1 秒",
      def: 3,
      min: 1,
      max: 3600,
      get: () => readVal("InfCanvas.Setting.AutoSaveDelay", 3),
      set: (value) => writeVal("InfCanvas.Setting.AutoSaveDelay", value),
    },
  ];

  let ui = null;

  /* Switch：class 逐字抄自 infcanvas-api-config.js 的布尔字段控件。 */
  function makeSwitch(item) {
    const on = item.get() === true;
    const wrap = el("div", "flex shrink-0 items-center");
    const btn = el("button",
      "group inline-flex h-6 w-10 shrink-0 cursor-pointer touch-manipulation "
      + "items-center justify-center rounded-full border-0 bg-transparent p-0 outline-none "
      + "transition-shadow focus-visible:ring-1 focus-visible:ring-ring");
    btn.type = "button";
    btn.setAttribute("role", "switch");
    btn.setAttribute("aria-label", t(item.label));
    btn.dataset.state = on ? "checked" : "unchecked";
    const track = el("span", "pointer-events-none inline-flex h-5 w-9 items-center rounded-full "
      + "border border-transparent bg-border px-0.5 transition-colors group-data-[state=checked]:bg-primary");
    const knob = el("span", "pointer-events-none block size-4 rounded-full bg-background shadow-sm "
      + "transition-transform data-[state=checked]:translate-x-3.5 data-[state=unchecked]:translate-x-0");
    knob.dataset.state = on ? "checked" : "unchecked";
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      const next = item.get() !== true;
      item.set(next);
      btn.dataset.state = next ? "checked" : "unchecked";
      knob.dataset.state = next ? "checked" : "unchecked";
    });
    track.appendChild(knob);
    btn.appendChild(track);
    wrap.appendChild(btn);
    return wrap;
  }

  /* 数字输入：class 抄宿主 Input（h-9 紧凑版），单位秒作为静态后缀。 */
  function makeNumber(item) {
    const wrap = el("div", "flex shrink-0 items-center gap-1.5");
    const input = el("input", "h-9 w-20 rounded-md border border-input bg-background px-2 text-sm "
      + "text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring");
    input.type = "number";
    input.min = String(item.min ?? 1);
    input.max = String(item.max ?? 3600);
    input.step = "1";
    input.setAttribute("aria-label", t(item.label));
    const current = Number(item.get());
    input.value = String(Number.isFinite(current) && current > 0 ? current : (item.def ?? 3));
    const commit = () => {
      let value = Number.parseInt(input.value, 10);
      if (!Number.isFinite(value)) value = item.def ?? 3;
      value = Math.max(item.min ?? 1, Math.min(item.max ?? 3600, value));
      input.value = String(value);
      item.set(value);
    };
    input.addEventListener("change", commit);
    input.addEventListener("blur", commit);
    wrap.append(input, el("span", "text-sm text-muted-foreground", t("秒")));
    return wrap;
  }

  /* 按 type 分派控件；新增类型时在此加一个分支即可。 */
  function makeControl(item) {
    if (item.type === "number") return makeNumber(item);
    return makeSwitch(item);
  }

  function renderRows(list) {
    const frag = document.createDocumentFragment();
    for (const item of SETTINGS) {
      const row = el("div", "flex items-center gap-4 border-b border-border/50 px-5 py-4 last:border-b-0");
      const text = el("div", "min-w-0 flex-1");
      text.appendChild(el("div", "text-sm font-medium text-foreground", t(item.label)));
      text.appendChild(el("div", "mt-1 text-xs leading-relaxed text-muted-foreground", t(item.desc)));
      row.append(text, makeControl(item));
      frag.appendChild(row);
    }
    list.replaceChildren(frag);
  }

  function open() {
    close();
    const host = document.getElementById("infcanvas-root") || document.body;
    const mask = el("div", "fixed inset-0 flex items-center justify-center bg-black/70 p-6");
    mask.style.zIndex = "9999";
    const panel = el("div", "relative flex w-[460px] max-w-[92vw] flex-col overflow-hidden rounded-2xl border bg-background shadow-lg");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", t("画布设置"));
    mask.appendChild(panel);

    const header = el("div", "flex h-14 shrink-0 items-center justify-between border-b px-5");
    header.appendChild(el("div", "text-base font-semibold text-foreground", t("画布设置")));
    const closeBtn = el("button", "flex size-8 cursor-pointer items-center justify-center rounded-lg "
      + "border-none bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground");
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", t("关闭"));
    closeBtn.appendChild(el("i", "pi pi-times"));
    closeBtn.addEventListener("click", (event) => { event.stopPropagation(); close(); });
    header.appendChild(closeBtn);
    panel.appendChild(header);

    const body = el("div", "scrollbar-custom min-h-0 overflow-y-auto");
    renderRows(body);
    panel.appendChild(body);

    const onKey = (event) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      close();
    };
    document.addEventListener("keydown", onKey, true);
    mask.addEventListener("pointerdown", (event) => { if (event.target === mask) close(); });

    host.appendChild(mask);
    ui = {
      mask,
      close() {
        document.removeEventListener("keydown", onKey, true);
        mask.remove();
        ui = null;
      },
    };
  }

  function close() { ui?.close?.(); }

  NS.settings = {
    open, close,
    isOpen: () => !!ui?.mask?.isConnected,
    /* 暴露注册表，core 侧/其他模块若需读取默认值可引用。 */
    SETTINGS,
  };
})();
