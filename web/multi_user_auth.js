// ComfyUI-XXXXXLCatNodes — multi-user password login overlay.
//
// Shown only when the server has password auth enabled (--multi-user + this
// node's auth module). On a successful login the server sets an HttpOnly
// session cookie that the browser automatically attaches to every later
// fetch/WebSocket, so no per-call token plumbing is needed here. A 404 on
// /xcat/auth_status means auth is disabled (single-user or module off) and the
// overlay stays hidden.

import { pick } from "./i18n.js";

(function () {
  "use strict";

  const OVERLAY_ID = "xcat-login-overlay";

  function h(tag, props, children) {
    const e = document.createElement(tag);
    if (props) {
      for (const k in props) {
        if (k === "style") Object.assign(e.style, props[k]);
        else if (k === "text") e.textContent = props[k];
        else if (k.startsWith("on") && typeof props[k] === "function")
          e.addEventListener(k.slice(2), props[k]);
        else e.setAttribute(k, props[k]);
      }
    }
    (children || []).forEach((c) => e.appendChild(typeof c === "string" ? document.createTextNode(c) : c));
    return e;
  }

  function buildOverlay() {
    if (document.getElementById(OVERLAY_ID)) return;

    const userInput = h("input", {
      type: "text", autocomplete: "username", placeholder: pick({ zh: "用户名", en: "Username" }), id: "xcat-user",
      style: inputStyle(),
    });
    const passInput = h("input", {
      type: "password", autocomplete: "current-password", placeholder: pick({ zh: "密码", en: "Password" }), id: "xcat-pass",
      style: inputStyle(),
    });
    const newPassInput = h("input", {
      type: "password", autocomplete: "new-password", placeholder: pick({ zh: "设置密码", en: "New password" }), id: "xcat-newpass",
      style: Object.assign(inputStyle(), { display: "none" }),
    });
    const errBox = h("div", {
      style: { color: "#ff8080", fontSize: "12px", minHeight: "16px", marginTop: "4px" },
    });
    const SIGN_IN = { zh: "登录", en: "Sign in" };
    const CREATE = { zh: "新建账号", en: "Create account" };
    const submitBtn = h("button", { type: "submit", style: btnStyle() }, pick(SIGN_IN));
    const toggle = h("button", {
      type: "button", style: linkStyle(),
      onclick: () => switchMode(mode === "login" ? "register" : "login"),
    }, pick(CREATE));

    let mode = "login";
    function switchMode(m) {
      mode = m;
      newPassInput.style.display = m === "register" ? "" : "none";
      submitBtn.textContent = pick(m === "register" ? { zh: "注册并登录", en: "Sign up & sign in" } : SIGN_IN);
      toggle.textContent = pick(m === "register" ? { zh: "返回登录", en: "Back to sign in" } : CREATE);
      errBox.textContent = "";
    }

    const form = h("form", {
      style: { display: "flex", flexDirection: "column", gap: "10px" },
      onsubmit: async (ev) => {
        ev.preventDefault();
        errBox.textContent = "";
        submitBtn.disabled = true;
        const username = userInput.value.trim();
        const password = passInput.value;
        try {
          if (mode === "register") {
            const rp = await fetch("/xcat/register", post({ username, password: newPassInput.value }));
            if (!rp.ok) {
              errBox.textContent =
                (await rp.json().catch(() => ({}))).error || pick({ zh: "注册失败", en: "Sign-up failed" });
              return;
            }
          }
          const lp = await fetch("/xcat/login", post({ username, password }));
          if (!lp.ok) {
            errBox.textContent =
              (await lp.json().catch(() => ({}))).error || pick({ zh: "登录失败", en: "Sign-in failed" });
            return;
          }
          const j = await lp.json();
          // Match what the official userStore expects, so the app goes straight
          // to the canvas instead of bouncing to /user-select.
          try {
            localStorage["Comfy.userId"] = j.user_id;
            localStorage["Comfy.userName"] = j.username || username;
            localStorage["Comfy-User"] = j.user_id;
          } catch (e) {}
          location.reload();
        } catch (e) {
          errBox.textContent = pick({ zh: "网络错误，请重试", en: "Network error — please retry" });
        } finally {
          submitBtn.disabled = false;
        }
      },
    }, [userInput, passInput, newPassInput, errBox, submitBtn]);

    const card = h("div", {
      style: {
        background: "#1e1e1e", color: "#ffffff", padding: "28px 26px", borderRadius: "10px",
        width: "320px", boxShadow: "0 10px 40px rgba(0,0,0,0.5)",
        border: "1px solid #333", fontFamily: "inherit",
      },
    }, [
      h("div", {
        style: { fontSize: "16px", fontWeight: "600", marginBottom: "4px" },
        text: pick({ zh: "🐈‍⬛ 多用户登录", en: "🐈‍⬛ Multi-user sign-in" }),
      }),
      h("div", {
        style: { fontSize: "12px", color: "#aaaaaa", marginBottom: "18px" },
        text: pick({ zh: "请输入该账号的用户名和密码", en: "Enter this account's username and password" }),
      }),
      form,
      h("div", { style: { marginTop: "14px", textAlign: "center" } }, [toggle]),
    ]);

    const overlay = h("div", {
      id: OVERLAY_ID,
      style: {
        position: "fixed", inset: "0", zIndex: "99999", display: "flex",
        alignItems: "center", justifyContent: "center",
        background: "rgba(0,0,0,0.65)", fontFamily: "system-ui, sans-serif",
      },
    }, [card]);

    // Click outside the card does nothing (must authenticate).
    document.body.appendChild(overlay);
    setTimeout(() => userInput.focus(), 50);
  }

  function inputStyle() {
    return {
      background: "#2a2a2a", color: "#ffffff", border: "1px solid #3a3a3a",
      borderRadius: "6px", padding: "9px 11px", fontSize: "14px", outline: "none",
      width: "100%", boxSizing: "border-box",
    };
  }
  function btnStyle() {
    return {
      background: "#4a4a4a", color: "#ffffff", border: "1px solid #5a5a5a",
      borderRadius: "6px", padding: "10px", fontSize: "14px", cursor: "pointer",
    };
  }
  function linkStyle() {
    return {
      background: "transparent", color: "#9a9a9a", border: "none",
      fontSize: "12px", cursor: "pointer", textDecoration: "underline",
    };
  }
  function post(body) {
    return {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    };
  }

  async function maybeShowOverlay() {
    let status = "need";
    try {
      const r = await fetch("/xcat/auth_status", { credentials: "same-origin" });
      if (r.status === 404) status = "disabled";        // auth module not active
      else if (r.ok) status = (await r.json()).authenticated ? "ok" : "need";
      else status = "need";
    } catch (e) {
      status = "need";
    }
    if (status === "need") buildOverlay();
  }

  // The frontend's sign-out button only clears localStorage and reloads
  // (SidebarLogoutIcon.vue -> userStore.logout() -> location.reload()). Our
  // session cookie would survive that, so the page would come back signed in as
  // the previous user — and the stock "user select" screen, fed by /users, would
  // let anyone hop to another account without a password. Treat a missing or
  // mismatched localStorage identity as a real sign-out.
  async function guardIdentity() {
    let j;
    try {
      const r = await fetch("/xcat/auth_status", { credentials: "same-origin" });
      if (!r.ok) return false;                          // 404 => auth disabled
      j = await r.json();
    } catch (e) {
      return false;
    }
    if (!j || !j.authenticated) return false;

    let local = null;
    try { local = localStorage["Comfy.userId"]; } catch (e) {}
    if (local === j.user_id) return false;

    await signOut();
    return true;
  }

  async function signOut() {
    markSignedOut();
    try {
      await fetch("/xcat/logout", { method: "POST", credentials: "same-origin", keepalive: true });
    } catch (e) {}
    try {
      delete localStorage["Comfy.userId"];
      delete localStorage["Comfy.userName"];
    } catch (e) {}
    // A full navigation (not a reload) makes the server serve the password page
    // again; the app shell must not be reused from cache here.
    location.replace("/");
  }

  // Sign-out marker, written *synchronously* from the click handler. The
  // built-in sign-out clears localStorage and reloads straight away, so an
  // awaited request would race the unload; a cookie assignment cannot. The
  // server treats `xcat_logout=1` as "no session", which is what makes the very
  // next document request come back as the password page instead of the stock
  // "user select" screen (that screen does not even load custom extensions, so
  // nothing in here could redirect it).
  function markSignedOut() {
    try {
      document.cookie = "xcat_logout=1; path=/; max-age=120; samesite=lax";
    } catch (e) {}
  }

  // Drop the cookie the moment the built-in sign-out is clicked, so the next
  // document request is already anonymous and the stock user-select screen
  // never gets a chance to appear. Deliberately narrow: only the sidebar's
  // `pi-sign-out` icon or an exact sign-out label arms it, because a false
  // positive would log the user out unexpectedly.
  function armSignOutHook() {
    document.addEventListener("click", (ev) => {
      const t = ev.target;
      const el = t && t.closest ? t.closest("button, a, [role='button'], .sidebar-item") : null;
      if (!el) return;
      const icon = !!el.querySelector("i.pi-sign-out, .pi-sign-out");
      const label = `${el.title || ""} ${el.getAttribute("aria-label") || ""} ${el.textContent || ""}`
        .trim()
        .toLowerCase();
      const named =
        /^(退出登录|登出|注销|sign out|log ?out)(\s|\(|$)/.test(label) && !/everywhere/.test(label);
      if (!icon && !named) return;
      markSignedOut();
      try {
        fetch("/xcat/logout", { method: "POST", credentials: "same-origin", keepalive: true });
      } catch (e) {}
    }, true);
  }

  async function run() {
    if (document.getElementById(OVERLAY_ID)) return;
    armSignOutHook();
    if (await guardIdentity()) return;                 // navigated to the login page
    if (document.readyState === "loading")
      document.addEventListener("DOMContentLoaded", maybeShowOverlay);
    else maybeShowOverlay();
  }

  // ComfyUI loads this as an extension module; run immediately.
  run().catch(() => {});

  // Also register via the official extension API when present (no-op fallback).
  try {
    import("/scripts/app.js").then((m) => {
      const app = m.app;
      if (app && app.registerExtension) {
        app.registerExtension({ name: "XXXXXLCat.MultiUserAuth" });
      }
    }).catch(() => {});
  } catch (e) {}
})();
