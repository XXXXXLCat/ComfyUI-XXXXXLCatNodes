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

  function run() {
    if (document.getElementById(OVERLAY_ID)) return;
    if (document.readyState === "loading")
      document.addEventListener("DOMContentLoaded", maybeShowOverlay);
    else maybeShowOverlay();
  }

  // ComfyUI loads this as an extension module; run immediately.
  run();

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
