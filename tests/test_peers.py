import threading
from pathlib import Path
from typing import Any

import pytest

from rpc import RpcError, RpcTransportError
from services.connectivity import ConnectivityService
from services.geoip import GeoDatabase
from services.peers import PeerService


class FakeRpc:
    result: Any = []

    def call(self, method: str) -> Any:
        assert method == "getpeerinfo"
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


@pytest.fixture
def service(tmp_path: Path) -> PeerService:
    stop = threading.Event()
    rpc: Any = FakeRpc()
    return PeerService(rpc, GeoDatabase(tmp_path, False), ConnectivityService(stop), stop)


def test_snapshot_preserves_peers_on_failure_and_recovers_to_zero(service, monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr("services.peers.time.time", lambda: clock[0])
    initial = service.snapshot()
    assert initial["peers"] == []
    assert initial["status"]["connected"] is None
    assert initial["status"]["last_success_at"] is None
    assert initial["status"]["age_seconds"] is None

    service.rpc.result = [{"id": 7, "addr": "127.0.0.1:8333", "conntime": 900}]
    assert service.refresh_once() is True
    successful = service.snapshot()
    assert successful["status"]["connected"] is True
    assert successful["status"]["last_success_at"] == 1000

    clock[0] = 1010
    service.rpc.result = RpcTransportError("node unavailable")
    assert service.refresh_once() is False
    failed = service.snapshot()
    assert failed["peers"] == successful["peers"]
    assert service.list_peers() == successful["peers"]
    assert failed["status"]["connected"] is False
    assert failed["status"]["last_success_at"] == 1000
    assert failed["status"]["last_attempt_at"] == 1010
    assert failed["status"]["age_seconds"] == 10
    assert failed["status"]["error"]

    clock[0] = 1020
    assert service.refresh_once() is False
    assert service.snapshot()["status"]["age_seconds"] == 20

    clock[0] = 1030
    service.rpc.result = []
    assert service.refresh_once() is True
    recovered = service.snapshot()
    assert recovered["peers"] == []
    assert recovered["status"]["connected"] is True
    assert recovered["status"]["last_success_at"] == 1030
    assert recovered["status"]["age_seconds"] == 0
    assert recovered["status"]["error"] is None


@pytest.mark.parametrize("name", ["BLAKE2B?", "BLAKE2B"])
def test_blake2b_service_flag_is_abbreviated(service, name):
    service.rpc.result = [
        {
            "id": 7,
            "addr": "127.0.0.1:8333",
            "servicesnames": ["NETWORK", name],
        }
    ]
    assert service.refresh_once() is True
    peer = service.snapshot()["peers"][0]
    assert peer["services"] == ["NETWORK", name]
    assert peer["services_abbrev"] == "N BL"


@pytest.mark.parametrize("result", [None, {}, ["invalid peer"], RpcError("RPC failed")])
def test_first_failed_poll_is_distinct_from_successful_zero_peers(service, result):
    service.rpc.result = result
    assert service.refresh_once() is False
    snapshot = service.snapshot()
    assert snapshot["status"]["connected"] is False
    assert snapshot["status"]["last_success_at"] is None
    assert snapshot["status"]["age_seconds"] is None


def test_invalid_response_does_not_replace_successful_snapshot(service):
    service.rpc.result = [{"id": 7, "addr": "127.0.0.1:8333"}]
    service.refresh_once()
    previous = service.snapshot()
    service.rpc.result = {"unexpected": "response"}
    assert service.refresh_once() is False
    assert service.snapshot()["peers"] == previous["peers"]


def public_peer(service):
    service.rpc.result = [{"id": 1, "addr": "8.8.8.8:8333", "network": "ipv4"}]
    service.refresh_once()


def resolve_next(service):
    host, network = service._geo_queue.get_nowait()
    return service._resolve_geo(host, network)


def test_failed_geo_lookup_expires_and_recovers(service, monkeypatch):
    clock = [100.0]
    monkeypatch.setattr("services.peers.time.monotonic", lambda: clock[0])
    attempts = []

    def fetch(host):
        attempts.append(host)
        return (
            None
            if len(attempts) == 1
            else {"lat": -36.85, "lon": 174.76, "country": "New Zealand", "city": "Auckland"}
        )

    monkeypatch.setattr(service, "_fetch_geo", fetch)
    public_peer(service)
    assert resolve_next(service)
    assert service.snapshot()["peers"][0]["location_status"] == "unavailable"
    clock[0] = 159.99
    public_peer(service)
    assert service._geo_queue.empty()
    clock[0] = 160
    public_peer(service)
    public_peer(service)
    assert service._geo_queue.qsize() == 1
    assert resolve_next(service)
    assert attempts == ["8.8.8.8", "8.8.8.8"]
    assert service.snapshot()["peers"][0]["city"] == "Auckland"


def test_geo_database_generation_invalidates_negative_cache(service, monkeypatch):
    monkeypatch.setattr(service, "_fetch_geo", lambda host: None)
    public_peer(service)
    resolve_next(service)
    monkeypatch.setattr(
        service.geo_database,
        "get",
        lambda host: {"lat": -36.85, "lon": 174.76, "country": "New Zealand", "city": "Auckland"},
    )
    service.geo_database.dataset_changed()
    public_peer(service)
    assert not resolve_next(service)
    assert service.snapshot()["peers"][0]["city"] == "Auckland"


def test_geo_skips_departed_peers_and_prunes_memory(service, monkeypatch):
    monkeypatch.setattr(service, "_fetch_geo", lambda host: pytest.fail("obsolete request"))
    public_peer(service)
    service.rpc.result = []
    service.refresh_once()
    assert not resolve_next(service)
    assert not service._pending
    assert not service._geo_cache


def test_geo_reads_database_even_when_api_is_disabled(service, monkeypatch):
    service.connectivity.toggle_geoip_api()
    monkeypatch.setattr(service, "_fetch_geo", lambda host: pytest.fail("API disabled"))
    monkeypatch.setattr(
        service.geo_database,
        "get",
        lambda host: {"lat": -36.85, "lon": 174.76, "country": "New Zealand", "city": "Auckland"},
    )
    public_peer(service)
    assert not resolve_next(service)
    assert service.snapshot()["peers"][0]["city"] == "Auckland"


def test_geo_does_not_install_result_from_old_dataset_generation(service, monkeypatch):
    def fetch(host):
        service.geo_database.dataset_changed()
        return {"lat": 1, "lon": 1, "country": "Old", "city": "Old"}

    monkeypatch.setattr(service, "_fetch_geo", fetch)
    public_peer(service)
    resolve_next(service)
    assert service.cached_geo("8.8.8.8") is None
    public_peer(service)
    assert service._geo_queue.qsize() == 1
