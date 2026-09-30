"""Persistent mutable dashboard preferences."""

from __future__ import annotations

import json
import os
import tempfile
import threading
from dataclasses import asdict, dataclass
from pathlib import Path


@dataclass(slots=True)
class Preferences:
    geoip_auto_update: bool = True
    geoip_db_only: bool = False


class PreferenceStore:
    """Thread-safe JSON store with atomic replacement writes."""

    def __init__(self, path: Path):
        self.path = path
        self._lock = threading.RLock()

    def load(self) -> Preferences:
        with self._lock:
            if not self.path.exists():
                return Preferences()
            try:
                data = json.loads(self.path.read_text())
            except (OSError, ValueError, TypeError):
                return Preferences()
            if not isinstance(data, dict):
                return Preferences()
            auto_update = data.get("geoip_auto_update", True)
            db_only = data.get("geoip_db_only", False)
            return Preferences(
                geoip_auto_update=auto_update if isinstance(auto_update, bool) else True,
                geoip_db_only=db_only if isinstance(db_only, bool) else False,
            )

    def save(self, preferences: Preferences) -> None:
        with self._lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            descriptor, temporary_name = tempfile.mkstemp(
                dir=self.path.parent, prefix=".settings-", suffix=".json"
            )
            temporary_path = Path(temporary_name)
            try:
                with os.fdopen(descriptor, "w") as output:
                    json.dump(asdict(preferences), output, indent=2, sort_keys=True)
                    output.write("\n")
                    output.flush()
                    os.fsync(output.fileno())
                temporary_path.chmod(0o600)
                temporary_path.replace(self.path)
            finally:
                temporary_path.unlink(missing_ok=True)
