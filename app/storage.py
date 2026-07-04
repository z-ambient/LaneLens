"""Database storage layer for LaneLens caches.

Locally this is a zero-config SQLite file (data/lanelens.db). In production
(Railway etc.) set DATABASE_URL to a Postgres connection string and the same
code runs against it - transactional and concurrency-safe either way, and it
survives redeploys, unlike the JSON files it replaces.

On first run against an empty database, any legacy JSON stores
(data/advice_cache.json, data/matchup_history.json) are imported so nothing
accumulated so far is lost.
"""

import json
import logging
import os

from sqlalchemy import Column, String, Text, create_engine, select
from sqlalchemy.orm import declarative_base, sessionmaker

logger = logging.getLogger("uvicorn.error")

_DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
DEFAULT_URL = "sqlite:///" + os.path.join(_DATA_DIR, "lanelens.db")

Base = declarative_base()


class AdviceCacheRow(Base):
    __tablename__ = "advice_cache"
    key = Column(String(200), primary_key=True)
    patch = Column(String(32), nullable=False)
    advice_json = Column(Text, nullable=False)


class HistoryRow(Base):
    __tablename__ = "matchup_history"
    puuid = Column(String(128), primary_key=True)
    entry_json = Column(Text, nullable=False)


_engine = None
_session_factory = None


def configure(url=None):
    """Initialize the engine. Tests pass an explicit URL (skips the legacy
    import); at runtime DATABASE_URL wins, else the local SQLite default."""
    global _engine, _session_factory
    explicit = url is not None
    if url is None:
        url = os.getenv("DATABASE_URL") or DEFAULT_URL
    # Some platforms hand out the legacy postgres:// scheme.
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql://", 1)

    _engine = create_engine(url, future=True)
    Base.metadata.create_all(_engine)
    _session_factory = sessionmaker(bind=_engine, future=True)

    if not explicit:
        _import_legacy_json()


def _session():
    if _session_factory is None:
        configure()
    return _session_factory()


# ---------- Advice cache ----------

def cache_get(key):
    """Return (patch, advice) or None."""
    with _session() as session:
        row = session.get(AdviceCacheRow, key)
        if row is None:
            return None
        return row.patch, json.loads(row.advice_json)


def cache_set(key, patch, advice):
    with _session() as session:
        session.merge(AdviceCacheRow(key=key, patch=patch, advice_json=json.dumps(advice)))
        session.commit()


# ---------- Matchup history ----------

def history_get(puuid):
    """Return the stored entry dict for a player, or None."""
    with _session() as session:
        row = session.get(HistoryRow, puuid)
        return json.loads(row.entry_json) if row else None


def history_set(puuid, entry):
    with _session() as session:
        session.merge(HistoryRow(puuid=puuid, entry_json=json.dumps(entry)))
        session.commit()


# ---------- One-time import of the old JSON stores ----------

def _import_legacy_json():
    try:
        with _session() as session:
            cache_empty = session.execute(select(AdviceCacheRow.key).limit(1)).first() is None
            history_empty = session.execute(select(HistoryRow.puuid).limit(1)).first() is None

        cache_path = os.path.join(_DATA_DIR, "advice_cache.json")
        if cache_empty and os.path.exists(cache_path):
            with open(cache_path) as file:
                legacy = json.load(file)
            for key, entry in legacy.items():
                cache_set(key, entry.get("patch", ""), entry.get("advice", {}))
            logger.info("Imported %d legacy advice-cache entries into the database", len(legacy))

        history_path = os.path.join(_DATA_DIR, "matchup_history.json")
        if history_empty and os.path.exists(history_path):
            with open(history_path) as file:
                legacy = json.load(file)
            for puuid, entry in legacy.items():
                history_set(puuid, entry)
            logger.info("Imported legacy matchup history for %d players", len(legacy))
    except Exception:
        logger.warning("Legacy JSON import skipped", exc_info=True)
