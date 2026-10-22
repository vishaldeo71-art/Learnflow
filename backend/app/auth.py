"""Verified end-user identity, independent of the private service credential."""
from contextvars import ContextVar
from dataclasses import dataclass
import uuid
import httpx
from fastapi import HTTPException


@dataclass(frozen=True)
class Identity:
    id: str
    email: str
    name: str = ""
    is_admin: bool = False


current_user: ContextVar[Identity | None] = ContextVar("learnflow_user", default=None)


async def verify_identity(token: str, settings, store) -> Identity:
    if not token or len(token) > 16384:
        raise HTTPException(401, "Please sign in to continue.")
    try:
        async with httpx.AsyncClient(timeout=12) as client:
            response = await client.get(f"{settings.supabase_url}/auth/v1/user", headers={
                "apikey": settings.supabase_publishable_key, "Authorization": f"Bearer {token}",
            })
        if response.status_code in (401, 403):
            raise HTTPException(401, "Please sign in to continue.")
        response.raise_for_status()
        data = response.json()
        uid = str(uuid.UUID(data["id"]))
        email = data.get("email", "")
        profile = await store.ensure_profile(uid, email, str(data.get("user_metadata", {}).get("full_name", ""))[:100])
        return Identity(uid, email, profile["display_name"], profile["role"] == "admin")
    except HTTPException:
        raise
    except (httpx.HTTPError, ValueError, KeyError) as exc:
        raise HTTPException(503, "The sign-in service is temporarily unavailable. Please retry.") from exc


def require_user() -> Identity:
    user = current_user.get()
    if user is None:
        raise HTTPException(401, "Please sign in to continue.")
    return user


def require_admin() -> Identity:
    user = require_user()
    if not user.is_admin:
        raise HTTPException(403, "Administrator access required.")
    return user
