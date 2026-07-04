"""Discord OAuth login.

Flow: /auth/login redirects to Discord's consent screen (scope: identify
only - we never see the user's email or servers). Discord sends the user
back to /auth/callback with a one-time code; we exchange it server-side for
the user's id/name/avatar, upsert them in the users table, and set an
HttpOnly session cookie. The Riot profile saved under an account follows
the user across devices.

Optional feature: without DISCORD_CLIENT_ID/SECRET everything else works
and the frontend simply hides the login button.
"""

import logging
import secrets
import time
from urllib.parse import urlencode

import requests
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel

from app import storage
from app.config import DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET

logger = logging.getLogger("uvicorn.error")

router = APIRouter()

SESSION_COOKIE = "lanelens_session"
STATE_COOKIE = "ll_oauth_state"
SESSION_TTL_SECONDS = 30 * 24 * 3600  # 30 days

DISCORD_AUTHORIZE_URL = "https://discord.com/oauth2/authorize"
DISCORD_TOKEN_URL = "https://discord.com/api/oauth2/token"
DISCORD_ME_URL = "https://discord.com/api/users/@me"


def discord_configured():
    return bool(DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET)


def _redirect_uri(request):
    # Works for both http://127.0.0.1:8000 and the deployed https domain
    # (uvicorn runs with --proxy-headers in production, so the scheme is right).
    return str(request.base_url).rstrip("/") + "/auth/callback"


def _secure(request):
    return request.url.scheme == "https"


def _exchange_code(code, redirect_uri):
    """OAuth code -> access token (server-to-server, secret never leaves here)."""
    response = requests.post(
        DISCORD_TOKEN_URL,
        data={
            "client_id": DISCORD_CLIENT_ID,
            "client_secret": DISCORD_CLIENT_SECRET,
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
        },
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=15,
    )
    response.raise_for_status()
    return response.json()["access_token"]


def _fetch_user(access_token):
    response = requests.get(
        DISCORD_ME_URL,
        headers={"Authorization": "Bearer " + access_token},
        timeout=15,
    )
    response.raise_for_status()
    data = response.json()
    return {
        "id": data["id"],
        "username": data.get("global_name") or data.get("username") or "Summoner",
        "avatar": data.get("avatar"),
    }


def current_user(request):
    """The logged-in user for this request, or None."""
    return storage.session_get_user(
        request.cookies.get(SESSION_COOKIE), int(time.time())
    )


@router.get("/auth/login")
def login(request: Request):
    if not discord_configured():
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": "Discord login is not configured on this server."},
        )
    state = secrets.token_urlsafe(24)
    params = urlencode({
        "client_id": DISCORD_CLIENT_ID,
        "redirect_uri": _redirect_uri(request),
        "response_type": "code",
        "scope": "identify",
        "state": state,
    })
    response = RedirectResponse(DISCORD_AUTHORIZE_URL + "?" + params)
    response.set_cookie(
        STATE_COOKIE, state, max_age=600, httponly=True,
        samesite="lax", secure=_secure(request),
    )
    return response


@router.get("/auth/callback")
def callback(request: Request, code: str = None, state: str = None, error: str = None):
    failed = RedirectResponse("/?login=failed")
    failed.delete_cookie(STATE_COOKIE)

    if error or not code or not state:
        return failed
    if state != request.cookies.get(STATE_COOKIE):
        return failed  # possible CSRF - reject

    try:
        access_token = _exchange_code(code, _redirect_uri(request))
        user = _fetch_user(access_token)
    except Exception:
        logger.warning("Discord OAuth exchange failed", exc_info=True)
        return failed

    storage.user_upsert(user["id"], user["username"], user["avatar"])

    token = secrets.token_urlsafe(32)
    storage.session_create(token, user["id"], int(time.time()) + SESSION_TTL_SECONDS)

    response = RedirectResponse("/")
    response.delete_cookie(STATE_COOKIE)
    response.set_cookie(
        SESSION_COOKIE, token, max_age=SESSION_TTL_SECONDS, httponly=True,
        samesite="lax", secure=_secure(request),
    )
    return response


@router.post("/auth/logout")
def logout(request: Request):
    storage.session_delete(request.cookies.get(SESSION_COOKIE))
    response = JSONResponse({"ok": True})
    response.delete_cookie(SESSION_COOKIE)
    return response


@router.get("/api/me")
def me(request: Request):
    user = current_user(request)
    return {
        "ok": True,
        "configured": discord_configured(),
        "authenticated": user is not None,
        "user": user,
    }


class ProfileBody(BaseModel):
    gameName: str
    tagLine: str
    platform: str = "na1"


@router.post("/api/me/profile")
def save_profile(request: Request, body: ProfileBody):
    """Persist the saved Riot profile on the account (cross-device)."""
    user = current_user(request)
    if user is None:
        return JSONResponse(status_code=401, content={"ok": False, "error": "Not signed in."})
    storage.user_set_riot_profile(
        user["id"], body.gameName.strip(), body.tagLine.strip().lstrip("#"),
        body.platform.strip().lower() or "na1",
    )
    return {"ok": True}
