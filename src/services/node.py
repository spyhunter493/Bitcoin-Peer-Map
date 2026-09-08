"""Dashboard queries and peer-management operations against Bitcoin RPC."""

from __future__ import annotations

import asyncio
import threading
import time
from collections import OrderedDict
from typing import Any, Callable

from network import format_bytes, normalize_peer_address, split_peer_address
from rpc import BitcoinRpcClient, RpcError

from .connectivity import ConnectivityService
from .geoip import GeoDatabase

_BLOCK_METADATA_CACHE_LIMIT = 256
_CHAIN_TIP_HEADER_LIMIT = 100


class NodeService:
    def __init__(
        self,
        rpc: BitcoinRpcClient,
        connectivity: ConnectivityService,
        geo_database: GeoDatabase,
        auto_update_enabled: Callable[[], bool],
    ):
        self.rpc = rpc
        self.connectivity = connectivity
        self.geo_database = geo_database
        self.auto_update_enabled = auto_update_enabled
        self._traffic_baseline: tuple[int, int] | None = None
        self._traffic_lock = threading.Lock()
        self._recent_blocks: OrderedDict[str, dict[str, Any]] = OrderedDict()
        self._recent_blocks_lock = threading.Lock()
        self._chain_tip_times: OrderedDict[str, int] = OrderedDict()
        self._chain_tips_lock = threading.Lock()

    @staticmethod
    def _network_key(name: Any) -> str | None:
        value = str(name or "").lower()
        if value == "onion":
            return "onion"
        if value in {"ipv4", "ipv6", "i2p", "cjdns"}:
            return value
        return None

    @classmethod
    def _local_address_network(cls, address: str) -> str:
        lower = address.lower()
        if lower.endswith(".onion"):
            return "onion"
        if lower.endswith(".i2p"):
            return "i2p"
        if lower.startswith(("fc", "fd")) and ":" in lower:
            return "cjdns"
        if ":" in address:
            return "ipv6"
        return "ipv4"

    @classmethod
    def _network_summary(cls, network: dict[str, Any]) -> dict[str, Any]:
        details: dict[str, dict[str, Any]] = {
            key: {"reachable": False, "limited": True, "proxy": "", "localaddresses": []}
            for key in ("ipv4", "ipv6", "onion", "i2p", "cjdns")
        }
        for item in network.get("networks", []):
            key = cls._network_key(item.get("name"))
            if key is None:
                continue
            details[key]["reachable"] = bool(item.get("reachable", False))
            details[key]["limited"] = bool(item.get("limited", True))
            details[key]["proxy"] = str(item.get("proxy", "") or "")

        for item in network.get("localaddresses", []):
            address = str(item.get("address", "") or "").strip()
            if not address:
                continue
            key = cls._local_address_network(address)
            details[key]["localaddresses"].append(
                {
                    "address": address,
                    "port": item.get("port"),
                    "score": item.get("score", 0),
                }
            )

        for detail in details.values():
            detail["localaddresses"].sort(
                key=lambda item: int(item.get("score") or 0),
                reverse=True,
            )
        return details

    def _node_traffic_summary(self, net_totals: dict[str, Any]) -> dict[str, Any]:
        received = max(0, int(net_totals.get("totalbytesrecv") or 0))
        sent = max(0, int(net_totals.get("totalbytessent") or 0))

        with self._traffic_lock:
            if self._traffic_baseline is None:
                self._traffic_baseline = (received, sent)
            baseline_received, baseline_sent = self._traffic_baseline
            if received < baseline_received or sent < baseline_sent:
                self._traffic_baseline = (received, sent)
                baseline_received, baseline_sent = self._traffic_baseline

        downloaded = received - baseline_received
        uploaded = sent - baseline_sent
        return {
            "download_bytes": downloaded,
            "upload_bytes": uploaded,
            "download_fmt": format_bytes(downloaded),
            "upload_fmt": format_bytes(uploaded),
        }

    def dashboard_info(self, currency: str = "USD") -> dict[str, Any]:
        currency = currency.upper()
        price = self.connectivity.fetch_price(currency)
        connectivity = self.connectivity.snapshot()
        result: dict[str, Any] = {
            "btc_price": price,
            "btc_currency": currency,
            "last_block": None,
            "blockchain": None,
            "network_scores": None,
            "geo_db_stats": None,
            "connected": None,
            "mempool_size": None,
            "subversion": None,
            "network_details": None,
            "node_traffic": None,
            "last_known_price": connectivity["last_known_price"],
            "last_price_currency": connectivity["last_price_currency"],
            "last_price_error": connectivity["last_price_error"],
            "internet_state": connectivity["internet_state"],
            "api_available": connectivity["api_available"],
            "geo_db_only_mode": connectivity["geo_db_only_mode"],
        }

        try:
            block_hash = self.rpc.call("getbestblockhash", timeout=10)
            header = self.rpc.call("getblockheader", block_hash, timeout=10)
            result["last_block"] = {
                "height": header.get("height", 0),
                "time": header.get("time", 0),
            }
        except RpcError as exc:
            print(f"Could not load last block: {exc}")

        try:
            blockchain = self.rpc.call("getblockchaininfo", timeout=10)
            indexed = False
            try:
                indexed = "txindex" in self.rpc.call("getindexinfo", timeout=10)
            except RpcError:
                pass
            result["blockchain"] = {
                "size_gb": round(blockchain.get("size_on_disk", 0) / 1e9, 1),
                "pruned": blockchain.get("pruned", False),
                "indexed": indexed,
                "ibd": blockchain.get("initialblockdownload", False),
            }
        except RpcError as exc:
            print(f"Could not load blockchain details: {exc}")

        try:
            network = self.rpc.call("getnetworkinfo", timeout=10)
            result["subversion"] = network.get("subversion", "")
            result["connected"] = network.get("connections", 0)
            result["network_details"] = self._network_summary(network)
            scores: dict[str, int | None] = {"ipv4": None, "ipv6": None}
            for local_address in network.get("localaddresses", []):
                address = local_address.get("address", "")
                if address.endswith((".onion", ".i2p")) or address.startswith(("fc", "fd")):
                    continue
                family = "ipv6" if ":" in address else "ipv4"
                score = local_address.get("score", 0)
                if scores[family] is None or score > scores[family]:
                    scores[family] = score
            result["network_scores"] = scores
        except RpcError as exc:
            print(f"Could not load network details: {exc}")

        try:
            net_totals = self.rpc.call("getnettotals", timeout=10)
            result["node_traffic"] = self._node_traffic_summary(net_totals)
        except (RpcError, TypeError, ValueError) as exc:
            print(f"Could not load node traffic totals: {exc}")

        try:
            result["mempool_size"] = self.rpc.call("getmempoolinfo", timeout=10).get("size", 0)
        except RpcError as exc:
            print(f"Could not load mempool details: {exc}")

        geo_stats = self.geo_database.stats()
        if geo_stats.get("entries", 0):
            oldest = geo_stats.get("oldest_updated")
            newest = geo_stats.get("last_updated")
            geo_stats["oldest_age_days"] = int((time.time() - oldest) / 86400) if oldest else None
            geo_stats["newest_age_days"] = int((time.time() - newest) / 86400) if newest else None
            geo_stats["newest_age_seconds"] = int(time.time() - newest) if newest else None
        geo_stats.update(
            auto_lookup=self.geo_database.enabled,
            auto_update=self.auto_update_enabled(),
            db_only_mode=connectivity["geo_db_only_mode"],
        )
        result["geo_db_stats"] = geo_stats
        return result

    def mempool(self, currency: str = "USD") -> dict[str, Any]:
        result = {"mempool": None, "btc_price": None, "error": None}
        try:
            result["mempool"] = self.rpc.call("getmempoolinfo")
        except RpcError as exc:
            result["error"] = str(exc)
        result["btc_price"] = self.connectivity.fetch_price(currency.upper())
        return result

    def blockchain(self) -> dict[str, Any]:
        try:
            return {"blockchain": self.rpc.call("getblockchaininfo"), "error": None}
        except RpcError as exc:
            return {"blockchain": None, "error": str(exc)}

    def _recent_block(self, block_hash: str, expected_height: int) -> dict[str, Any]:
        cached = self._recent_blocks.get(block_hash)
        if cached is not None:
            self._recent_blocks.move_to_end(block_hash)
            return cached

        block = self.rpc.call("getblock", block_hash, 1, timeout=10)
        if not isinstance(block, dict):
            raise ValueError("getblock returned an unexpected response")

        height_value = block.get("height")
        height = int(height_value if height_value is not None else expected_height)
        if height != expected_height:
            raise ValueError(
                f"getblock returned height {height} while traversing height {expected_height}"
            )

        tx_count = block.get("nTx")
        if tx_count is None and isinstance(block.get("tx"), list):
            tx_count = len(block["tx"])
        size = int(block.get("size", 0) or 0)
        cached = {
            "height": height,
            "hash": block_hash,
            "time": int(block.get("time", 0) or 0),
            "size": size,
            "size_mb": round(size / 1_000_000, 3),
            "weight": int(block.get("weight", 0) or 0),
            "tx_count": int(tx_count or 0),
            "version": block.get("version"),
            "difficulty": block.get("difficulty"),
            "previous_hash": str(block.get("previousblockhash", "") or ""),
        }
        self._recent_blocks[block_hash] = cached
        while len(self._recent_blocks) > _BLOCK_METADATA_CACHE_LIMIT:
            self._recent_blocks.popitem(last=False)
        return cached

    def recent_blocks(self, limit: int = 25) -> dict[str, Any]:
        try:
            limit = max(1, min(int(limit), 100))
        except (TypeError, ValueError):
            limit = 25

        try:
            with self._recent_blocks_lock:
                blockchain = self.rpc.call("getblockchaininfo", timeout=10)
                if not isinstance(blockchain, dict):
                    raise ValueError("getblockchaininfo returned an unexpected response")

                tip_height = int(blockchain.get("blocks", 0) or 0)
                block_hash = blockchain.get("bestblockhash")
                if not isinstance(block_hash, str) or not block_hash:
                    raise ValueError("getblockchaininfo did not return bestblockhash")

                cached_blocks = []
                count = min(limit, tip_height + 1)
                for offset in range(count):
                    expected_height = tip_height - offset
                    block = self._recent_block(block_hash, expected_height)
                    cached_blocks.append(block)
                    if expected_height > 0:
                        block_hash = block["previous_hash"]
                        if not block_hash:
                            raise ValueError(
                                f"getblock did not return previousblockhash at height {expected_height}"
                            )

            generated_at = int(time.time())
            blocks = [
                {
                    "height": block["height"],
                    "hash": block["hash"],
                    "time": block["time"],
                    "age_seconds": (
                        max(0, generated_at - block["time"]) if block["time"] else None
                    ),
                    "size": block["size"],
                    "size_mb": block["size_mb"],
                    "weight": block["weight"],
                    "tx_count": block["tx_count"],
                    "version": block["version"],
                    "difficulty": block["difficulty"],
                }
                for block in cached_blocks
            ]

            count = len(blocks)
            total_size = sum(block["size"] for block in blocks)
            total_transactions = sum(block["tx_count"] for block in blocks)
            summary = {
                "chain": blockchain.get("chain"),
                "tip_height": tip_height,
                "count": count,
                "latest_time": blocks[0]["time"] if blocks else None,
                "total_size": total_size,
                "avg_size_mb": round(total_size / count / 1_000_000, 3) if count else 0,
                "total_transactions": total_transactions,
                "avg_transactions": round(total_transactions / count, 1) if count else 0,
                "generated_at": generated_at,
            }
            return {"success": True, "summary": summary, "blocks": blocks, "error": None}
        except (RpcError, TypeError, ValueError) as exc:
            return {"success": False, "summary": None, "blocks": [], "error": str(exc)}

    async def disconnect(self, peer_id: Any) -> dict[str, Any]:
        if peer_id is None:
            return {"success": False, "error": "peer_id is required"}
        try:
            await asyncio.to_thread(self.rpc.call, "disconnectnode", "", int(peer_id))
            return {"success": True}
        except (RpcError, TypeError, ValueError) as exc:
            return {"success": False, "error": str(exc)}

    async def ban(self, peer_id: Any) -> dict[str, Any]:
        if peer_id is None:
            return {"success": False, "error": "peer_id is required"}
        try:
            peers = await asyncio.to_thread(self.rpc.call, "getpeerinfo")
            peer = next((peer for peer in peers if peer.get("id") == int(peer_id)), None)
            if peer is None:
                return {"success": False, "error": f"Peer ID {peer_id} not found"}
            peer_network = peer.get("network", "ipv4")
            if peer_network not in {"ipv4", "ipv6"}:
                return {
                    "success": False,
                    "error": f"Cannot ban {peer_network.upper()} peers; only IPv4 and IPv6 addresses can be banned",
                }
            host, _ = split_peer_address(peer.get("addr", ""))
            await asyncio.to_thread(self.rpc.call, "setban", host, "add", 86400)
            return {"success": True, "banned_ip": host, "network": peer_network}
        except (RpcError, TypeError, ValueError) as exc:
            return {"success": False, "error": str(exc)}

    async def unban(self, address: str | None) -> dict[str, Any]:
        if not address:
            return {"success": False, "error": "address is required"}
        try:
            await asyncio.to_thread(self.rpc.call, "setban", address, "remove")
            return {"success": True}
        except RpcError as exc:
            return {"success": False, "error": str(exc)}

    def bans(self) -> dict[str, Any]:
        try:
            return {"success": True, "bans": self.rpc.call("listbanned")}
        except RpcError as exc:
            return {"success": False, "error": str(exc), "bans": []}

    def clear_bans(self) -> dict[str, Any]:
        try:
            self.rpc.call("clearbanned")
            return {"success": True}
        except RpcError as exc:
            return {"success": False, "error": str(exc)}

    def _chain_tip_time(self, block_hash: str) -> int:
        cached = self._chain_tip_times.get(block_hash)
        if cached is not None:
            self._chain_tip_times.move_to_end(block_hash)
            return cached

        with self._recent_blocks_lock:
            recent_block = self._recent_blocks.get(block_hash)
            if recent_block is not None:
                block_time = int(recent_block["time"])
            else:
                block_time = 0

        if not block_time:
            header = self.rpc.call("getblockheader", block_hash, timeout=10)
            if not isinstance(header, dict):
                raise TypeError("getblockheader returned an unexpected response")
            block_time = int(header.get("time", 0) or 0)

        if block_time:
            self._chain_tip_times[block_hash] = block_time
            while len(self._chain_tip_times) > _BLOCK_METADATA_CACHE_LIMIT:
                self._chain_tip_times.popitem(last=False)
        return block_time

    def chain_tips(self) -> dict[str, Any]:
        try:
            with self._chain_tips_lock:
                tips = self.rpc.call("getchaintips", timeout=10)
                if not isinstance(tips, list):
                    raise TypeError("getchaintips returned an unexpected response")

                blockchain: dict[str, Any] = {}
                try:
                    blockchain_result = self.rpc.call("getblockchaininfo", timeout=10)
                    if isinstance(blockchain_result, dict):
                        blockchain = blockchain_result
                except RpcError:
                    pass

                normalized = []
                counts_by_status: dict[str, int] = {}

                for tip in tips:
                    if not isinstance(tip, dict):
                        continue
                    status = str(tip.get("status") or "unknown").lower()
                    counts_by_status[status] = counts_by_status.get(status, 0) + 1
                    normalized.append(
                        {
                            "height": int(tip.get("height", 0) or 0),
                            "hash": str(tip.get("hash") or ""),
                            "branch_length": int(tip.get("branchlen", 0) or 0),
                            "status": status,
                            "status_label": status.replace("-", " ").title(),
                            "time": None,
                            "age_seconds": None,
                            "is_active": status == "active",
                        }
                    )

                status_priority = {
                    "active": 0,
                    "valid-fork": 1,
                    "valid-headers": 2,
                    "headers-only": 3,
                    "invalid": 4,
                }
                normalized.sort(
                    key=lambda tip: (
                        status_priority.get(tip["status"], 5),
                        -tip["height"],
                        -tip["branch_length"],
                    )
                )

                candidates = [tip for tip in normalized if tip["hash"]]
                for tip in candidates[:_CHAIN_TIP_HEADER_LIMIT]:
                    try:
                        tip["time"] = self._chain_tip_time(tip["hash"])
                    except (RpcError, TypeError, ValueError):
                        pass

            generated_at = int(time.time())
            for tip in normalized:
                block_time = tip["time"]
                tip["age_seconds"] = max(0, generated_at - block_time) if block_time else None

            active_tip = next((tip for tip in normalized if tip["is_active"]), None)
            non_active_tip = max(
                (tip for tip in normalized if not tip["is_active"]),
                key=lambda tip: tip["height"],
                default=None,
            )
            fork_count = counts_by_status.get("valid-fork", 0)
            headers_only_count = counts_by_status.get("headers-only", 0)
            non_active_count = sum(1 for tip in normalized if not tip["is_active"])
            summary = {
                "chain": blockchain.get("chain"),
                "best_height": blockchain.get("blocks")
                if blockchain.get("blocks") is not None
                else active_tip["height"]
                if active_tip
                else None,
                "best_hash": blockchain.get("bestblockhash")
                if blockchain.get("bestblockhash")
                else active_tip["hash"]
                if active_tip
                else None,
                "total": len(normalized),
                "active_count": counts_by_status.get("active", 0),
                "non_active_count": non_active_count,
                "fork_count": fork_count,
                "headers_only_count": headers_only_count,
                "latest_non_active_height": non_active_tip["height"] if non_active_tip else None,
                "latest_non_active_status": non_active_tip["status"] if non_active_tip else None,
                "counts_by_status": counts_by_status,
                "age_lookup_limited": len(candidates) > _CHAIN_TIP_HEADER_LIMIT,
                "age_lookup_limit": _CHAIN_TIP_HEADER_LIMIT,
                "generated_at": generated_at,
            }
            return {"success": True, "summary": summary, "tips": normalized, "error": None}
        except (RpcError, TypeError, ValueError) as exc:
            return {"success": False, "summary": None, "tips": [], "error": str(exc)}

    async def connect(self, address: str) -> dict[str, Any]:
        try:
            normalized = normalize_peer_address(address)
            await asyncio.to_thread(self.rpc.call, "addnode", normalized, "onetry")
            return {"success": True, "address": normalized}
        except (RpcError, ValueError) as exc:
            return {"success": False, "error": str(exc)}
