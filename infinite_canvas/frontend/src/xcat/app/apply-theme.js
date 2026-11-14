// 挂载前先应用主题，避免刷新时闪一下默认暗色。
//
// 独立成模块的原因：ES 模块的 import 声明会被提升，若把 useTheme() 直接写在
// main.js 顶层，它会在所有 import 求值完之后才执行 —— 那时 canvas-app.js
// 已经 mount("#app") 了。放在单独的副作用模块里，靠 main.js 的 import 书写
// 顺序保证它先于应用主体执行。
import { useTheme } from "../../composables/useTheme.js";

useTheme();
