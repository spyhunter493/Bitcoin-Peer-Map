"""Demand-driven caches share expensive work without coupling prices to node health."""

import threading
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

import requests

from rpc import RpcError
from services.connectivity import ConnectivityService
from services.node import NodeService


class Clock:
    value = 0.0

    def __call__(self):
        return self.value


class Rpc:
    def __init__(self):
        self.calls = Counter()
        self.fail = set()
        self.height = 100
        self.before = lambda method: None

    def call(self, method, *params, **kwargs):
        self.calls[method] += 1
        self.before(method)
        if method in self.fail:
            raise RpcError(f"{method} unavailable")
        return {
            "getblockchaininfo": {"blocks": self.height, "bestblockhash": f"block-{self.height}"},
            "getblockheader": {"height": self.height, "time": 1000},
            "getbestblockhash": f"block-{self.height}",
            "getindexinfo": {},
            "getnetworkinfo": {"connections": self.height, "subversion": "test"},
            "getnettotals": {},
            "getmempoolinfo": {"size": self.height},
        }[method]


class GeoDatabase:
    enabled = True

    def stats(self):
        return {"status": "ok", "entries": 1, "oldest_updated": 100, "last_updated": 200}


class Response:
    def __init__(self, amount):
        self.amount = amount

    def raise_for_status(self):
        pass

    def json(self):
        return {"data": {"amount": self.amount}}


def connectivity(monkeypatch):
    service = ConnectivityService(threading.Event())
    monkeypatch.setattr(service, "_ensure_checker", lambda: None)
    return service


def test_node_cache_shared_across_concurrent_clients_and_currencies(monkeypatch):
    clock = Clock()
    monkeypatch.setattr("services.node.time.monotonic", clock)
    rpc = Rpc()
    entered, release = threading.Event(), threading.Event()

    def before(method):
        if method == "getblockchaininfo":
            entered.set()
            assert release.wait(3)

    rpc.before = before
    service = NodeService(rpc, connectivity(monkeypatch), GeoDatabase(), lambda: False)
    with ThreadPoolExecutor(max_workers=8) as executor:
        futures = [
            executor.submit(service.dashboard_info, currency, False)
            for currency in ["USD", "EUR", "NZD", "usd"] * 2
        ]
        assert entered.wait(3)
        release.set()
        results = [future.result(timeout=3) for future in futures]
    assert all(result["connected"] == 100 for result in results)
    assert "btc_price" not in results[0]
    assert rpc.calls == Counter(
        {
            method: 1
            for method in (
                "getblockchaininfo",
                "getblockheader",
                "getindexinfo",
                "getnetworkinfo",
                "getnettotals",
                "getmempoolinfo",
            )
        }
    )
    # Response mutation must not leak into another client.
    results[0]["last_block"]["height"] = -1
    assert service.dashboard_info(include_price=False)["last_block"]["height"] == 100


def test_expiry_is_measured_from_start_and_failed_fields_are_not_stale(monkeypatch):
    clock = Clock()
    monkeypatch.setattr("services.node.time.monotonic", clock)
    monkeypatch.setattr("services.node.time.time", lambda: 1000 + clock.value * 10)
    rpc = Rpc()
    service = NodeService(rpc, connectivity(monkeypatch), GeoDatabase(), lambda: False)

    def slow_refresh(method):
        if method == "getblockchaininfo":
            clock.value += 4

    rpc.before = slow_refresh
    first = service.dashboard_info(include_price=False)
    assert clock.value == 4
    rpc.before = lambda method: None
    clock.value = 4.999
    cached = service.dashboard_info(include_price=False)
    assert rpc.calls["getblockchaininfo"] == 1
    assert (
        cached["geo_db_stats"]["newest_age_seconds"] > first["geo_db_stats"]["newest_age_seconds"]
    )
    clock.value = 5
    rpc.fail.add("getnetworkinfo")
    refreshed = service.dashboard_info(include_price=False)
    assert rpc.calls["getblockchaininfo"] == 2
    assert rpc.calls["getblockheader"] == 1  # immutable header metadata, same hash
    assert refreshed["connected"] is None
    assert refreshed["network_details"] is None
    assert refreshed["mempool_size"] == 100
    clock.value = 10
    rpc.fail.clear()
    rpc.height = 101
    recovered = service.dashboard_info(include_price=False)
    assert recovered["connected"] == 101
    assert recovered["last_block"]["height"] == 101
    assert rpc.calls["getblockheader"] == 2


