"""External network health and BTC price state."""

from __future__ import annotations

import math
import threading
import time
from dataclasses import dataclass, field
from typing import Any

import requests


@dataclass
class PriceEntry:
    started_at: float | None = None
    last_known: str | None = None
    error: str | None = None
    lock: threading.Lock = field(default_factory=threading.Lock)


class ConnectivityService:
    def __init__(self, stop_event: threading.Event):
        self._stop_event = stop_event
        self._lock = threading.RLock()
        self._checker_lock = threading.Lock()
        self._checker: threading.Thread | None = None
        self.internet_state = "green"
        self.consecutive_successes = 0
        self.failure_started_at: float | None = None
        self.api_consecutive_failures = 0
        self.api_prompt_count = 0
        self.api_prompt_at = 0.0
        self.geoip_api_disabled = False
        self._prices: dict[str, PriceEntry] = {}
        self._price_currency = "USD"

    def _set_state(self, state: str) -> None:
        with self._lock:
            if self.internet_state == state:
                return
            previous = self.internet_state
            self.internet_state = state
        print(f"Internet state changed from {previous} to {state}")

    def network_failure(self, *, geoip_api: bool = False) -> None:
        with self._lock:
            self.consecutive_successes = 0
            if self.internet_state == "green":
                self.failure_started_at = time.time()
            if geoip_api:
                self.api_consecutive_failures += 1
        self._set_state("yellow")
        self._ensure_checker()

    def network_success(self, *, geoip_api: bool = False) -> None:
        with self._lock:
            if geoip_api:
                self.api_consecutive_failures = 0
            if self.internet_state == "green":
                return
            self.consecutive_successes += 1
            if self.consecutive_successes < 4:
                return
            self.consecutive_successes = 0
            self.failure_started_at = None
            self.api_prompt_count = 0
            self.api_prompt_at = 0
        self._set_state("green")

    def _ensure_checker(self) -> None:
        with self._checker_lock:
            if self._checker and self._checker.is_alive():
                return
            self._checker = threading.Thread(
                target=self._check_loop,
                daemon=True,
                name="connectivity-monitor",
            )
            self._checker.start()

    def stop(self) -> None:
        if self._checker:
            self._checker.join(timeout=2)

    def _check_loop(self) -> None:
        while not self._stop_event.is_set():
            with self._lock:
                if self.internet_state == "green":
                    return
            try:
                response = requests.head("https://www.google.com", timeout=2)
                available = response.status_code < 500
            except requests.RequestException:
                available = False
            if available:
                self.network_success()
            else:
                with self._lock:
                    self.consecutive_successes = 0
                    failure_age = (
                        time.time() - self.failure_started_at if self.failure_started_at else 0
                    )
                if failure_age >= 10:
                    self._set_state("red")
            self._stop_event.wait(2)

    @staticmethod
    def normalize_currency(currency: str) -> str:
        return currency.strip().upper()

    def fetch_price(self, currency: str) -> float | None:
        currency = self.normalize_currency(currency)
        with self._lock:
            entry = self._prices.setdefault(currency, PriceEntry())
            self._price_currency = currency
        # Currency locks allow unrelated prices to refresh independently. Recheck
        # after acquiring the lock so simultaneous tabs share the same request.
        with entry.lock:
            started = time.monotonic()
            with self._lock:
                if entry.started_at is not None and started - entry.started_at < 5:
                    return float(entry.last_known) if entry.last_known else None
                entry.started_at = started
                offline = self.internet_state == "red"
            if not offline:
                try:
                    response = requests.get(
                        f"https://api.coinbase.com/v2/prices/BTC-{currency}/spot", timeout=5
                    )
                    response.raise_for_status()
                    amount = response.json().get("data", {}).get("amount")
                    price = float(amount)
                    if not math.isfinite(price) or price <= 0:
                        raise ValueError("Coinbase response did not include a valid price")
                    with self._lock:
                        entry.last_known = str(amount)
                        entry.error = None
                    self.network_success()
                except (requests.RequestException, TypeError, ValueError) as exc:
                    with self._lock:
                        entry.error = f"Coinbase API error: {exc}"
                    self.network_failure()
            return float(entry.last_known) if entry.last_known else None

    def price_info(self, currency: str = "USD") -> dict[str, Any]:
        currency = self.normalize_currency(currency)
        price = self.fetch_price(currency)
        with self._lock:
            entry = self._prices[currency]
            return {
                "btc_price": price,
                "btc_currency": currency,
                "last_known_price": entry.last_known,
                "last_price_currency": currency,
                "last_price_error": entry.error,
            }

    def toggle_geoip_api(self) -> bool:
        with self._lock:
            self.geoip_api_disabled = not self.geoip_api_disabled
            if self.geoip_api_disabled:
                self.api_prompt_count = 0
                self.api_prompt_at = 0
            return self.geoip_api_disabled

    def acknowledge_prompt(self) -> None:
        with self._lock:
            self.api_prompt_at = time.time()
            self.api_prompt_count += 1

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            should_prompt = False
            if (
                self.api_consecutive_failures >= 5
                and self.internet_state == "green"
                and not self.geoip_api_disabled
            ):
                elapsed = time.time() - self.api_prompt_at if self.api_prompt_at else float("inf")
                should_prompt = (
                    self.api_prompt_count == 0
                    or (self.api_prompt_count <= 3 and elapsed >= self.api_prompt_count * 60)
                    or (self.api_prompt_count > 3 and elapsed >= 300)
                )
            entry = self._prices.get(self._price_currency)
            return {
                "internet_state": self.internet_state,
                "api_available": self.api_consecutive_failures < 5,
                "api_consecutive_failures": self.api_consecutive_failures,
                "last_price_error": entry.error if entry else None,
                "last_known_price": entry.last_known if entry else None,
                "last_price_currency": self._price_currency,
                "geo_db_only_mode": self.geoip_api_disabled,
                "api_down_prompt": should_prompt,
            }
