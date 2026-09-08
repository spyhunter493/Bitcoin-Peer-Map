from typing import Any

from rpc import RpcError
from services.node import NodeService


class Rpc:
    def __init__(self):
        self.net_totals = {"totalbytesrecv": 1000, "totalbytessent": 2000}

    def call(self, method: str, *params: Any, **kwargs: Any) -> Any:
        del params, kwargs
        responses = {
            "getbestblockhash": "block-hash",
            "getblockheader": {"height": 1, "time": 2},
            "getblockchaininfo": {},
            "getindexinfo": {},
            "getnetworkinfo": {
                "connections": 3,
                "networks": [
                    {"name": "ipv4", "limited": False, "reachable": True, "proxy": ""},
                    {"name": "ipv6", "limited": True, "reachable": False, "proxy": ""},
                    {
                        "name": "onion",
                        "limited": False,
                        "reachable": True,
                        "proxy": "127.0.0.1:9050",
                    },
                    {"name": "i2p", "limited": False, "reachable": True, "proxy": ""},
                    {"name": "cjdns", "limited": False, "reachable": True, "proxy": ""},
                ],
                "localaddresses": [
                    {"address": "203.0.113.2", "port": 8333, "score": 1},
                    {"address": "203.0.113.1", "port": 8333, "score": 9},
                    {"address": "2001:db8::1", "port": 8333, "score": 4},
                    {"address": "abcdefghijklmnop.onion", "port": 8333, "score": 3},
                    {"address": "node.example.i2p", "port": 0, "score": 2},
                    {"address": "fc00::1", "port": 8333, "score": 5},
                ],
            },
            "getnettotals": self.net_totals,
            "getmempoolinfo": {"size": 4},
        }
        return responses[method]


class Connectivity:
    def __init__(self):
        self.price_fetched = False

    def fetch_price(self, currency: str) -> float:
        assert currency == "NZD"
        self.price_fetched = True
        return 123.45

    def snapshot(self) -> dict[str, Any]:
        assert self.price_fetched
        return {
            "last_known_price": "123.45",
            "last_price_currency": "NZD",
            "last_price_error": None,
            "internet_state": "green",
            "api_available": True,
            "geo_db_only_mode": False,
        }


class GeoDatabase:
    enabled = True

    def stats(self) -> dict[str, Any]:
        return {"status": "ok", "entries": 0}


class BlocksRpc:
    def __init__(self):
        self.tip_height = 101
        self.calls: list[tuple[str, tuple[Any, ...]]] = []

    def call(self, method: str, *params: Any, **kwargs: Any) -> Any:
        del kwargs
        self.calls.append((method, params))
        if method == "getblockchaininfo":
            return {
                "chain": "main",
                "blocks": self.tip_height,
                "bestblockhash": f"hash-{self.tip_height}",
            }
        if method == "getblock":
            height = int(str(params[0]).split("-")[1])
            return {
                "height": height,
                "time": 1_700_000_000 + height,
                "size": height * 1000,
                "weight": height * 4000,
                "nTx": height - 90,
                "version": 536870912,
                "difficulty": 123_456_789_012_345,
                "previousblockhash": f"hash-{height - 1}" if height else None,
            }
        raise AssertionError(f"unexpected RPC method {method}")


class ErrorRpc:
    def call(self, method: str, *params: Any, **kwargs: Any) -> Any:
        del method, params, kwargs
        raise RpcError("rpc unavailable")


def test_dashboard_info_snapshots_connectivity_after_price_fetch() -> None:
    rpc = Rpc()
    service = NodeService(rpc, Connectivity(), GeoDatabase(), lambda: True)

    result = service.dashboard_info("nzd")

    assert result["btc_price"] == 123.45
    assert result["last_known_price"] == "123.45"
    assert result["last_price_currency"] == "NZD"
    assert result["network_scores"] == {"ipv4": 9, "ipv6": 4}
    assert result["network_details"]["ipv4"] == {
        "reachable": True,
        "limited": False,
        "proxy": "",
        "localaddresses": [
            {"address": "203.0.113.1", "port": 8333, "score": 9},
            {"address": "203.0.113.2", "port": 8333, "score": 1},
        ],
    }
    assert result["network_details"]["ipv6"]["reachable"] is False
    assert result["network_details"]["onion"]["proxy"] == "127.0.0.1:9050"
    assert result["network_details"]["onion"]["localaddresses"][0]["address"].endswith(".onion")
    assert result["network_details"]["i2p"]["localaddresses"][0]["address"].endswith(".i2p")
    assert result["network_details"]["cjdns"]["localaddresses"][0]["address"] == "fc00::1"
    assert result["node_traffic"] == {
        "download_bytes": 0,
        "upload_bytes": 0,
        "download_fmt": "0B",
        "upload_fmt": "0B",
    }

    rpc.net_totals = {"totalbytesrecv": 2536, "totalbytessent": 7120}
    result = service.dashboard_info("nzd")

    assert result["node_traffic"] == {
        "download_bytes": 1536,
        "upload_bytes": 5120,
        "download_fmt": "1.5KB",
        "upload_fmt": "5.0KB",
    }


def test_recent_blocks_returns_tip_first_with_summary(monkeypatch) -> None:
    monkeypatch.setattr("services.node.time.time", lambda: 1_700_000_200)
    rpc = BlocksRpc()
    service = NodeService(rpc, Connectivity(), GeoDatabase(), lambda: True)

    result = service.recent_blocks(2)

    assert result["success"] is True
    assert result["error"] is None
    assert [block["height"] for block in result["blocks"]] == [101, 100]
    assert result["blocks"][0]["hash"] == "hash-101"
    assert result["blocks"][0]["age_seconds"] == 99
    assert result["blocks"][1]["tx_count"] == 10
    assert result["summary"]["chain"] == "main"
    assert result["summary"]["tip_height"] == 101
    assert result["summary"]["count"] == 2
    assert result["summary"]["total_size"] == 201000
    assert result["summary"]["total_transactions"] == 21
    assert result["summary"]["avg_transactions"] == 10.5
    assert rpc.calls == [
        ("getblockchaininfo", ()),
        ("getblock", ("hash-101", 1)),
        ("getblock", ("hash-100", 1)),
    ]


def test_recent_blocks_reuses_cached_blocks_and_follows_a_new_tip() -> None:
    rpc = BlocksRpc()
    service = NodeService(rpc, Connectivity(), GeoDatabase(), lambda: True)

    service.recent_blocks(2)
    service.recent_blocks(2)
    rpc.tip_height = 102
    result = service.recent_blocks(2)

    assert [block["height"] for block in result["blocks"]] == [102, 101]
    assert [params[0] for method, params in rpc.calls if method == "getblock"] == [
        "hash-101",
        "hash-100",
        "hash-102",
    ]
    assert sum(method == "getblockchaininfo" for method, _params in rpc.calls) == 3


def test_recent_blocks_reports_rpc_errors() -> None:
    service = NodeService(ErrorRpc(), Connectivity(), GeoDatabase(), lambda: True)

    result = service.recent_blocks(2)

    assert result == {
        "success": False,
        "summary": None,
        "blocks": [],
        "error": "rpc unavailable",
    }
