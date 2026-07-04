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

from sqlalchemy import BigInteger, Column, String, Text, create_engine, select
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


class UserRow(Base):
    __tablename__ = "users"
    id = Column(String(32), primary_key=True)  # Discord user id
    username = Column(String(100), nullable=False)
    avatar = Column(String(64))
    riot_game_name = Column(String(64))
    riot_tag_line = Column(String(16))
    riot_platform = Column(String(8))


class SessionRow(Base):
    __tablename__ = "sessions"
    token = Column(String(64), primary_key=True)
    user_id = Column(String(32), nullable=False)
    expires_at = Column(BigInteger, nullable=False)  # epoch seconds


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


# ---------- Users & sessions (Discord login) ----------

def _user_dict(row):
    return {
        "id": row.id,
        "username": row.username,
        "avatar": row.avatar,
        "riotProfile": (
            {
                "gameName": row.riot_game_name,
                "tagLine": row.riot_tag_line,
                "platform": row.riot_platform or "na1",
            }
            if row.riot_game_name and row.riot_tag_line
            else None
        ),
    }


def user_upsert(user_id, username, avatar):
    with _session() as session:
        row = session.get(UserRow, user_id)
        if row is None:
            row = UserRow(id=user_id, username=username, avatar=avatar)
            session.add(row)
        else:
            row.username = username
            row.avatar = avatar
        session.commit()


def user_get(user_id):
    with _session() as session:
        row = session.get(UserRow, user_id)
        return _user_dict(row) if row else None


def user_set_riot_profile(user_id, game_name, tag_line, platform):
    with _session() as session:
        row = session.get(UserRow, user_id)
        if row is None:
            return False
        row.riot_game_name = game_name
        row.riot_tag_line = tag_line
        row.riot_platform = platform
        session.commit()
        return True


def session_create(token, user_id, expires_at):
    with _session() as session:
        session.merge(SessionRow(token=token, user_id=user_id, expires_at=expires_at))
        session.commit()


def session_get_user(token, now):
    """Resolve a session token to its user; expired sessions are removed."""
    if not token:
        return None
    with _session() as session:
        row = session.get(SessionRow, token)
        if row is None:
            return None
        if row.expires_at < now:
            session.delete(row)
            session.commit()
            return None
        user = session.get(UserRow, row.user_id)
        return _user_dict(user) if user else None


def history_all_games():
    """Every stored lane-matchup record across all players (for pre-warming)."""
    with _session() as session:
        rows = session.execute(select(HistoryRow.entry_json)).scalars().all()
    games = []
    for raw in rows:
        try:
            games.extend(json.loads(raw).get("games", []))
        except ValueError:
            continue
    return games


def session_delete(token):
    with _session() as session:
        row = session.get(SessionRow, token)
        if row:
            session.delete(row)
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
