"""Per-user password authentication for ComfyUI ``--multi-user`` mode.

ComfyUI's built-in multi-user support only distinguishes users by the
``comfy-user`` request header, whose value is a UUID stored in
``user/<...>/users.json``. There is **no password**: anyone who knows (or can
guess / enumerate) a user id can act as that user. This module closes that gap
by adding a real password gate on top of the existing multi-user plumbing.

Design
------
* **Passwords** are stored hashed (PBKDF2-HMAC-SHA256, salted) in a companion
  file ``user_passwords.json`` next to ``users.json`` in the user directory.
* **Sessions** are stateless HMAC-signed tokens carried in an ``HttpOnly``
  cookie named ``xcat_token``. Because the cookie is set on the ComfyUI origin,
  the browser automatically attaches it to every same-origin ``fetch`` *and*
  WebSocket handshake — so no fragile frontend patching of the API client is
  needed. A ``?xcat_token=`` query fallback is also honoured (useful for WS in
  edge cases) and ``Authorization: Bearer`` is accepted too.
* **Endpoints** (all under ``/xcat/``):
    * ``POST /xcat/register``  create an account *with* a password.
    * ``POST /xcat/login``     username + password -> sets the cookie.
    * ``POST /xcat/set_password``  change the caller's own password.
    * ``POST /xcat/admin/set_password``  bootstrap any account (needs the
      optional ``admin_password`` from ``auth_config.json``).
    * ``GET  /xcat/auth_status``  is the current request authenticated?
    * ``POST /xcat/logout``    clears the cookie.
* **Middleware** rejects every non-public request that lacks a valid cookie.
  Public routes are limited to the login/status/logout/register endpoints, the
  frontend static assets, and ``OPTIONS`` preflight — everything else (``/prompt``,
  ``/view``, ``/history``, ``/ws``, ``/users`` reads, ...) requires a session.

The validated user id is published through the ``_XAUTH_USER`` contextvar so the
sibling ``multi_user_assets`` module isolates ``input/`` & ``output/`` for the
*authenticated* user rather than trusting the (spoofable) ``comfy-user`` header.

Everything is installed only when ``--multi-user`` is enabled; a normal
single-user launch is completely unaffected. Every patch degrades to the
official behaviour if a future ComfyUI version moves a patched symbol.
"""

from __future__ import annotations

import base64
import contextvars
import hashlib
import hmac
import json
import os
import secrets
import time
from typing import Optional

from aiohttp import web

logger = None  # set lazily to avoid import cost when disabled

# Carries the *authenticated* user id for the current request.
_XAUTH_USER = contextvars.ContextVar("xcat_auth_user", default=None)

# Idempotency guards.
_INSTALLED = False
_MIDDLEWARE_DONE = False
_ROUTES_DONE = False

# Default session lifetime (30 days) — overridable via auth_config.json.
_DEFAULT_TTL = 30 * 24 * 3600

# Static asset extensions that may be served without a session (the app shell,
# custom-node web bundles, locales, etc.). Anything with a real API path and no
# extension stays protected.
_STATIC_EXT = {
    ".js", ".css", ".html", ".htm", ".svg", ".ico", ".woff", ".woff2",
    ".ttf", ".eot", ".map", ".json", ".png", ".jpg", ".jpeg", ".gif",
    ".webp", ".bmp",
}


# ---------------------------------------------------------------- helpers

def _log() -> "object":
    global logger
    if logger is None:
        import logging
        logger = logging.getLogger("XXXXXLCat.multi_user_auth")
    return logger


def _enabled() -> bool:
    try:
        from comfy.cli_args import args
    except Exception:
        return False
    return bool(getattr(args, "multi_user", False))


def _user_dir() -> str:
    import folder_paths
    return folder_paths.get_user_directory()


def _pw_path() -> str:
    return os.path.join(_user_dir(), "user_passwords.json")


def _secret_path() -> str:
    return os.path.join(_user_dir(), ".xcat_auth_secret")


def _config_path() -> str:
    return os.path.join(_user_dir(), "auth_config.json")


