import os
import tempfile
import unittest
from pathlib import Path

import storage
from critic import score_canvas
from session_memory import SessionMemory
from vision import inspect_canvas


class CoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        storage.DB_PATH = Path(self.tmp.name) / "test.db"
        storage.init_db()

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_storage_roundtrip(self) -> None:
        storage.create_session("s1", "draw sunset")
        storage.append_event("s1", "session_started", {"ok": True})
        storage.set_session_status("s1", "finished")

        conn = storage._conn()
        session_count = conn.execute("SELECT COUNT(*) FROM sessions").fetchone()[0]
        event_count = conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
        self.assertEqual(session_count, 1)
        self.assertEqual(event_count, 1)

    def test_inspection_and_critique(self) -> None:
        memory = SessionMemory(prompt="draw mountain")
        inspection = inspect_canvas(memory)
        critique = score_canvas(memory, inspection)

        self.assertIn("canvas_state", inspection)
        self.assertIn("prompt_alignment", critique)
        self.assertGreaterEqual(critique["prompt_alignment"], 0.0)


if __name__ == "__main__":
    unittest.main()
