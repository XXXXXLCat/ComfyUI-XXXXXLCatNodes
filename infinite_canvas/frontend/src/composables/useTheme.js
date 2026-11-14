import { computed, ref } from "vue";

const STORAGE_KEY = "infinite-canvas-theme";
const THEMES = ["dark", "light"];

function readStoredTheme() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return THEMES.includes(stored) ? stored : "dark";
  } catch {
    return "dark";
  }
}

// 模块级单例：所有组件拿到的都是同一份主题状态
const theme = ref(readStoredTheme());
const isLight = computed(() => theme.value === "light");

function applyTheme(value) {
  if (typeof document !== "undefined") {
    // 只改本页 documentElement，iframe 里不会影响父页面
    document.documentElement.dataset.theme = value;
  }
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // 隐私模式等写不了 localStorage 的场景忽略即可
  }
}

function setTheme(value) {
  const next = THEMES.includes(value) ? value : "dark";
  theme.value = next;
  applyTheme(next);
}

function toggleTheme() {
  setTheme(theme.value === "dark" ? "light" : "dark");
}

// 初始化时立即应用一次，刷新后不会闪回旧主题
applyTheme(theme.value);

// 画布网格颜色跟随主题（供 Vue Flow Background 使用）
const canvasGridColor = computed(() => (theme.value === "light" ? "#d9d9e1" : "#2a2a33"));

export function useTheme() {
  return { theme, isLight, setTheme, toggleTheme, canvasGridColor };
}