def _load_secret() -> bytes:
    p = _secret_path()
    try:
        with open(p, "rb") as f:
            return f.read()
    except FileNotFoundError:
        key = secrets.token_bytes(32)
        with open(p, "wb") as f:
            f.write(key)
        try:
            os.chmod(p, 0o600)
        except OSError:
            pass
        return key


def _load_config() -> dict:
    try:
        with open(_config_path()) as f:
            return json.load(f)
    except (FileNotFoundError, ValueError):
        return {}


def _ttl() -> int:
    return int(_load_config().get("token_ttl_seconds", _DEFAULT_TTL))


def _load_passwords() -> dict:
    try:
        with open(_pw_path()) as f:
            return json.load(f)
    except (FileNotFoundError, ValueError):
        return {}


def _save_passwords(data: dict) -> None:
    tmp = _pw_path() + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f)
    os.replace(tmp, _pw_path())


def _hash_password(password: str, salt: Optional[bytes] = None) -> dict:
    if salt is None:
        salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 200_000)
    return {
        "salt": base64.b64encode(salt).decode(),
        "hash": base64.b64encode(dk).decode(),
    }


def _verify_password(password: str, rec: dict) -> bool:
    try:
        salt = base64.b64decode(rec["salt"])
        expected = base64.b64decode(rec["hash"])
    except Exception:
        return False
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 200_000)
    return hmac.compare_digest(dk, expected)


def _store_password(user_id: str, password: str) -> None:
    data = _load_passwords()
    data[user_id] = _hash_password(password)
    _save_passwords(data)


def _users_map() -> dict:
    """display_name -> user_id, from the official users.json."""
    try:
        from server import PromptServer
    except Exception:
        return {}
    mgr = getattr(getattr(PromptServer, "instance", None), "user_manager", None)
    if mgr is None:
        return {}
    return dict(getattr(mgr, "users", {}))


def _resolve_user_id(username: str) -> Optional[str]:
    username = (username or "").strip()
    if not username:
        return None
    for uid, name in _users_map().items():
        if name == username:
            return uid
    return None


# ---------------------------------------------------------------- tokens

def _issue_token(user_id: str) -> str:
    secret = _load_secret()
    payload = {"u": user_id, "exp": int(time.time()) + _ttl()}
    body = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode()
    sig = hmac.new(secret, body.encode(), hashlib.sha256).hexdigest()
    return f"{body}.{sig}"


def _verify_token(token: Optional[str]) -> Optional[str]:
    if not token:
        return None
    try:
        body, sig = token.split(".", 1)
    except ValueError:
        return None
    secret = _load_secret()
    expect = hmac.new(secret, body.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expect, sig):
        return None
    try:
        payload = json.loads(base64.urlsafe_b64decode(body))
    except Exception:
        return None
    if int(payload.get("exp", 0)) < int(time.time()):
        return None
    return payload.get("u")


def _token_from_request(request) -> Optional[str]:
    # 1) Cookie (primary — auto-sent on fetch + WS).
    cookie = request.cookies.get("xcat_token") if hasattr(request, "cookies") else None
    if cookie:
        return cookie
    # 2) Query param fallback (WS edge cases).
    q = request.rel_url.query.get("xcat_token") if hasattr(request, "rel_url") else None
    if q:
        return q
    # 3) Bearer header.
    auth = request.headers.get("Authorization") if hasattr(request, "headers") else None
    if auth and auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return None


def _authenticated_user(request) -> Optional[str]:
    uid = _verify_token(_token_from_request(request))
    if uid is None:
        return None
    try:
        from folder_paths import SYSTEM_USER_PREFIX
    except Exception:
        return uid
    if uid.startswith(SYSTEM_USER_PREFIX):
        return None
    # Must still be a known account.
    if uid not in _users_map():
        return None
    return uid


# ---------------------------------------------------------------- public check

def _is_public(method: str, path: str) -> bool:
    if method == "OPTIONS":
        return True
    if path in ("/", "/index.html"):
        return True
    if path.startswith(("/xcat/login", "/xcat/auth_status", "/xcat/logout",
                         "/xcat/register", "/extensions/", "/assets/")):
        return True
    # Open account registration (POST only) so a fresh install can bootstrap.
    if method == "POST" and path == "/users":
        return True
    # Static frontend / custom-node assets.
    ext = os.path.splitext(path)[1].lower()
    if ext in _STATIC_EXT:
        return True
    return False


