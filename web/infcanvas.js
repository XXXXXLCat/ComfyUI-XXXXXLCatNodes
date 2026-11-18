/* Extension entry point. Registers menu commands/keybindings and boots the UI. */
import { app } from "../../scripts/app.js";

// Share the exact same namespace object with the other modules, regardless
// of the order in which ComfyUI loads the files in WEB_DIRECTORY.
const NS = (window.InfCanvas = window.InfCanvas || {});
/* Lazy i18n reference: extension labels are resolved once at registration.
   Internal canvas UI switches live via NS.i18n; host menu text is fixed at
   startup (ComfyUI does not re-render command labels on demand). */
const t = (key, params) => (NS.i18n ? NS.i18n.t(key, params) : key);

const toggleCanvas = () => (NS.api?.isActive?.() ? NS.api.exit() : NS.api?.enter());

app.registerExtension({
  name: "InfCanvas.EmbeddedCanvas",

  commands: [
    {
      id: "InfCanvas.Open",
      label: "打开 / 退出无限画布",
      icon: "pi pi-th-large",
      function: toggleCanvas,
    },
    {
      id: "InfCanvas.Save",
      label: "保存当前画布",
      icon: "pi pi-save",
      function: () => NS.api?.saveActive(false),
    },
    {
      id: "InfCanvas.CloseTab",
      label: "关闭当前画布标签",
      icon: "pi pi-times",
      function: () => {
        const id = NS.api?.activeId?.();
        if (id) NS.api.closeDoc(id);
      },
    },
  ],

  menuCommands: [
    { path: ["View"], commands: ["InfCanvas.Open", "InfCanvas.Save", "InfCanvas.CloseTab"] },
  ],

  keybindings: [
    { commandId: "InfCanvas.Open", combo: { key: "i", ctrl: true, shift: true } },
  ],

  settings: [
    {
      id: "InfCanvas.AutoSave",
      name: "自动保存画布",
      type: "boolean",
      defaultValue: true,
      tooltip: "画布变更后约 3 秒自动保存",
    },
  ],

  async setup() {
    // ComfyUI imports all extension JS files in parallel / with a late-loading
    // deadline, so core/ui/style may arrive after this module. Keep the app
    // reference around; core.js calls init() itself once everything is ready.
    NS.pendingApp = app;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (NS.ready) return;
      if (NS.api?.init && NS.ui?.injectStyles && NS.css) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!NS.api?.init || !NS.ui?.injectStyles || !NS.css) {
      console.warn("[InfCanvas] core modules not ready yet; waiting for their on-load init");
      return;
    }
    NS.api.init(app);
  },
});
