import { reactive } from "vue";

// 自动收集 components/dialogs 下的弹窗组件，新增文件即可出现在菜单里
const modules = import.meta.glob("../components/dialogs/*.vue", { eager: true });

const state = reactive({});

export const dialogs = Object.entries(modules)
  .map(([path, mod]) => {
    const file = path.split("/").pop().replace(/\.vue$/, "");
    const meta = mod.meta || {};
    return {
      key: meta.key || file,
      title: meta.title || file,
      order: meta.order ?? 100,
      component: mod.default,
    };
  })
  .sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));

for (const dialog of dialogs) {
  state[dialog.key] = false;
}

export function isDialogOpen(key) {
  return !!state[key];
}

export function openDialog(key) {
  for (const name of Object.keys(state)) {
    state[name] = name === key;
  }
}

export function closeDialog(key) {
  state[key] = false;
}

export function closeAllDialogs() {
  for (const name of Object.keys(state)) {
    state[name] = false;
  }
}
