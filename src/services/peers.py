"""Peer polling, geolocation enrichment, and in-memory dashboard state."""

from __future__ import annotations

import logging
import queue
import threading
import time
from dataclasses import dataclass
from typing import Any

import requests

from network import (
    abbreviate_connection_type,
    format_bytes,
    format_duration,
    is_private_address,
    is_public_address,
    network_type,
    split_peer_address,
)
from rpc import BitcoinRpcClient, RpcError

from .connectivity import ConnectivityService
from .geoip import GeoDatabase, is_valid_geo_data

GEO_API_URL = "http://ip-api.com/json"
GEO_API_FIELDS = (
    "status,continent,continentCode,country,countryCode,region,regionName,city,"
    "district,zip,lat,lon,timezone,offset,currency,isp,org,as,asname,mobile,"
    "proxy,hosting"
)
REFRESH_INTERVAL_SECONDS = 10
GEO_API_DELAY_SECONDS = 1.5
GEO_RETRY_SECONDS = 60
logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class GeoEntry:
    data: dict[str, Any]
    generation: int
    retry_at: float | None = None


class PeerService:
    def __init__(
        self,
        rpc: BitcoinRpcClient,
        geo_database: GeoDatabase,
        connectivity: ConnectivityService,
        stop_event: threading.Event,
    ):
        self.rpc = rpc
        self.geo_database = geo_database
        self.connectivity = connectivity
        self.stop_event = stop_event

        self._peers: list[dict[str, Any]] = []
        self._peers_lock = threading.Lock()
        self._last_success_at: float | None = None
        self._last_attempt_at: float | None = None
        self._last_error: str | None = None
        self._geo_queue: queue.Queue[tuple[str, str]] = queue.Queue()
        self._pending: set[str] = set()
        self._pending_lock = threading.Lock()
        self._geo_cache: dict[str, GeoEntry] = {}
        self._geo_cache_lock = threading.Lock()
        self._active_hosts: set[str] = set()
        self._known_addresses: set[str] = set()
        self._known_addresses_lock = threading.Lock()
        self._threads: list[threading.Thread] = []

    def start(self) -> None:
        self.refresh_known_addresses()
        self._threads = [
            threading.Thread(target=self._refresh_loop, daemon=True, name="peer-refresh"),
            threading.Thread(target=self._geo_loop, daemon=True, name="geoip-lookup"),
        ]
        for thread in self._threads:
            thread.start()

    def stop(self) -> None:
        for thread in self._threads:
            thread.join(timeout=2)

    def raw_peers(self) -> list[dict[str, Any]]:
        peers = self.rpc.call("getpeerinfo")
        if not isinstance(peers, list) or any(not isinstance(peer, dict) for peer in peers):
            raise RpcError("getpeerinfo returned an unexpected response")
        return peers

    def refresh_once(self) -> bool:
        """Replace the snapshot only after a successful RPC poll, including zero peers."""
        try:
            peers = self.raw_peers()
        except RpcError as exc:
            with self._peers_lock:
                self._last_attempt_at = time.time()
                self._last_error = "Could not refresh peers from the Bitcoin node"
            logger.warning("Peer refresh failed: %s", exc)
            return False

        with self._peers_lock:
            self._peers = peers
            self._last_success_at = time.time()
            self._last_attempt_at = self._last_success_at
            self._last_error = None

        with self._geo_cache_lock:
            self._active_hosts = {split_peer_address(peer.get("addr", ""))[0] for peer in peers}
            self._geo_cache = {
                host: entry for host, entry in self._geo_cache.items() if host in self._active_hosts
            }

        for peer in peers:
            address = peer.get("addr", "")
            peer_network = peer.get("network", network_type(address))
            host, _ = split_peer_address(address)
            if self.cached_geo(host) is None:
                if is_public_address(peer_network, host):
                    self.queue_geo_lookup(host, peer_network)
                else:
                    self._cache_private_address(host)
        return True

    def refresh_known_addresses(self) -> None:
        try:
            addresses = self.rpc.call("getnodeaddresses", 0)
        except RpcError:
            return
        known = {item.get("address", "") for item in addresses or [] if item.get("address")}
        with self._known_addresses_lock:
            self._known_addresses = known

    def _is_known_address(self, host: str) -> bool:
        with self._known_addresses_lock:
            return host in self._known_addresses

    def _refresh_loop(self) -> None:
        address_refreshes = 0
        while not self.stop_event.is_set():
            self.refresh_once()

            address_refreshes += 1
            if address_refreshes >= 6:
                self.refresh_known_addresses()
                address_refreshes = 0

            self.stop_event.wait(REFRESH_INTERVAL_SECONDS)

    def cached_geo(self, host: str) -> dict[str, Any] | None:
        with self._geo_cache_lock:
            entry = self._geo_cache.get(host)
            if entry is None or entry.generation != self.geo_database.generation:
                return None
            if entry.retry_at is not None and time.monotonic() >= entry.retry_at:
                return None
            return entry.data

    def _cache_private_address(self, host: str) -> None:
        with self._geo_cache_lock:
            self._geo_cache[host] = GeoEntry(
                self._empty_geo("private"), self.geo_database.generation
            )

    def queue_geo_lookup(self, host: str, peer_network: str) -> None:
        with self._pending_lock:
            if host in self._pending:
                return
            self._pending.add(host)
        self._geo_queue.put((host, peer_network))

    @staticmethod
    def _empty_geo(status: str) -> dict[str, Any]:
        return {
            "status": status,
            "continent": "",
            "continentCode": "",
            "country": "",
            "countryCode": "",
            "region": "",
            "regionName": "",
            "city": "",
            "district": "",
            "zip": "",
            "lat": 0,
            "lon": 0,
            "timezone": "",
            "offset": 0,
            "currency": "",
            "isp": "",
            "org": "",
            "as": "",
            "asname": "",
            "mobile": False,
            "proxy": False,
            "hosting": False,
        }

    @staticmethod
    def _normalize_geo(data: dict[str, Any], from_database: bool) -> dict[str, Any]:
        result = PeerService._empty_geo("ok")
        for key in result:
            if key != "status" and key in data:
                result[key] = data[key]
        if from_database:
            result["offset"] = data.get("utc_offset", 0)
            result["as"] = data.get("as_info", "")
        return result

    def _fetch_geo(self, host: str) -> dict[str, Any] | None:
        try:
            response = requests.get(f"{GEO_API_URL}/{host}?fields={GEO_API_FIELDS}", timeout=10)
            if response.status_code != 200:
                self.connectivity.network_failure(geoip_api=True)
                return None
            data = response.json()
            if data.get("status") == "success":
                self.connectivity.network_success(geoip_api=True)
                return data
        except (requests.RequestException, ValueError):
            self.connectivity.network_failure(geoip_api=True)
        return None

    def _resolve_geo(self, host: str, peer_network: str) -> bool:
        """Resolve one active address; return whether the API rate limit applies."""
        try:
            with self._geo_cache_lock:
                if host not in self._active_hosts:
                    return False
            generation = self.geo_database.generation
            data = self.geo_database.get(host)
            if data and not is_valid_geo_data(data):
                data = None
            from_database = bool(data)
            connectivity = self.connectivity.snapshot()
            skip_api = connectivity["geo_db_only_mode"] or connectivity["internet_state"] in {
                "yellow",
                "red",
            }
            used_api = data is None and not skip_api and is_public_address(peer_network, host)
            if used_api:
                data = self._fetch_geo(host)
                if data and is_valid_geo_data(data):
                    if generation == self.geo_database.generation:
                        self.geo_database.save(host, data)
                else:
                    data = None

            with self._geo_cache_lock:
                if host in self._active_hosts and generation == self.geo_database.generation:
                    self._geo_cache[host] = GeoEntry(
                        self._normalize_geo(data, from_database)
                        if data
                        else self._empty_geo("unavailable"),
                        generation,
                        None if data else time.monotonic() + GEO_RETRY_SECONDS,
                    )
            return used_api
        finally:
            with self._pending_lock:
                self._pending.discard(host)

    def _geo_loop(self) -> None:
        while not self.stop_event.is_set():
            try:
                host, peer_network = self._geo_queue.get(timeout=0.5)
            except queue.Empty:
                continue
            try:
                if self._resolve_geo(host, peer_network):
                    self.stop_event.wait(GEO_API_DELAY_SECONDS)
            finally:
                self._geo_queue.task_done()

    def list_peers(self) -> list[dict[str, Any]]:
        return self.snapshot()["peers"]

    def snapshot(self) -> dict[str, Any]:
        """Read peers and polling status together so their timestamps cannot disagree."""
        with self._peers_lock:
            peers = list(self._peers)
            last_success_at = self._last_success_at
            status = {
                "connected": None if self._last_attempt_at is None else self._last_error is None,
                "last_success_at": last_success_at,
                "last_attempt_at": self._last_attempt_at,
                "age_seconds": (
                    max(0, time.time() - last_success_at) if last_success_at is not None else None
                ),
                "error": self._last_error,
                "stale_after_seconds": REFRESH_INTERVAL_SECONDS * 3,
            }
        return {
            "peers": self._serialize_peers(
                peers, last_success_at if last_success_at is not None else time.time()
            ),
            "status": status,
        }

    def _serialize_peers(
        self, peers: list[dict[str, Any]], observed_at: float
    ) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = []
        service_names = {
            "NETWORK": "N",
            "WITNESS": "W",
            "NETWORK_LIMITED": "NL",
            "P2P_V2": "P",
            "COMPACT_FILTERS": "CF",
            "BLOOM": "B",
            "BLAKE2B?": "BL",
            "BLAKE2B": "BL",
        }
        for peer in peers:
            address = peer.get("addr", "")
            peer_network = peer.get("network", network_type(address))
            host, port = split_peer_address(address)
            geo = self.cached_geo(host)
            if peer_network in {"onion", "i2p", "cjdns"} or is_private_address(host):
                location_status, location = "private", "PRIVATE"
            elif geo and geo.get("status") == "ok" and geo.get("city"):
                location_status = "ok"
                location = f"{geo['city']}, {geo.get('countryCode', '')}"
            elif geo and geo.get("status") == "unavailable":
                location_status, location = "unavailable", "UNAVAILABLE"
            else:
                location_status, location = "pending", "Stalking..."

            services = peer.get("servicesnames", [])
            connected_at = peer.get("conntime", 0)
            connected_for = (
                format_duration(int(observed_at) - connected_at) if connected_at else "-"
            )
            result.append(
                {
                    "id": peer.get("id"),
                    "network": peer_network,
                    "ip": host,
                    "port": port,
                    "direction": "IN" if peer.get("inbound") else "OUT",
                    "subver": peer.get("subver", "").replace("/", ""),
                    "city": geo.get("city", "") if geo else "",
                    "region": geo.get("region", "") if geo else "",
                    "regionName": geo.get("regionName", "") if geo else "",
                    "country": geo.get("country", "") if geo else "",
                    "countryCode": geo.get("countryCode", "") if geo else "",
                    "continent": geo.get("continent", "") if geo else "",
                    "continentCode": geo.get("continentCode", "") if geo else "",
                    "bytessent": peer.get("bytessent", 0),
                    "bytesrecv": peer.get("bytesrecv", 0),
                    "bytessent_fmt": format_bytes(peer.get("bytessent", 0)),
                    "bytesrecv_fmt": format_bytes(peer.get("bytesrecv", 0)),
                    "ping_ms": int((peer.get("pingtime") or 0) * 1000),
                    "conntime": connected_at,
                    "conntime_fmt": connected_for,
                    "version": peer.get("version", 0),
                    "connection_type": peer.get("connection_type", ""),
                    "connection_type_abbrev": abbreviate_connection_type(
                        peer.get("connection_type", "")
                    ),
                    "services": services,
                    "services_abbrev": " ".join(
                        service_names.get(name, name[:2]) for name in services
                    ),
                    "lat": geo.get("lat", 0) if geo else 0,
                    "lon": geo.get("lon", 0) if geo else 0,
                    "isp": geo.get("isp", "") if geo else "",
                    "district": geo.get("district", "") if geo else "",
                    "zip": geo.get("zip", "") if geo else "",
                    "timezone": geo.get("timezone", "") if geo else "",
                    "offset": geo.get("offset", 0) if geo else 0,
                    "currency": geo.get("currency", "") if geo else "",
                    "org": geo.get("org", "") if geo else "",
                    "as": geo.get("as", "") if geo else "",
                    "asname": geo.get("asname", "") if geo else "",
                    "mobile": geo.get("mobile", False) if geo else False,
                    "proxy": geo.get("proxy", False) if geo else False,
                    "hosting": geo.get("hosting", False) if geo else False,
                    "in_addrman": self._is_known_address(host),
                    "location": location,
                    "location_status": location_status,
                    "addr": address,
                    "minping": peer.get("minping"),
                    "lastsend": peer.get("lastsend"),
                    "lastrecv": peer.get("lastrecv"),
                    "startingheight": peer.get("startingheight"),
                    "synced_headers": peer.get("synced_headers"),
                    "synced_blocks": peer.get("synced_blocks"),
                    "transport_protocol_type": peer.get("transport_protocol_type", ""),
                    "session_id": peer.get("session_id", ""),
                    "addr_relay_enabled": peer.get("addr_relay_enabled"),
                    "bip152_hb_from": peer.get("bip152_hb_from", False),
                    "bip152_hb_to": peer.get("bip152_hb_to", False),
                    "relaytxes": peer.get("relaytxes"),
                    "last_transaction": peer.get("last_transaction", 0),
                    "last_block": peer.get("last_block", 0),
                    "timeoffset": peer.get("timeoffset", 0),
                    "addrlocal": peer.get("addrlocal", ""),
                    "permissions": peer.get("permissions", []),
                    "minfeefilter": peer.get("minfeefilter"),
                    "addr_processed": peer.get("addr_processed", 0),
                    "addr_rate_limited": peer.get("addr_rate_limited", 0),
                    "mapped_as": peer.get("mapped_as"),
                }
            )
        return result
