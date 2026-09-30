"""Composition root for application services and worker lifecycle."""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import replace

from preferences import PreferenceStore
from rpc import BitcoinRpcClient
from services.connectivity import ConnectivityService
from services.geoip import GeoDatabase
from services.node import NodeService
from services.peers import PeerService
from services.system_metrics import SystemMetrics
from settings import AppSettings

GEOIP_UPDATE_INTERVAL_SECONDS = 60 * 60
logger = logging.getLogger(__name__)


class AppRuntime:
    def __init__(self, settings: AppSettings):
        self.settings = settings
        self.stop_event = threading.Event()
        self.preferences_store = PreferenceStore(settings.data_dir / "settings.json")
        self.preferences = self.preferences_store.load()
        self._preferences_lock = threading.Lock()
        if settings.geoip_auto_update_override is not None:
            self.preferences.geoip_auto_update = settings.geoip_auto_update_override

        self.rpc = BitcoinRpcClient(settings)
        self.geo_database = GeoDatabase(settings.data_dir, settings.geoip_enabled)
        self.connectivity = ConnectivityService(
            self.stop_event, geoip_api_disabled=self.preferences.geoip_db_only
        )
        self.metrics = SystemMetrics(self.stop_event)
        self.peers = PeerService(
            self.rpc,
            self.geo_database,
            self.connectivity,
            self.stop_event,
        )
        self.node = NodeService(
            self.rpc,
            self.connectivity,
            self.geo_database,
            lambda: self.preferences.geoip_auto_update,
        )
        self._geoip_update_thread: threading.Thread | None = None
        self._geoip_update_wake = threading.Event()

    def start(self) -> None:
        self.settings.data_dir.mkdir(parents=True, exist_ok=True)
        self.preferences_store.save(self.preferences)
        self.geo_database.initialize()
        self.metrics.start()
        self.peers.start()
        if self.geo_database.enabled:
            self._geoip_update_thread = threading.Thread(
                target=self._geoip_update_loop,
                daemon=True,
                name="geoip-dataset-update",
            )
            self._geoip_update_thread.start()

    def stop(self) -> None:
        self.stop_event.set()
        self._geoip_update_wake.set()
        self.peers.stop()
        self.metrics.stop()
        self.connectivity.stop()
        if self._geoip_update_thread:
            self._geoip_update_thread.join(timeout=2)

    def toggle_geoip_auto_update(self) -> bool:
        with self._preferences_lock:
            preferences = replace(
                self.preferences, geoip_auto_update=not self.preferences.geoip_auto_update
            )
            self.preferences_store.save(preferences)
            self.preferences = preferences
            self._geoip_update_wake.set()
            return preferences.geoip_auto_update

    def toggle_geoip_api(self) -> bool:
        with self._preferences_lock:
            preferences = replace(
                self.preferences, geoip_db_only=not self.preferences.geoip_db_only
            )
            self.preferences_store.save(preferences)
            self.preferences = preferences
            self.connectivity.set_geoip_api_disabled(preferences.geoip_db_only)
            return preferences.geoip_db_only

    def _geoip_update_loop(self) -> None:
        """Refresh once at startup, then hourly, independently of browser clients."""
        next_update = 0.0
        while not self.stop_event.is_set():
            # Clear before reading preferences so a concurrent toggle is not lost.
            self._geoip_update_wake.clear()
            with self._preferences_lock:
                enabled = self.preferences.geoip_auto_update
            if self.stop_event.is_set():
                return
            if enabled:
                delay = next_update - time.monotonic()
                if delay <= 0:
                    result = self.geo_database.update()
                    if not result["success"]:
                        logger.warning("Automatic GeoIP update failed: %s", result["message"])
                    next_update = time.monotonic() + GEOIP_UPDATE_INTERVAL_SECONDS
                    continue
            else:
                next_update = 0.0
                delay = None
            self._geoip_update_wake.wait(delay)
