import os
from pathlib import Path
from typing import Optional


def load_dotenv(path: Optional[str] = None) -> None:
    """Minimal .env loader (no external dependency).

    - Loads KEY=VALUE lines
    - Skips blanks and comments (#...)
    - Does not override existing environment variables
    """

    env_path = Path(path) if path else Path(__file__).resolve().parent / ".env"
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            os.environ[key] = value