# ---------------------------------------------------------------- middleware

@web.middleware
async def _auth_middleware(request, handler):
    uid = _authenticated_user(request)
    token = _XAUTH_USER.set(uid)
    try:
        if _is_public(request.method, request.path):
            return await handler(request)
        if uid is None:
            return web.json_response({"error": "unauthorized"}, status=401)
        return await handler(request)
    finally:
        _XAUTH_USER.reset(token)


# ---------------------------------------------------------------- route handlers

def _json(body, status=200):
    from aiohttp import web
    return web.json_response(body, status=status)


async def _h_register(request):
    try:
        body = await request.json()
    except Exception:
        return _json({"error": "bad request"}, status=400)
    username = (body.get("username") or "").strip()
    password = body.get("password") or ""
    if not username or not password:
        return _json({"error": "username and password are required"}, status=400)
    try:
        from server import PromptServer
        mgr = PromptServer.instance.user_manager
    except Exception as exc:
        return _json({"error": f"user manager unavailable: {exc}"}, status=500)
    if username in mgr.users.values():
        return _json({"error": "duplicate username"}, status=400)
    try:
        user_id = mgr.add_user(username)
    except ValueError as e:
        return _json({"error": str(e)}, status=400)
    _store_password(user_id, password)
    _log().info("[XXXXXLCat] registered new account %s (%s)", username, user_id)
    return _json({"user_id": user_id, "username": username})


async def _h_login(request):
    try:
        body = await request.json()
    except Exception:
        return _json({"error": "bad request"}, status=400)
    username = (body.get("username") or "").strip()
    password = body.get("password") or ""
    if not username:
        return _json({"error": "username required"}, status=400)
    user_id = _resolve_user_id(username)
    if not user_id:
        return _json({"error": "unknown user"}, status=401)
    rec = _load_passwords().get(user_id)
    if rec is None:
        # Migration path: accounts created before this feature have no password.
        # Let them in with an *empty* password once, so they can set one.
        if password == "":
            token = _issue_token(user_id)
            return _login_ok(token, user_id)
        return _json(
            {"error": "password not set; log in with an empty password once "
                      "to set one, or ask the admin to set it"},
            status=401,
        )
    if not _verify_password(password, rec):
        return _json({"error": "invalid password"}, status=401)
    token = _issue_token(user_id)
    return _login_ok(token, user_id)


def _login_ok(token: str, user_id: str):
    from aiohttp import web
    ttl = _ttl()
    resp = web.json_response({
        "ok": True,
        "user_id": user_id,
        "username": _users_map().get(user_id),
        "expires_at": int(time.time()) + ttl,
    })
    resp.set_cookie(
        "xcat_token", token,
        max_age=ttl,
        path="/",
        httponly=True,
        samesite="lax",
    )
    return resp


async def _h_set_password(request):
    uid = _authenticated_user(request)
    if uid is None:
        return _json({"error": "unauthorized"}, status=401)
    try:
        body = await request.json()
    except Exception:
        return _json({"error": "bad request"}, status=400)
    new_pw = body.get("password") or ""
    if not new_pw:
        return _json({"error": "password required"}, status=400)
    rec = _load_passwords().get(uid)
    if rec is not None:
        old = body.get("old_password") or ""
        if not _verify_password(old, rec):
            return _json({"error": "current password incorrect"}, status=401)
    _store_password(uid, new_pw)
    _log().info("[XXXXXLCat] password updated for %s", uid)
    return _json({"ok": True})


