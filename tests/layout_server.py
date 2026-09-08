"""Small ASGI server for browser layout regression tests."""

from __future__ import annotations

import os
import threading
import time
from pathlib import Path
from typing import Any

import uvicorn

from app import create_app
from settings import AppSettings


def _peer(
    peer_id: int,
    network: str,
    address: str,
    city: str,
    region: str,
    country: str,
    continent: str,
    lat: float,
    lon: float,
    asn: str = "",
    provider: str = "",
) -> dict[str, Any]:
    is_private = network in {"onion", "i2p", "cjdns"}
    now = int(time.time())
    return {
        "id": peer_id,
        "network": network,
        "addr": address,
        "ip": address.rsplit(":", 1)[0],
        "port": int(address.rsplit(":", 1)[1]) if ":" in address and not is_private else 8333,
        "direction": "IN" if peer_id % 2 else "OUT",
        "connection_type": "inbound" if peer_id % 2 else "manual",
        "conntime": now - (peer_id * 137),
        "conntime_fmt": f"{peer_id + 2}m",
        "subver": "/Satoshi:29.1.0/",
        "services": ["NETWORK", "WITNESS", "NETWORK_LIMITED", "P2P_V2"],
        "services_abbrev": "N W NL P",
        "city": city,
        "region": region,
        "regionName": region,
        "country": country,
        "countryCode": country[:2].upper() if country else "",
        "continent": continent,
        "continentCode": continent[:2].upper() if continent else "",
        "isp": provider or "Privacy overlay",
        "org": provider,
        "as": asn,
        "asname": provider,
        "lat": lat,
        "lon": lon,
        "location_status": "private" if is_private else "ok",
        "ping_ms": 40 + peer_id,
        "bytessent": peer_id * 100000,
        "bytesrecv": peer_id * 120000,
        "bytessent_fmt": f"{peer_id * 100}KB",
        "bytesrecv_fmt": f"{peer_id * 120}KB",
        "in_addrman": peer_id % 3 == 0,
        "hosting": not is_private,
        "mobile": False,
        "proxy": is_private,
    }


PEERS = [
    _peer(
        1,
        "ipv4",
        "216.82.192.186:8333",
        "Dallas",
        "Texas",
        "United States",
        "North America",
        32.78,
        -96.8,
        "AS1",
        "Thin-nology",
    ),
    _peer(
        2,
        "ipv4",
        "198.251.68.201:8333",
        "Sulphur",
        "Texas",
        "United States",
        "North America",
        33.14,
        -95.6,
        "AS2",
        "IONOS SE",
    ),
    _peer(
        3,
        "ipv4",
        "82.67.102.15:8333",
        "Caen",
        "Normandy",
        "France",
        "Europe",
        49.18,
        -0.37,
        "AS3",
        "Proxad",
    ),
    _peer(
        4,
        "ipv4",
        "47.234.180.43:8333",
        "El Paso",
        "Texas",
        "United States",
        "North America",
        31.76,
        -106.49,
        "AS4",
        "Charter",
    ),
    _peer(
        5,
        "ipv4",
        "85.242.9.29:8333",
        "Faro",
        "Faro",
        "Portugal",
        "Europe",
        37.02,
        -7.93,
        "AS5",
        "PT Comunicacoes",
    ),
    _peer(
        6,
        "ipv4",
        "188.27.109.104:8333",
        "Bucharest",
        "Bucharest",
        "Romania",
        "Europe",
        44.43,
        26.1,
        "AS6",
        "RCS & RDS",
    ),
    _peer(
        7,
        "ipv4",
        "159.195.111.12:8333",
        "Vienna",
        "Vienna",
        "Austria",
        "Europe",
        48.21,
        16.37,
        "AS7",
        "A1 Telekom",
    ),
    _peer(
        8,
        "ipv4",
        "37.27.173.171:8333",
        "Helsinki",
        "Uusimaa",
        "Finland",
        "Europe",
        60.17,
        24.94,
        "AS8",
        "Hetzner",
    ),
    _peer(
        9,
        "ipv6",
        "[2001:db8::9]:8333",
        "Tallinn",
        "Harjumaa",
        "Estonia",
        "Europe",
        59.44,
        24.75,
        "AS9",
        "Telia Eesti",
    ),
    _peer(
        10,
        "ipv6",
        "[2001:db8::10]:8333",
        "Sydney",
        "New South Wales",
        "Australia",
        "Oceania",
        -33.87,
        151.21,
        "AS10",
        "TCR Holdings",
    ),
    _peer(11, "onion", "peer11abcdefghijklmnopqrstuvwxyz.onion:8333", "", "", "", "", 0, 0),
    _peer(12, "onion", "peer12abcdefghijklmnopqrstuvwxyz.onion:8333", "", "", "", "", 0, 0),
    _peer(13, "i2p", "peer13abcdefghijklmnopqrstuvwxyz.b32.i2p:0", "", "", "", "", 0, 0),
    _peer(14, "cjdns", "[fc00::14]:8333", "", "", "", "", 0, 0),
]


class FakeMetrics:
    def summary(self) -> dict[str, Any]:
        return {
            "cpu_pct": 9.0,
            "mem_pct": 20.0,
            "mem_used_mb": 256,
            "mem_total_mb": 1024,
        }

    def latest(self) -> dict[str, Any]:
        return {
            "rx_bps": 32400,
            "tx_bps": 6400,
            "cpu_pct": 9.0,
            "mem_pct": 20.0,
            "mem_used_mb": 256,
            "mem_total_mb": 1024,
            "ts": time.time(),
        }


