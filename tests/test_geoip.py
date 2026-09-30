import sqlite3
import threading
from pathlib import Path

import pytest

from services.geoip import GEO_COLUMNS, GeoDatabase, is_valid_geo_data


class StreamingResponse:
    def __init__(self, chunks: list[bytes], headers: dict[str, str] | None = None):
        self.chunks = chunks
        self.headers = headers or {}
        self.status_code = 200

    def __enter__(self):
        return self

    def __exit__(self, *_args: object) -> bool:
        return False

    def iter_content(self, chunk_size: int):
        del chunk_size
        yield from self.chunks


def create_database(path: Path, columns: tuple[str, ...], rows: list[tuple] | None = None) -> None:
    definitions = [
        f'"{column}" TEXT PRIMARY KEY' if column == "ip" else f'"{column}"' for column in columns
    ]
    with sqlite3.connect(path) as connection:
        connection.execute(f"CREATE TABLE geo_cache ({','.join(definitions)})")
        if rows:
            placeholders = ",".join("?" for _ in columns)
            connection.executemany(f"INSERT INTO geo_cache VALUES ({placeholders})", rows)


def database(tmp_path: Path) -> GeoDatabase:
    result = GeoDatabase(tmp_path, enabled=True)
    result.initialize()
    return result


def test_geo_validation() -> None:
    assert is_valid_geo_data({"lat": -36.85, "lon": 174.76, "country": "New Zealand"})
    assert not is_valid_geo_data({"lat": 91, "lon": 10, "country": "NZ"})
    assert not is_valid_geo_data({"lat": 0, "lon": 0, "country": ""})


def test_update_rejects_oversized_stream(tmp_path: Path) -> None:
    geo_database = database(tmp_path)
    result = geo_database.update(
        http_get=lambda *_args, **_kwargs: StreamingResponse([b"123456", b"78901"]),
        max_download_bytes=10,
    )

    assert result["success"] is False
    assert "size limit" in result["message"]
    assert list(geo_database.temp_dir.iterdir()) == []


def test_update_rejects_unexpected_schema(tmp_path: Path) -> None:
    geo_database = database(tmp_path)
    remote = tmp_path / "wrong-schema.db"
    create_database(remote, GEO_COLUMNS[:-1])

    result = geo_database.update(
        http_get=lambda *_args, **_kwargs: StreamingResponse([remote.read_bytes()])
    )

    assert result == {
        "success": False,
        "message": "Downloaded database has an unexpected geo_cache schema",
    }


def test_update_merges_rows(tmp_path: Path) -> None:
    geo_database = database(tmp_path)
    remote = tmp_path / "remote.db"
    row = ("198.51.100.1",) + (None,) * (len(GEO_COLUMNS) - 1)
    create_database(remote, GEO_COLUMNS, [row])

    result = geo_database.update(
        http_get=lambda *_args, **_kwargs: StreamingResponse([remote.read_bytes()])
    )

    assert result == {"success": True, "message": "+1 new entries (1 total)"}


@pytest.mark.parametrize(
    ("local_timestamp", "remote_timestamp", "should_update"),
    [
        (100, 200, True),
        (200, 100, False),
        (200, 200, False),
        (None, 200, True),
        (200, None, False),
        (None, None, False),
    ],
)
def test_merge_replaces_only_newer_records(
    tmp_path, local_timestamp, remote_timestamp, should_update
):
    geo_database = database(tmp_path)
    with sqlite3.connect(geo_database.path) as connection:
        connection.execute(
            "INSERT INTO geo_cache (ip, city, last_updated) VALUES (?, ?, ?)",
            ("198.51.100.1", "Local city", local_timestamp),
        )
    remote = tmp_path / "remote.db"
    records = [
        {"ip": "198.51.100.1", "city": "Remote city", "last_updated": remote_timestamp},
        {"ip": "198.51.100.2", "city": "New city", "last_updated": 300},
    ]
    create_database(
        remote, GEO_COLUMNS, [tuple(row.get(key) for key in GEO_COLUMNS) for row in records]
    )
    geo_database.stats()  # A merge must also invalidate cached statistics.
    generation = geo_database.generation

    result = geo_database.update(
        http_get=lambda *_args, **_kwargs: StreamingResponse([remote.read_bytes()])
    )

    assert result == {
        "success": True,
        "message": "+1 new entries, 1 updated entries (2 total)"
        if should_update
        else "+1 new entries (2 total)",
    }
    existing = geo_database.get("198.51.100.1")
    assert existing["city"] == ("Remote city" if should_update else "Local city")
    assert existing["last_updated"] == (remote_timestamp if should_update else local_timestamp)
    assert geo_database.get("198.51.100.2")["city"] == "New city"
    assert geo_database.stats()["entries"] == 2
    assert geo_database.generation > generation
    assert list(geo_database.temp_dir.iterdir()) == []

    repeated = geo_database.update(
        http_get=lambda *_args, **_kwargs: StreamingResponse([remote.read_bytes()])
    )
    assert repeated == {"success": True, "message": "Already up to date (2 entries)"}


def test_merge_reports_updates_without_new_ips(tmp_path):
    geo_database = database(tmp_path)
    with sqlite3.connect(geo_database.path) as connection:
        connection.execute(
            "INSERT INTO geo_cache (ip, city, last_updated) VALUES ('198.51.100.1', 'Old', 100)"
        )
    record = {"ip": "198.51.100.1", "city": "New", "last_updated": 200}
    remote = tmp_path / "remote.db"
    create_database(remote, GEO_COLUMNS, [tuple(record.get(key) for key in GEO_COLUMNS)])

    result = geo_database.update(
        http_get=lambda *_args, **_kwargs: StreamingResponse([remote.read_bytes()])
    )

    assert result == {"success": True, "message": "1 updated entries (1 total)"}
    assert geo_database.get("198.51.100.1")["city"] == "New"


def test_update_rejects_concurrent_request(tmp_path: Path) -> None:
    geo_database = database(tmp_path)
    geo_database._update_lock = threading.Lock()
    assert geo_database._update_lock.acquire(blocking=False)
    try:
        assert geo_database.update() == {
            "success": False,
            "message": "Geo database update already in progress",
        }
    finally:
        geo_database._update_lock.release()


def test_statistics_cache_invalidated_only_after_successful_writes_or_merges(tmp_path, monkeypatch):
    geo_database = database(tmp_path)
    reads = []
    read_stats = geo_database._read_stats

    def counted():
        reads.append(True)
        return read_stats()

    monkeypatch.setattr(geo_database, "_read_stats", counted)
    first = geo_database.stats()
    first["entries"] = 999  # callers receive independent dictionaries
    assert geo_database.stats()["entries"] == 0
    assert len(reads) == 1
    geo_database.save("198.51.100.1", {"lat": 1, "lon": 2, "country": "NZ"})
    assert geo_database.stats()["entries"] == 1
    assert len(reads) == 2
    geo_database.save("bad", {})
    assert geo_database.stats()["entries"] == 1
    assert len(reads) == 2
    remote = tmp_path / "remote.db"
    row = ("198.51.100.2",) + (None,) * (len(GEO_COLUMNS) - 1)
    create_database(remote, GEO_COLUMNS, [row])
    assert geo_database.update(
        http_get=lambda *args, **kwargs: StreamingResponse([remote.read_bytes()])
    )["success"]
    assert geo_database.stats()["entries"] == 2
    assert len(reads) == 3
    assert geo_database.stats()["entries"] == 2
    assert len(reads) == 3
