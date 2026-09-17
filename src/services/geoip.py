"""SQLite-backed peer geolocation storage and dataset updates."""

from __future__ import annotations

import sqlite3
import tempfile
import threading
import time
from pathlib import Path
from typing import Any, Callable

import requests

GEOIP_DATASET_URL = (
    "https://raw.githubusercontent.com/mbhillrn/Bitcoin-Node-GeoIP-Dataset/main/geo.db"
)
MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024
GEO_COLUMNS = (
    "ip",
    "continent",
    "continentCode",
    "country",
    "countryCode",
    "region",
    "regionName",
    "city",
    "district",
    "zip",
    "lat",
    "lon",
    "timezone",
    "utc_offset",
    "currency",
    "isp",
    "org",
    "as_info",
    "asname",
    "mobile",
    "proxy",
    "hosting",
    "last_updated",
)


def is_valid_geo_data(data: dict[str, Any]) -> bool:
    try:
        latitude = float(data["lat"])
        longitude = float(data["lon"])
        country = str(data.get("country", "")).strip()
    except (KeyError, TypeError, ValueError):
        return False
    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        return False
    if latitude == 0 and longitude == 0 and not country:
        return False
    return bool(country)


class GeoDatabase:
    def __init__(self, data_dir: Path, enabled: bool):
        self.enabled = enabled
        self.path = data_dir / "geo.db"
        self.temp_dir = data_dir / "tmp"
        self._update_lock = threading.Lock()
        self._generation = 0
        self._generation_lock = threading.Lock()

    @property
    def generation(self) -> int:
        with self._generation_lock:
            return self._generation

    def dataset_changed(self) -> None:
        """Invalidate derived lookup results after a committed dataset merge."""
        with self._generation_lock:
            self._generation += 1

    def initialize(self) -> None:
        if not self.enabled:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.temp_dir.mkdir(parents=True, exist_ok=True)
        for path in self.temp_dir.iterdir():
            if path.is_file():
                path.unlink(missing_ok=True)
        with sqlite3.connect(self.path) as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS geo_cache (
                    ip TEXT PRIMARY KEY,
                    continent TEXT,
                    continentCode TEXT,
                    country TEXT,
                    countryCode TEXT,
                    region TEXT,
                    regionName TEXT,
                    city TEXT,
                    district TEXT,
                    zip TEXT,
                    lat REAL,
                    lon REAL,
                    timezone TEXT,
                    utc_offset INTEGER,
                    currency TEXT,
                    isp TEXT,
                    org TEXT,
                    as_info TEXT,
                    asname TEXT,
                    mobile INTEGER DEFAULT 0,
                    proxy INTEGER DEFAULT 0,
                    hosting INTEGER DEFAULT 0,
                    last_updated INTEGER
                )
                """
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_geo_country ON geo_cache(countryCode)"
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_geo_updated ON geo_cache(last_updated)"
            )
            connection.execute("PRAGMA journal_mode=WAL")

    def stats(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "status": "disabled",
            "entries": 0,
            "size_bytes": 0,
            "last_updated": None,
            "oldest_updated": None,
            "db_path": str(self.path),
        }
        if not self.enabled:
            return result
        if not self.path.exists():
            result["status"] = "not_found"
            return result
        try:
            with sqlite3.connect(self.path) as connection:
                count = connection.execute("SELECT COUNT(*) FROM geo_cache").fetchone()[0]
                latest = connection.execute("SELECT MAX(last_updated) FROM geo_cache").fetchone()[0]
                oldest = connection.execute(
                    "SELECT MIN(last_updated) FROM geo_cache WHERE last_updated > 0"
                ).fetchone()[0]
            result.update(
                status="ok",
                entries=count,
                size_bytes=self.path.stat().st_size,
                last_updated=latest,
                oldest_updated=oldest,
            )
        except (OSError, sqlite3.Error) as exc:
            result.update(status="error", error=str(exc))
        return result

    def get(self, ip_address: str) -> dict[str, Any] | None:
        if not self.enabled or not self.path.exists():
            return None
        try:
            with sqlite3.connect(self.path) as connection:
                connection.row_factory = sqlite3.Row
                row = connection.execute(
                    "SELECT * FROM geo_cache WHERE ip = ?", (ip_address,)
                ).fetchone()
        except sqlite3.Error:
            return None
        return dict(row) if row else None

    def save(self, ip_address: str, data: dict[str, Any]) -> None:
        if not self.enabled or not is_valid_geo_data(data):
            return
        values = (
            ip_address,
            data.get("continent", ""),
            data.get("continentCode", ""),
            data.get("country", ""),
            data.get("countryCode", ""),
            data.get("region", ""),
            data.get("regionName", ""),
            data.get("city", ""),
            data.get("district", ""),
            data.get("zip", ""),
            data.get("lat", 0),
            data.get("lon", 0),
            data.get("timezone", ""),
            data.get("offset", 0),
            data.get("currency", ""),
            data.get("isp", ""),
            data.get("org", ""),
            data.get("as", ""),
            data.get("asname", ""),
            int(bool(data.get("mobile"))),
            int(bool(data.get("proxy"))),
            int(bool(data.get("hosting"))),
            int(time.time()),
        )
        placeholders = ",".join("?" for _ in GEO_COLUMNS)
        updates = ",".join(
            f"{column}=excluded.{column}" for column in GEO_COLUMNS if column != "ip"
        )
        try:
            with sqlite3.connect(self.path, timeout=5) as connection:
                connection.execute(
                    f"INSERT INTO geo_cache ({','.join(GEO_COLUMNS)}) "
                    f"VALUES ({placeholders}) ON CONFLICT(ip) DO UPDATE SET {updates}",
                    values,
                )
        except sqlite3.Error as exc:
            print(f"Could not save geolocation for {ip_address}: {exc}")

    def update(
        self,
        http_get: Callable[..., Any] = requests.get,
        max_download_bytes: int = MAX_DOWNLOAD_BYTES,
    ) -> dict[str, Any]:
        if not self.enabled:
            return {"success": False, "message": "Geo database is disabled"}
        if not self._update_lock.acquire(blocking=False):
            return {"success": False, "message": "Geo database update already in progress"}

        temporary_path: Path | None = None
        try:
            self.temp_dir.mkdir(parents=True, exist_ok=True)
            with http_get(GEOIP_DATASET_URL, timeout=60, stream=True) as response:
                if response.status_code != 200:
                    return {
                        "success": False,
                        "message": f"Download failed (HTTP {response.status_code})",
                    }
                content_length = response.headers.get("Content-Length")
                if content_length:
                    expected_size = int(content_length)
                    if expected_size < 0:
                        raise ValueError("Download returned an invalid Content-Length")
                    if expected_size > max_download_bytes:
                        raise ValueError("Downloaded database exceeds the 100 MiB size limit")

                downloaded = 0
                with tempfile.NamedTemporaryFile(
                    mode="wb",
                    dir=self.temp_dir,
                    prefix="geo-download-",
                    suffix=".db",
                    delete=False,
                ) as output:
                    temporary_path = Path(output.name)
                    for chunk in response.iter_content(chunk_size=64 * 1024):
                        if not chunk:
                            continue
                        downloaded += len(chunk)
                        if downloaded > max_download_bytes:
                            raise ValueError("Downloaded database exceeds the 100 MiB size limit")
                        output.write(chunk)

            with sqlite3.connect(f"file:{temporary_path}?mode=ro", uri=True) as remote_connection:
                integrity = remote_connection.execute("PRAGMA quick_check").fetchone()
                if not integrity or integrity[0] != "ok":
                    raise ValueError("Downloaded database failed SQLite integrity validation")
                schema = remote_connection.execute("PRAGMA table_info(geo_cache)").fetchall()
                if tuple(row[1] for row in schema) != GEO_COLUMNS:
                    raise ValueError("Downloaded database has an unexpected geo_cache schema")
                columns = ",".join(GEO_COLUMNS)
                rows = remote_connection.execute(f"SELECT {columns} FROM geo_cache").fetchall()

            if not rows:
                raise ValueError("Remote database is empty")
            if not self.path.exists():
                temporary_path.replace(self.path)
                temporary_path = None
                self.dataset_changed()
                return {
                    "success": True,
                    "message": f"Downloaded database ({len(rows)} entries)",
                }

            placeholders = ",".join("?" for _ in GEO_COLUMNS)
            with sqlite3.connect(self.path, timeout=5) as connection:
                before = connection.execute("SELECT COUNT(*) FROM geo_cache").fetchone()[0]
                connection.executemany(
                    f"INSERT OR IGNORE INTO geo_cache ({columns}) VALUES ({placeholders})",
                    rows,
                )
                total = connection.execute("SELECT COUNT(*) FROM geo_cache").fetchone()[0]
            added = total - before
            self.dataset_changed()
            message = (
                f"+{added} new entries ({total} total)"
                if added
                else f"Already up to date ({total} entries)"
            )
            return {"success": True, "message": message}
        except (OSError, ValueError, sqlite3.Error, requests.RequestException) as exc:
            return {"success": False, "message": str(exc)}
        finally:
            if temporary_path is not None:
                temporary_path.unlink(missing_ok=True)
            self._update_lock.release()