async def _h_admin_set_password(request):
    cfg = _load_config()
    admin_pw = cfg.get("admin_password")
    if not admin_pw:
        return _json({"error": "admin_password not configured"}, status=403)
    try:
        body = await request.json()
    except Exception:
        return _json({"error": "bad request"}, status=400)
    if body.get("admin_password") != admin_pw:
        return _json({"error": "unauthorized"}, status=401)
    user_id = body.get("user_id")
    new_pw = body.get("password") or ""
    if not user_id or not new_pw:
        return _json({"error": "user_id and password required"}, status=400)
    if user_id not in _users_map():
        return _json({"error": "unknown user"}, status=404)
    _store_password(user_id, new_pw)
    _log().info("[XXXXXLCat] admin set password for %s", user_id)
    return _json({"ok": True})


async def _h_auth_status(request):
    uid = _authenticated_user(request)
    if uid is None:
        return _json({"authenticated": False})
    return _json({
        "authenticated": True,
        "user_id": uid,
        "username": _users_map().get(uid),
    })


async def _h_logout(request):
    from aiohttp import web
    resp = web.json_response({"ok": True})
    resp.del_cookie("xcat_token")
    return resp


# ---------------------------------------------------------------- install

def _install_user_manager() -> None:
    """Make every official route scope to the password-authenticated user.

    ``UserManager.get_request_user_id`` is what the settings, workflow, userdata
    and ``/view`` routes use to pick the active user. Wrapping it to return the
    token identity (when a session is present) means the frontend's
    ``comfy-user`` header no longer governs scoping — isolation is driven solely
    by the validated password session.
    """
    try:
        from app.user_manager import UserManager
    except Exception:
        return

    orig = UserManager.get_request_user_id

    def _patched(self, request):
        au = _XAUTH_USER.get()
        if au is not None:
            if au in getattr(self, "users", {}):
                return au
            raise KeyError("Unknown user: " + au)
        return orig(self, request)

    if getattr(UserManager.get_request_user_id, "_xcat_wrapped", False):
        return
    UserManager.get_request_user_id = _patched
    UserManager.get_request_user_id._xcat_wrapped = True


def _attach(server_instance) -> None:
    app = getattr(server_instance, "app", None)
    if app is None:
        return

    global _ROUTES_DONE, _MIDDLEWARE_DONE

    if not _ROUTES_DONE:
        try:
            router = app.router
            router.add_route("POST", "/xcat/register", _h_register)
            router.add_route("POST", "/xcat/login", _h_login)
            router.add_route("POST", "/xcat/set_password", _h_set_password)
            router.add_route("POST", "/xcat/admin/set_password", _h_admin_set_password)
            router.add_route("GET", "/xcat/auth_status", _h_auth_status)
            router.add_route("POST", "/xcat/logout", _h_logout)
            _ROUTES_DONE = True
        except Exception as exc:  # pragma: no cover - defensive
            _log().warning("[XXXXXLCat] could not add auth routes: %s", exc)

    if not _MIDDLEWARE_DONE:
        try:
            # Insert at position 0 so auth runs *before* the asset-isolation
            # middleware and can publish the validated user via _XAUTH_USER.
            app.middlewares.insert(0, _auth_middleware)
            _MIDDLEWARE_DONE = True
        except Exception as exc:  # pragma: no cover - defensive
            _log().warning("[XXXXXLCat] could not attach auth middleware: %s", exc)


def install() -> bool:
    """Install the per-user password gate.

    Returns ``True`` if patches were applied, ``False`` if multi-user is off or
    already installed.
    """
    global _INSTALLED
    if _INSTALLED:
        return True
    if not _enabled():
        return False

    try:
        import server

        _install_user_manager()

        orig_init = server.PromptServer.__init__

        def _patched_init(self, *a, **k):
            orig_init(self, *a, **k)
            _attach(self)

        server.PromptServer.__init__ = _patched_init

        inst = getattr(server.PromptServer, "instance", None)
        if inst is not None:
            _attach(inst)

        _INSTALLED = True
        _log().info("[XXXXXLCat] multi-user password auth enabled "
                    "(endpoints under /xcat/, cookie-based sessions)")
        print("[XXXXXLCat] multi-user password auth enabled "
              "(login at /xcat/login; per-user passwords in user_passwords.json)")
        return True
    except Exception as exc:  # pragma: no cover - defensive
        _log().warning("[XXXXXLCat] multi-user password auth failed to install: %s", exc)
        return False
