from typing import Any

from rpc import RpcError
from services.node import NodeService


class Connectivity:
    def fetch_price(self, currency: str) -> float:
        del currency
        return 0.0

    def snapshot(self) -> dict[str, Any]:
        return {}


class GeoDatabase:
    enabled = True

    def stats(self) -> dict[str, Any]:
        return {}


class ChainTipsRpc:
    def __init__(self):
        self.calls: list[tuple[str, tuple[Any, ...]]] = []

    def call(self, method: str, *params: Any, **kwargs: Any) -> Any:
        del kwargs
        self.calls.append((method, params))
        if method == "getchaintips":
            return [
                {"height": 98, "hash": "headers-hash", "branchlen": 1, "status": "headers-only"},
                {"height": 101, "hash": "active-hash", "branchlen": 0, "status": "active"},
                {"height": 99, "hash": "fork-hash", "branchlen": 2, "status": "valid-fork"},
            ]
        if method == "getblockchaininfo":
            return {"chain": "main", "blocks": 101, "bestblockhash": "active-hash"}
        if method == "getblockheader":
            times = {
                "active-hash": 1_700_000_101,
                "fork-hash": 1_700_000_099,
                "headers-hash": 1_700_000_098,
            }
            return {"time": times[params[0]]}
        raise AssertionError(f"unexpected RPC method {method}")


class ErrorRpc:
    def call(self, method: str, *params: Any, **kwargs: Any) -> Any:
        del method, params, kwargs
        raise RpcError("rpc unavailable")


def test_chain_tips_sorts_active_tip_first_and_counts_statuses(monkeypatch) -> None:
    monkeypatch.setattr("services.node.time.time", lambda: 1_700_000_200)
    rpc = ChainTipsRpc()
    service = NodeService(rpc, Connectivity(), GeoDatabase(), lambda: True)

    result = service.chain_tips()

    assert result["success"] is True
    assert result["error"] is None
    assert [tip["status"] for tip in result["tips"]] == [
        "active",
        "valid-fork",
        "headers-only",
    ]
    assert result["tips"][0]["age_seconds"] == 99
    assert result["summary"]["chain"] == "main"
    assert result["summary"]["best_height"] == 101
    assert result["summary"]["best_hash"] == "active-hash"
    assert result["summary"]["total"] == 3
    assert result["summary"]["active_count"] == 1
    assert result["summary"]["non_active_count"] == 2
    assert result["summary"]["fork_count"] == 1
    assert result["summary"]["headers_only_count"] == 1
    assert result["summary"]["latest_non_active_height"] == 99
    assert result["summary"]["latest_non_active_status"] == "valid-fork"
    assert result["summary"]["counts_by_status"] == {
        "headers-only": 1,
        "active": 1,
        "valid-fork": 1,
    }
    assert result["summary"]["age_lookup_limited"] is False
    assert [params[0] for method, params in rpc.calls if method == "getblockheader"] == [
        "active-hash",
        "fork-hash",
        "headers-hash",
    ]


def test_chain_tips_reuses_cached_header_times(monkeypatch) -> None:
    monkeypatch.setattr("services.node.time.time", lambda: 1_700_000_200)
    rpc = ChainTipsRpc()
    service = NodeService(rpc, Connectivity(), GeoDatabase(), lambda: True)

    first = service.chain_tips()
    second = service.chain_tips()

    assert first["tips"] == second["tips"]
    assert sum(method == "getchaintips" for method, _params in rpc.calls) == 2
    assert sum(method == "getblockchaininfo" for method, _params in rpc.calls) == 2
    assert sum(method == "getblockheader" for method, _params in rpc.calls) == 3


def test_chain_tips_bounds_header_lookups() -> None:
    class ManyTipsRpc:
        def __init__(self):
            self.header_calls = 0

        def call(self, method: str, *params: Any, **kwargs: Any) -> Any:
            del kwargs
            if method == "getchaintips":
                return [
                    {
                        "height": 10_000 - index,
                        "hash": f"hash-{index}",
                        "branchlen": index,
                        "status": "active" if index == 0 else "valid-fork",
                    }
                    for index in range(105)
                ]
            if method == "getblockchaininfo":
                return {"chain": "main", "blocks": 10_000, "bestblockhash": "hash-0"}
            if method == "getblockheader":
                self.header_calls += 1
                return {"time": 1_700_000_000}
            raise AssertionError(f"unexpected RPC method {method}")

    rpc = ManyTipsRpc()
    service = NodeService(rpc, Connectivity(), GeoDatabase(), lambda: True)

    result = service.chain_tips()

    assert result["success"] is True
    assert result["summary"]["total"] == 105
    assert result["summary"]["age_lookup_limited"] is True
    assert result["summary"]["age_lookup_limit"] == 100
    assert rpc.header_calls == 100
    assert sum(tip["time"] is None for tip in result["tips"]) == 5


def test_chain_tips_reports_rpc_errors() -> None:
    service = NodeService(ErrorRpc(), Connectivity(), GeoDatabase(), lambda: True)

    result = service.chain_tips()

    assert result == {
        "success": False,
        "summary": None,
        "tips": [],
        "error": "rpc unavailable",
    }
