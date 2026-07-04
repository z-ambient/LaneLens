"""Every response must carry the defensive headers, and the CSP whitelist
must stay in lockstep with what the frontend actually loads."""

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


@pytest.mark.parametrize("path", ["/", "/api/health", "/api/me", "/nope"])
def test_headers_on_every_response(path):
    """Static files, API routes and even 404s all go through the middleware."""
    response = client.get(path)
    assert "default-src 'self'" in response.headers["content-security-policy"]
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["referrer-policy"] == "same-origin"


def test_csp_allows_what_the_frontend_uses():
    csp = client.get("/api/health").headers["content-security-policy"]
    directives = {
        part.split(" ")[0]: part.split(" ")[1:]
        for part in (p.strip() for p in csp.split(";"))
        if part
    }
    # Champion/item/rune art and Discord avatars.
    assert "https://ddragon.leagueoflegends.com" in directives["img-src"]
    assert "https://cdn.discordapp.com" in directives["img-src"]
    # app.js fetches item.json straight from ddragon.
    assert "https://ddragon.leagueoflegends.com" in directives["connect-src"]
    # The Cinzel font: Google CSS import, files from gstatic.
    assert "https://fonts.googleapis.com" in directives["style-src"]
    assert "https://fonts.gstatic.com" in directives["font-src"]
    # And nothing grants scripts to anyone but us.
    assert directives["script-src"] == ["'self'"]
    assert directives["frame-ancestors"] == ["'none'"]
