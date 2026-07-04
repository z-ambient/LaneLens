# LaneLens production image (Railway/Render/Fly read this automatically).
FROM python:3.13-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY frontend ./frontend
COPY data/matchups.json data/champions_fallback.json ./data/

# Platforms inject PORT; default matches local dev.
EXPOSE 8000
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
