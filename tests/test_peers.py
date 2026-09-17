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