class FakeConnectivity:
    def snapshot(self) -> dict[str, Any]:
        return {
            "internet_state": "green",
            "api_available": True,
            "api_consecutive_failures": 0,
            "last_price_error": None,
            "last_known_price": "77203.48",
            "last_price_currency": "USD",
            "geo_db_only_mode": False,
            "api_down_prompt": False,
        }

    def acknowledge_prompt(self) -> None:
        return None

    def toggle_geoip_api(self) -> bool:
        return False


class FakePeers:
    def list_peers(self) -> list[dict[str, Any]]:
        return PEERS


class FakeNode:
    def dashboard_info(self, currency: str = "USD") -> dict[str, Any]:
        currency = currency.upper()
        return {
            "btc_price": 77203.48,
            "btc_currency": currency,
            "last_block": {"height": 875000, "time": int(time.time()) - 600},
            "blockchain": {
                "size_gb": 710.4,
                "pruned": False,
                "indexed": True,
                "ibd": False,
            },
            "network_scores": {"ipv4": 10, "ipv6": 1},
            "geo_db_stats": {
                "status": "ok",
                "entries": 128,
                "size_bytes": 4096,
                "newest_age_seconds": 60,
                "oldest_age_days": 5,
                "auto_lookup": True,
                "auto_update": False,
                "db_only_mode": False,
            },
            "connected": len(PEERS),
            "mempool_size": 1200,
            "subversion": "/Satoshi:29.1.0/",
            "last_known_price": "77203.48",
            "last_price_currency": currency,
            "last_price_error": None,
            "internet_state": "green",
            "api_available": True,
            "geo_db_only_mode": False,
        }

    def mempool(self, currency: str = "USD") -> dict[str, Any]:
        return {"mempool": {"size": 1200, "bytes": 2400000}, "btc_price": 77203.48, "error": None}

    def blockchain(self) -> dict[str, Any]:
        return {"blockchain": {"chain": "main", "blocks": 875000, "headers": 875000}, "error": None}

    def recent_blocks(self, limit: int = 25) -> dict[str, Any]:
        now = int(time.time())
        count = min(limit, 2)
        blocks = [
            {
                "height": 875000 - offset,
                "hash": f"{'0' * 56}{875000 - offset:08x}",
                "time": now - (offset * 600),
                "age_seconds": offset * 600,
                "size": 1_500_000 - (offset * 100_000),
                "size_mb": 1.5 - (offset * 0.1),
                "weight": 3_900_000 - (offset * 100_000),
                "tx_count": 3200 - (offset * 200),
                "version": 536870912,
                "difficulty": 123_456_789_012_345,
            }
            for offset in range(count)
        ]
        return {
            "success": True,
            "summary": {
                "chain": "main",
                "tip_height": 875000,
                "count": count,
                "latest_time": blocks[0]["time"],
                "total_size": sum(block["size"] for block in blocks),
                "avg_size_mb": 1.45,
                "total_transactions": sum(block["tx_count"] for block in blocks),
                "avg_transactions": 3100,
                "generated_at": now,
            },
            "blocks": blocks,
            "error": None,
        }

    def chain_tips(self) -> dict[str, Any]:
        now = int(time.time())
        tips = [
            {
                "height": 875000,
                "hash": f"{'0' * 56}{875000:08x}",
                "branch_length": 0,
                "status": "active",
                "status_label": "Active",
                "time": now - 300,
                "age_seconds": 300,
                "is_active": True,
            },
            {
                "height": 874998,
                "hash": f"{'1' * 56}{874998:08x}",
                "branch_length": 1,
                "status": "valid-fork",
                "status_label": "Valid Fork",
                "time": now - 1200,
                "age_seconds": 1200,
                "is_active": False,
            },
        ]
        return {
            "success": True,
            "summary": {
                "chain": "main",
                "best_height": 875000,
                "best_hash": tips[0]["hash"],
                "total": 2,
                "active_count": 1,
                "non_active_count": 1,
                "fork_count": 1,
                "headers_only_count": 0,
                "latest_non_active_height": 874998,
                "latest_non_active_status": "valid-fork",
                "counts_by_status": {"active": 1, "valid-fork": 1},
                "age_lookup_limited": False,
                "age_lookup_limit": 100,
                "generated_at": now,
            },
            "tips": tips,
            "error": None,
        }


class FakeGeoDatabase:
    def update(self) -> dict[str, Any]:
        return {"success": True, "message": "DB already up to date"}


class FakeRuntime:
    def __init__(self, settings: AppSettings):
        self.settings = settings
        self.stop_event = threading.Event()
        self.metrics = FakeMetrics()
        self.connectivity = FakeConnectivity()
        self.peers = FakePeers()
        self.node = FakeNode()
        self.geo_database = FakeGeoDatabase()

    def start(self) -> None:
        return None

    def stop(self) -> None:
        self.stop_event.set()

    def toggle_geoip_auto_update(self) -> bool:
        return False


def main() -> None:
    data_dir = Path(os.environ.get("BPM_LAYOUT_TEST_DATA_DIR", "/tmp/bpm-layout-test"))
    host = os.environ.get("BPM_LAYOUT_TEST_HOST", "127.0.0.1")
    port = int(os.environ.get("BPM_LAYOUT_TEST_PORT", "58991"))
    settings = AppSettings.from_env(
        {
            "BITCOIN_RPC_HOST": "bitcoin",
            "BITCOIN_RPC_USER": "bpm",
            "BITCOIN_RPC_PASSWORD": "secret",
            "BPM_DATA_DIR": str(data_dir),
            "BPM_BUILD_REVISION": "abcdef0123456789",
        }
    )
    uvicorn.run(create_app(settings, FakeRuntime(settings)), host=host, port=port)


if __name__ == "__main__":
    main()
