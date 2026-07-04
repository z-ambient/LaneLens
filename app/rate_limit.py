"""Per-IP rate limiting shared by every route module.

The limiter lives here rather than in app.main so that app.auth can
decorate its routes without a circular import (main imports auth, auth
imports this). app.main registers the limiter on the FastAPI app and owns
the 429 handler.
"""

from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.config import TRUSTED_PROXY_HOPS


def client_ip(request: Request) -> str:
    """Rate-limit key: the real client IP, resistant to header spoofing.

    A client can PREPEND fake entries to X-Forwarded-For, but every trusted
    proxy in front of us APPENDS the address it actually saw. So the real
    client sits TRUSTED_PROXY_HOPS entries from the RIGHT end - never the
    left/client-controlled end that get_remote_address would read. When the
    header is missing (local/direct) or too short to trust, fall back to the
    socket IP, which fails safe (over-limits rather than under-limits).

    All X-Forwarded-For headers are flattened in wire order before indexing:
    a client can split its spoofed entries across several separate headers,
    but the trusted proxy's appended value is always last overall, so the
    rightmost entry of the combined chain is still the one we can trust.
    """
    if TRUSTED_PROXY_HOPS:
        parts = [
            entry.strip()
            for header in request.headers.getlist("x-forwarded-for")
            for entry in header.split(",")
            if entry.strip()
        ]
        if len(parts) >= TRUSTED_PROXY_HOPS:
            return parts[-TRUSTED_PROXY_HOPS]
    return get_remote_address(request)


# Generous for one player, tight enough that a stranger can't drain the
# Riot quota or the OpenAI budget when the app is exposed to the internet.
limiter = Limiter(key_func=client_ip)
