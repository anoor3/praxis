import json
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent / "praxis.db"


def _conn() -> sqlite3.Connection:
    return sqlite3.connect(DB_PATH)


def init_db() -> None:
    with _conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                prompt TEXT NOT NULL,
                status TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                payload TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
            """
        )


def create_session(session_id: str, prompt: str) -> None:
    with _conn() as conn:
        conn.execute("INSERT INTO sessions(id, prompt, status) VALUES(?,?,?)", (session_id, prompt, "running"))


def set_session_status(session_id: str, status: str) -> None:
    with _conn() as conn:
        conn.execute("UPDATE sessions SET status=? WHERE id=?", (status, session_id))


def append_event(session_id: str, event_type: str, payload: dict) -> None:
    with _conn() as conn:
        conn.execute(
            "INSERT INTO events(session_id, event_type, payload) VALUES(?,?,?)",
            (session_id, event_type, json.dumps(payload)),
        )
