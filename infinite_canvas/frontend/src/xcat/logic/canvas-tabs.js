/**
 * #21 / 02 块真源：画布标签页与持久化核心。
 *
 * 这段逻辑以「构建期纯文本注入」的方式落在主 chunk 顶层。历史调用点有两处：
 *   - #20 片段里的 `window.xcatPick = xcatPick` / `window.xcatAdd = xcatAdd`
 *   - #21 / 04 块的 tab 栏 render：`xcatWheel` / `xcatAdd` / `xcatPick`
 * 它们都按「无参顶层函数名」引用，因此 canvas-tabs-bridge.js 会生成一层
 * 薄适配，把 store / busy 这两个模块内的压缩别名补齐，函数名保持不变。
 *
 * 本模块只有函数声明，没有模块级 const/let 运行时状态：#21 的 04 块末尾
 * 会执行 `mount("#app")`，晚于注入文本中任何顶层语句都可能踩到 TDZ。
 *
 * store 契约（由上游 useCanvas 提供，对应压缩别名 qt）：
 *   list / currentId / dirty       : ref
 *   saveNow / refresh / open / create / rename / saveAsNew / resetToUnsaved
 *   bootstrap                      : 可覆写的启动钩子
 */
export async function xcatFlushImpl(store) {
  if (store.dirty.value) await store.saveNow();
}

export async function xcatPickImpl(store, busy, id) {
  if (busy.value) return;
  if (id === "") {
    if (store.currentId.value === "") return;
    busy.value = true;
    try {
      await xcatFlushImpl(store);
      store.resetToUnsaved();
    } catch (e) {
      // 与历史实现一致：切换失败不抛出，只把 busy 复位。
    } finally {
      busy.value = false;
    }
    return;
  }
  if (id === store.currentId.value) return;
  busy.value = true;
  try {
    await xcatFlushImpl(store);
    await store.open(id);
  } catch (e) {
    // 同上。
  } finally {
    busy.value = false;
  }
}

export async function xcatAddImpl(store, busy) {
  if (busy.value) return;
  busy.value = true;
  try {
    await xcatFlushImpl(store);
    if (store.currentId.value === "") {
      const saved = await store.saveAsNew("Unsaved Canvas");
      if (saved && saved.id) window.__xcatAddTab(saved.id);
    }
    await store.create();
  } catch (e) {
    // 同上。
  } finally {
    busy.value = false;
  }
}

/** 纵向滚轮换算成 tab 条横向滚动；Ctrl/⌘ 缩放与横向手势让给上游。 */
export function xcatWheelImpl(ev) {
  if (ev.ctrlKey || ev.metaKey) return;
  if (Math.abs(ev.deltaX) >= Math.abs(ev.deltaY)) return;
  const box = ev.currentTarget;
  ev.preventDefault();
  const unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? box.clientWidth : 1;
  box.scrollBy({ left: ev.deltaY * unit });
}

/** Ctrl+S：已命名画布直接保存；未命名画布交给官方「保存画布」Dialog 取名。 */
export function xcatSaveCurrentImpl(store, showSaveDialog) {
  try {
    const cid = store.currentId.value;
    const cur = cid ? store.list.value.find((g) => g.id === cid) : null;
    if (cur && (cur.name || "").indexOf("Unsaved Canvas") !== 0) {
      store.saveNow();
      return;
    }
    const prefill = cur ? cur.name || "Unsaved Canvas" : "Unsaved Canvas";
    showSaveDialog(prefill, async (name) => {
      name = (name || "").trim();
      if (!name) return;
      // 用户仍保留默认名时，换成不冲突的「未命名画布 (n)」。
      if (name.indexOf("Unsaved Canvas") === 0) {
        const base = "未命名画布";
        const used = {};
        store.list.value.forEach((g) => {
          used[(g && g.name) || ""] = 1;
        });
        let candidate = base;
        let n = 2;
        while (used[candidate]) {
          candidate = base + " (" + n + ")";
          n += 1;
        }
        name = candidate;
      }
      if (cur) {
        store.rename(cur.id, name);
      } else {
        const saved = await store.saveAsNew(name);
        if (saved && saved.id) window.__xcatAddTab(saved.id);
      }
    });
  } catch (e) {
    // 历史实现整体包了 try/catch，保存失败不打断画布。
  }
}

/**
 * 接管启动时打开的画布：优先恢复 localStorage 里记住的那张，其次第一张，
 * 都没有就回到未保存画布。openTabs 里恒保留一个 "" 代表未保存画布。
 */
export function xcatTabsBootstrap(store) {
  return (async () => {
    await store.refresh();
    let ids = window.__xcatOpenTabs.value.slice();
    if (ids.indexOf("") < 0) ids = [""].concat(ids);
    let last = "";
    try {
      last = window.localStorage.getItem("infinite-canvas:last") || "";
    } catch (e) {
      last = "";
    }
    if (last && store.list.value.some((g) => g.id === last)) {
      if (ids.indexOf(last) < 0) ids.push(last);
      window.__xcatOpenTabs.value = ids;
      await store.open(last);
    } else if (store.list.value.length) {
      const first = store.list.value[0].id;
      if (ids.indexOf(first) < 0) ids.push(first);
      window.__xcatOpenTabs.value = ids;
      await store.open(first);
    } else {
      window.__xcatOpenTabs.value = ids;
      store.resetToUnsaved();
    }
  })();
}

export function installCanvasTabs(store, saveCurrent) {
  // 历史实现保留了原 bootstrap 引用（未使用），这里留着以免行为差异。
  const originalBootstrap = store.bootstrap;
  void originalBootstrap;
  store.bootstrap = () => xcatTabsBootstrap(store);
  window.addEventListener(
    "keydown",
    (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        saveCurrent();
      }
    },
    true
  );
}
