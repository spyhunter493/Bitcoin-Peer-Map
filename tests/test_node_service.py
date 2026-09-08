from typing import Any

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