def test_blockchain_failure_still_allows_independent_tip_result(monkeypatch):
    rpc = Rpc()
    rpc.fail.add("getblockchaininfo")
    service = NodeService(rpc, connectivity(monkeypatch), GeoDatabase(), lambda: False)
    result = service.dashboard_info(include_price=False)
    assert result["blockchain"] is None
    assert result["last_block"] == {"height": 100, "time": 1000}
    assert result["connected"] == 100


def test_price_expiry_failure_and_recovery_are_currency_local(monkeypatch):
    clock = Clock()
    monkeypatch.setattr("services.connectivity.time.monotonic", clock)
    service = connectivity(monkeypatch)
    calls = Counter()
    failed = set()

    def get(url, **kwargs):
        currency = url.split("BTC-")[1].split("/")[0]
        calls[currency] += 1
        if currency in failed:
            raise requests.Timeout(currency)
        return Response("100" if currency == "USD" else "90")

    monkeypatch.setattr("services.connectivity.requests.get", get)
    assert service.price_info(" usd ")["btc_price"] == 100
    assert service.price_info("EUR")["btc_price"] == 90
    clock.value = 4.999
    assert service.price_info("usd")["btc_price"] == 100
    assert calls == {"USD": 1, "EUR": 1}
    clock.value = 5
    failed.add("USD")
    failed_usd = service.price_info("USD")
    assert failed_usd["btc_price"] == 100
    assert failed_usd["last_known_price"] == "100"
    assert "USD" in failed_usd["last_price_error"]
    assert service.price_info("EUR")["last_price_error"] is None
    assert service.price_info("USD")["last_price_error"] == failed_usd["last_price_error"]
    assert calls == {"USD": 2, "EUR": 2}
    clock.value = 10
    failed.clear()
    assert service.price_info("USD")["last_price_error"] is None
    assert calls["USD"] == 3


def test_concurrent_prices_deduplicate_per_currency_without_blocking_node(monkeypatch):
    clock = Clock()
    monkeypatch.setattr("services.connectivity.time.monotonic", clock)
    prices = connectivity(monkeypatch)
    rpc = Rpc()
    service = NodeService(rpc, prices, GeoDatabase(), lambda: False)
    entered, release = threading.Event(), threading.Event()
    calls = Counter()

    def get(url, **kwargs):
        currency = url.split("BTC-")[1].split("/")[0]
        calls[currency] += 1
        if currency == "USD":
            entered.set()
            assert release.wait(3)
        return Response("100" if currency == "USD" else "90")

    monkeypatch.setattr("services.connectivity.requests.get", get)
    with ThreadPoolExecutor(max_workers=6) as executor:
        old_api = executor.submit(service.dashboard_info, "USD")
        assert entered.wait(3)
        waiting = [executor.submit(service.price, "usd") for _ in range(3)]
        try:
            assert executor.submit(service.price, "EUR").result(timeout=2)["btc_price"] == 90
            assert (
                executor.submit(service.dashboard_info, "USD", False).result(timeout=2)["connected"]
                == 100
            )
        finally:
            release.set()
        assert old_api.result(timeout=3)["btc_price"] == 100
        assert all(future.result(timeout=3)["btc_price"] == 100 for future in waiting)
    assert calls == {"USD": 1, "EUR": 1}
    assert rpc.calls["getblockchaininfo"] == 1


def test_offline_currency_never_borrows_another_currency_price(monkeypatch):
    service = connectivity(monkeypatch)
    monkeypatch.setattr(
        "services.connectivity.requests.get", lambda *args, **kwargs: Response("100")
    )
    service.price_info("USD")
    service.internet_state = "red"
    assert service.price_info("NZD") == {
        "btc_price": None,
        "btc_currency": "NZD",
        "last_known_price": None,
        "last_price_currency": "NZD",
        "last_price_error": None,
    }
