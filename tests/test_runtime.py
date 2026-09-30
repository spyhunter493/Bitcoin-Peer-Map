import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

from app import create_app
from preferences import Preferences, PreferenceStore
from runtime import GEOIP_UPDATE_INTERVAL_SECONDS, AppRuntime
from settings import AppSettings


def settings(tmp_path, **overrides):
    return AppSettings.from_env(
        {
            "BITCOIN_RPC_HOST": "bitcoin",
            "BITCOIN_RPC_USER": "bpm",
            "BITCOIN_RPC_PASSWORD": "secret",
            "BPM_DATA_DIR": str(tmp_path),
            **overrides,
        }
    )


def disable_unrelated_workers(runtime, monkeypatch):
    monkeypatch.setattr(runtime.peers, "start", lambda: None)
    monkeypatch.setattr(runtime.metrics, "start", lambda: None)


class ScheduledWake:
    """Drive the worker's waits with a virtual clock instead of real sleeps."""

    def __init__(self, clock, steps):
        self.clock = clock
        self.steps = iter(steps)
        self.delays = []

    def clear(self):
        pass

    def set(self):
        pass

    def wait(self, delay):
        self.delays.append(delay)
        if delay is not None:
            self.clock[0] += delay
        next(self.steps)()


def test_auto_updates_repeat_without_a_browser_and_retry_after_failure(tmp_path, monkeypatch):
    runtime = AppRuntime(settings(tmp_path))
    clock = [100.0]
    monkeypatch.setattr("runtime.time.monotonic", lambda: clock[0])
    calls = []

    def update():
        calls.append(clock[0])
        clock[0] += 15  # Each hourly delay begins after the attempt finishes.
        return {"success": len(calls) > 1, "message": "Download unavailable"}

    monkeypatch.setattr(runtime.geo_database, "update", update)
    wake = ScheduledWake(clock, [lambda: None, runtime.stop_event.set])
    runtime._geoip_update_wake = wake
    runtime._geoip_update_loop()

    assert calls == [100, 100 + 15 + GEOIP_UPDATE_INTERVAL_SECONDS]
    assert wake.delays == [GEOIP_UPDATE_INTERVAL_SECONDS] * 2


def test_scheduler_obeys_live_disable_and_enable(tmp_path, monkeypatch):
    PreferenceStore(tmp_path / "settings.json").save(Preferences(geoip_auto_update=False))
    runtime = AppRuntime(settings(tmp_path))
    clock = [100.0]
    monkeypatch.setattr("runtime.time.monotonic", lambda: clock[0])
    calls = []

    def update():
        calls.append(clock[0])
        runtime.toggle_geoip_auto_update()  # Disable while an attempt is finishing.
        return {"success": True}

    monkeypatch.setattr(runtime.geo_database, "update", update)
    runtime._geoip_update_wake = ScheduledWake(
        clock,
        [
            runtime.toggle_geoip_auto_update,
            runtime.toggle_geoip_auto_update,
            runtime.stop_event.set,
        ],
    )
    runtime._geoip_update_loop()

    assert calls == [100, 100]
    assert runtime._geoip_update_wake.delays == [None, None, None]


@pytest.mark.parametrize("auto_update", [True, False])
def test_runtime_owns_scheduler_and_wakes_it_on_shutdown(tmp_path, monkeypatch, auto_update):
    runtime = AppRuntime(settings(tmp_path, BPM_GEOIP_AUTO_UPDATE=str(auto_update).lower()))
    disable_unrelated_workers(runtime, monkeypatch)
    waiting = threading.Event()
    original_wait = runtime._geoip_update_wake.wait
    calls = []

    def wait(delay):
        waiting.set()
        return original_wait(delay)

    def update():
        calls.append(True)
        return {"success": True}

    monkeypatch.setattr(runtime._geoip_update_wake, "wait", wait)
    monkeypatch.setattr(runtime.geo_database, "update", update)
    runtime.start()
    try:
        assert waiting.wait(2)
        assert len(calls) == int(auto_update)
        assert runtime._geoip_update_thread.is_alive()
    finally:
        runtime.stop()
    assert not runtime._geoip_update_thread.is_alive()


def test_disabled_database_does_not_start_scheduler(tmp_path, monkeypatch):
    runtime = AppRuntime(settings(tmp_path, BPM_GEOIP_ENABLED="false"))
    disable_unrelated_workers(runtime, monkeypatch)
    monkeypatch.setattr(runtime.geo_database, "update", lambda: pytest.fail("database disabled"))
    runtime.start()
    try:
        runtime.toggle_geoip_auto_update()
        runtime.toggle_geoip_auto_update()
        assert runtime._geoip_update_thread is None
    finally:
        runtime.stop()


@pytest.mark.parametrize("database_enabled", ["true", "false"])
def test_privacy_endpoint_persists_across_restart_before_peer_lookups(
    tmp_path, monkeypatch, database_enabled
):
    app_settings = settings(
        tmp_path, BPM_GEOIP_AUTO_UPDATE="false", BPM_GEOIP_ENABLED=database_enabled
    )
    runtime = AppRuntime(app_settings)
    disable_unrelated_workers(runtime, monkeypatch)
    with TestClient(create_app(app_settings, runtime)) as client:
        result = client.post("/api/geodb/toggle-db-only")
        assert result.status_code == 200
        assert result.json()["geo_db_only_mode"] is True
        assert client.get("/api/connectivity").json()["geo_db_only_mode"] is True

    restored = AppRuntime(app_settings)
    assert restored.preferences.geoip_db_only is True
    assert restored.connectivity.snapshot()["geo_db_only_mode"] is True
    disable_unrelated_workers(restored, monkeypatch)

    def lookup_at_start():
        monkeypatch.setattr(
            restored.rpc,
            "call",
            lambda *args: [{"id": 1, "addr": "8.8.8.8:8333", "network": "ipv4"}],
        )
        monkeypatch.setattr(restored.peers, "_fetch_geo", lambda host: pytest.fail("privacy leak"))
        assert restored.peers.refresh_once()
        assert not restored.peers._resolve_geo(*restored.peers._geo_queue.get_nowait())

    monkeypatch.setattr(restored.peers, "start", lookup_at_start)
    with TestClient(create_app(app_settings, restored)) as client:
        assert client.post("/api/geodb/toggle-db-only").json()["geo_db_only_mode"] is False
    assert AppRuntime(app_settings).connectivity.snapshot()["geo_db_only_mode"] is False


@pytest.mark.parametrize("method", ["toggle_geoip_api", "toggle_geoip_auto_update"])
def test_failed_preference_write_does_not_change_live_settings(tmp_path, monkeypatch, method):
    runtime = AppRuntime(settings(tmp_path))
    before = runtime.preferences

    def failed_save(preferences):
        raise OSError("Disk full")

    monkeypatch.setattr(runtime.preferences_store, "save", failed_save)
    with pytest.raises(OSError, match="Disk full"):
        getattr(runtime, method)()
    assert runtime.preferences == before
    assert runtime.connectivity.snapshot()["geo_db_only_mode"] is False


def test_concurrent_preference_changes_preserve_both_flags(tmp_path):
    runtime = AppRuntime(settings(tmp_path))
    with ThreadPoolExecutor(max_workers=2) as pool:
        privacy = pool.submit(runtime.toggle_geoip_api)
        updates = pool.submit(runtime.toggle_geoip_auto_update)
        assert privacy.result() is True
        assert updates.result() is False
    assert PreferenceStore(tmp_path / "settings.json").load() == Preferences(
        geoip_auto_update=False, geoip_db_only=True
    )
