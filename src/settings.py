"""Environment-backed application configuration."""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping


class ConfigurationError(ValueError):
    """Raised when startup configuration is invalid."""


def _required(env: Mapping[str, str], name: str) -> str:
    value = env.get(name, "").strip()
    if not value:
        raise ConfigurationError(f"{name} is required")
    if "\n" in value or "\r" in value:
        raise ConfigurationError(f"{name} must be a single line")
    return value


def _integer(env: Mapping[str, str], name: str, default: int, minimum: int, maximum: int) -> int:
    raw = env.get(name, str(default)).strip()
    try:
        value = int(raw)
    except ValueError as exc:
        raise ConfigurationError(f"{name} must be an integer") from exc
    if not minimum <= value <= maximum:
        raise ConfigurationError(f"{name} must be between {minimum} and {maximum}")
    return value


def _boolean(env: Mapping[str, str], name: str, default: bool) -> bool:
    raw = env.get(name)
    if raw is None or not raw.strip():
        return default
    value = raw.strip().lower()
    if value not in {"true", "false"}:
        raise ConfigurationError(f"{name} must be true or false")
    return value == "true"


def _optional_boolean(env: Mapping[str, str], name: str) -> bool | None:
    raw = env.get(name)
    if raw is None or not raw.strip():
        return None
    return _boolean(env, name, False)


def _valid_build_revision(revision: str) -> bool:
    return revision == "unknown" or bool(re.fullmatch(r"[0-9a-f]{7,40}", revision))


def _build_revision_file(env: Mapping[str, str]) -> str:
    revision_file = env.get("BPM_BUILD_REVISION_FILE", "").strip()
    if not revision_file:
        return "unknown"
    try:
        revision = Path(revision_file).read_text().strip().lower()
    except OSError:
        return "unknown"
    if not revision:
        return "unknown"
    if not _valid_build_revision(revision):
        raise ConfigurationError(
            "BPM_BUILD_REVISION_FILE must contain unknown or a 7-40 character Git commit SHA"
        )
    return revision


def _build_revision(env: Mapping[str, str]) -> str:
    revision = env.get("BPM_BUILD_REVISION", "unknown").strip().lower()
    if not revision or revision == "unknown":
        return _build_revision_file(env)
    if not _valid_build_revision(revision):
        raise ConfigurationError("BPM_BUILD_REVISION must be a 7-40 character Git commit SHA")
    return revision


def _rpc_password(env: Mapping[str, str]) -> str:
    direct = env.get("BITCOIN_RPC_PASSWORD", "")
    password_file = env.get("BITCOIN_RPC_PASSWORD_FILE", "").strip()
    if direct and password_file:
        raise ConfigurationError(
            "set only one of BITCOIN_RPC_PASSWORD or BITCOIN_RPC_PASSWORD_FILE"
        )
    if password_file:
        path = Path(password_file)
        try:
            direct = path.read_text().rstrip("\r\n")
        except OSError as exc:
            raise ConfigurationError(
                f"BITCOIN_RPC_PASSWORD_FILE is not readable: {password_file}"
            ) from exc
    if not direct:
        raise ConfigurationError("BITCOIN_RPC_PASSWORD or BITCOIN_RPC_PASSWORD_FILE is required")
    if "\n" in direct or "\r" in direct:
        raise ConfigurationError("Bitcoin RPC password must be a single line")
    return direct


@dataclass(frozen=True, slots=True)
class AppSettings:
    """Validated immutable settings used by the container process."""

    rpc_scheme: str
    rpc_host: str
    rpc_port: int
    rpc_user: str
    rpc_password: str
    rpc_password_file_configured: bool
    rpc_verify_tls: bool
    rpc_timeout: int
    rpc_startup_timeout: int
    bitcoin_network: str
    listen_address: str
    listen_port: int
    data_dir: Path
    geoip_enabled: bool
    geoip_auto_update_override: bool | None
    github_repository: str
    build_revision: str

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "AppSettings":
        values = os.environ if env is None else env
        scheme = values.get("BITCOIN_RPC_SCHEME", "http").strip().lower()
        if scheme not in {"http", "https"}:
            raise ConfigurationError("BITCOIN_RPC_SCHEME must be http or https")

        network = values.get("BITCOIN_NETWORK", "main").strip().lower()
        if network not in {"main", "test", "signet", "regtest"}:
            raise ConfigurationError("BITCOIN_NETWORK must be main, test, signet, or regtest")

        listen_address = values.get("BPM_LISTEN_ADDRESS", "0.0.0.0").strip()
        if not listen_address or "\n" in listen_address or "\r" in listen_address:
            raise ConfigurationError("BPM_LISTEN_ADDRESS must be a single-line address")

        data_dir = Path(values.get("BPM_DATA_DIR", "/var/lib/bitcoin-peer-map")).expanduser()

        repository = values.get("BPM_GITHUB_REPOSITORY", "spyhunter493/bitcoin-peer-map").strip(
            " /"
        )
        if not repository or repository.count("/") != 1:
            raise ConfigurationError("BPM_GITHUB_REPOSITORY must use owner/repository format")

        return cls(
            rpc_scheme=scheme,
            rpc_host=_required(values, "BITCOIN_RPC_HOST"),
            rpc_port=_integer(values, "BITCOIN_RPC_PORT", 8332, 1, 65535),
            rpc_user=_required(values, "BITCOIN_RPC_USER"),
            rpc_password=_rpc_password(values),
            rpc_password_file_configured=bool(values.get("BITCOIN_RPC_PASSWORD_FILE", "").strip()),
            rpc_verify_tls=_boolean(values, "BITCOIN_RPC_VERIFY_TLS", True),
            rpc_timeout=_integer(values, "BITCOIN_RPC_TIMEOUT", 30, 1, 300),
            rpc_startup_timeout=_integer(values, "BPM_RPC_STARTUP_TIMEOUT", 30, 1, 600),
            bitcoin_network=network,
            listen_address=listen_address,
            listen_port=_integer(values, "BPM_LISTEN_PORT", 58333, 1024, 65535),
            data_dir=data_dir.resolve(),
            geoip_enabled=_boolean(values, "BPM_GEOIP_ENABLED", True),
            geoip_auto_update_override=_optional_boolean(values, "BPM_GEOIP_AUTO_UPDATE"),
            github_repository=repository,
            build_revision=_build_revision(values),
        )

    @property
    def rpc_url(self) -> str:
        host = f"[{self.rpc_host}]" if ":" in self.rpc_host else self.rpc_host
        return f"{self.rpc_scheme}://{host}:{self.rpc_port}"
