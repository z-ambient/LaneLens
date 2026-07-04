# LaneLens production image (Railway/Render/Fly read this automatically).
FROM python:3.13-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY frontend ./frontend
COPY data/matchups.json data/champions_fallback.json ./data/

# Run as a non-root user so a compromised app process doesn't own the
# container. Code stays root-owned (read-only to the app); data/ stays
# writable only for the local-dev SQLite fallback - production uses
# DATABASE_URL (Postgres) and never writes to disk.
RUN useradd --create-home lanelens && chown lanelens /app/data
USER lanelens

# Platforms inject PORT; default matches local dev.
# --proxy-headers lets uvicorn honor X-Forwarded-Proto so request.url.scheme is
# https behind the edge proxy (needed for correct OAuth redirect URIs + Secure
# cookies). Rate limiting does NOT rely on this: app.main.client_ip derives the
# real client IP from the trusted (right) end of X-Forwarded-For, so a spoofed
# left-hand entry can't forge the key. If the platform adds more than one proxy
# hop, set TRUSTED_PROXY_HOPS to match.
EXPOSE 8000
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips "*"
