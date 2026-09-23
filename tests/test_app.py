import threading
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from app import create_app
from services.peers import PeerService
from settings import AppSettings


class FakeRuntime:
    def __init__(self, settings: AppSettings):
        self.settings = settings
        self.started = False
        self.stopped = False
        self.metrics = FakeMetrics()
        self.node = FakeNode()

    def start(self) -> None:
        self.started = True

    def stop(self) -> None:
        self.stopped = True


class FakeMetrics:
    def summary(self) -> dict[str, float]:
        return {"cpu_pct": 12.5}


class FakeNode:
    def __init__(self):
        self.recent_limits: list[int] = []
        self.chain_tip_calls = 0

    def dashboard_info(self, currency: str = "USD", include_price: bool = True):
        result = {"connected": 3}
        if include_price:
            result.update(self.price(currency))
        return result

    def price(self, currency: str = "USD"):
        return {
            "btc_price": 100,
            "btc_currency": currency.strip().upper(),
            "last_known_price": "100",
            "last_price_currency": currency.strip().upper(),
            "last_price_error": None,
        }

    def recent_blocks(self, limit: int) -> dict[str, Any]:
        self.recent_limits.append(limit)
        return {"success": True, "summary": {"count": 0}, "blocks": [], "error": None}

    def chain_tips(self) -> dict[str, Any]:
        self.chain_tip_calls += 1
        return {"success": True, "summary": {"total": 0}, "tips": [], "error": None}


def settings(tmp_path: Path) -> AppSettings:
    return AppSettings.from_env(
        {
            "BITCOIN_RPC_HOST": "bitcoin",
            "BITCOIN_RPC_USER": "bpm",
            "BITCOIN_RPC_PASSWORD": "secret",
            "BPM_DATA_DIR": str(tmp_path),
            "BPM_BUILD_REVISION": "abcdef0123456789abcdef0123456789abcdef01",
        }
    )


def test_application_factory_serves_health_dashboard_and_assets(tmp_path: Path) -> None:
    app_settings = settings(tmp_path)
    runtime: Any = FakeRuntime(app_settings)
    app = create_app(app_settings, runtime)

    with TestClient(app) as client:
        assert runtime.started is True
        assert client.get("/healthz").json() == {"status": "ok"}
        assert client.get("/api/stats").json() == {"system_stats": {"cpu_pct": 12.5}}
        recent_blocks = client.get("/api/blocks/recent?limit=3")
        assert recent_blocks.status_code == 200
        assert recent_blocks.json()["success"] is True
        assert runtime.node.recent_limits == [3]
        assert client.get("/api/blocks/recent?limit=101").status_code == 422
        chain_tips = client.get("/api/chain-tips")
        assert chain_tips.status_code == 200
        assert chain_tips.json()["success"] is True
        assert runtime.node.chain_tip_calls == 1
        config = client.get("/api/config")
        assert config.status_code == 200
        assert "secret" not in config.text
        assert config.json()["bitcoin_rpc"] == {
            "scheme": "http",
            "host": "bitcoin",
            "port": 8332,
            "network": "main",
            "verify_tls": True,
            "timeout": 30,
            "startup_timeout": 30,
            "username_configured": True,
            "password_configured": True,
            "password_file_configured": False,
            "endpoint": "http://bitcoin:8332",
        }
        assert config.json()["build"] == {
            "revision": "abcdef0123456789abcdef0123456789abcdef01",
            "revision_known": True,
            "asset_revision": "abcdef0123456789abcdef0123456789abcdef01",
            "revision_url": (
                "https://github.com/spyhunter493/bitcoin-peer-map/commit/"
                "abcdef0123456789abcdef0123456789abcdef01"
            ),
        }
        dashboard = client.get("/")
        assert "Bitcoin Peer Map" in dashboard.text
        assert "abcdef0" in dashboard.text
        assert dashboard.headers["cache-control"] == "no-cache"
        assert 'data-asset-revision="abcdef0123456789abcdef0123456789abcdef01"' in dashboard.text
        assert (
            "/static/assets/favicon.svg?v=abcdef0123456789abcdef0123456789abcdef01"
            in dashboard.text
        )
        assert (
            '<script type="module" src="/static/v/abcdef0123456789abcdef0123456789abcdef01/js/app.js"'
            in dashboard.text
        )
        assert dashboard.text.count("<script") == 1
        assert (
            "https://github.com/spyhunter493/bitcoin-peer-map/commit/"
            "abcdef0123456789abcdef0123456789abcdef01" in dashboard.text
        )
        assert "bc1qnngus06lk0e60e05yq902e9edx7kt4kcuuuy72" in dashboard.text
        assert "Created by" not in dashboard.text

        unversioned_asset = client.get("/static/js/app.js", headers={"Accept-Encoding": "identity"})
        assert unversioned_asset.status_code == 200
        assert unversioned_asset.headers["cache-control"] == ("public, max-age=0, must-revalidate")

        versioned_asset = client.get(
            "/static/js/map/controller.js?v=abcdef0123456789abcdef0123456789abcdef01",
            headers={"Accept-Encoding": "gzip"},
        )
        assert versioned_asset.status_code == 200
        assert versioned_asset.headers["cache-control"] == ("public, max-age=31536000, immutable")
        assert versioned_asset.headers["content-encoding"] == "gzip"

        assert client.get("/api/changes").status_code == 404
        assert client.get("/api/netspeed").status_code == 404
        assert client.get("/api/update-check").status_code == 404

    assert runtime.stopped is True


def test_peer_snapshot_status_is_optional_and_not_cached(tmp_path: Path) -> None:
    app_settings = settings(tmp_path)
    runtime: Any = FakeRuntime(app_settings)
    runtime.peers = PeerService(None, None, None, threading.Event())
    with TestClient(create_app(app_settings, runtime)) as client:
        legacy = client.get("/api/peers")
        assert legacy.json() == []
        assert legacy.headers["cache-control"] == "no-store"
        snapshot = client.get("/api/peers?include_status=true")
        assert snapshot.status_code == 200
        assert snapshot.headers["cache-control"] == "no-store"
        assert snapshot.json()["peers"] == []
        assert snapshot.json()["status"]["connected"] is None
        assert snapshot.json()["status"]["last_success_at"] is None


def test_price_endpoint_and_opt_out_preserve_default_info_contract(tmp_path: Path) -> None:
    app_settings = settings(tmp_path)
    runtime = FakeRuntime(app_settings)
    with TestClient(create_app(app_settings, runtime)) as client:
        default_info = client.get("/api/info?currency=nzd").json()
        price = client.get("/api/price?currency=nzd").json()
        assert default_info == {"connected": 3, **price}
        assert price["btc_currency"] == "NZD"
        assert set(price) == {
            "btc_price",
            "btc_currency",
            "last_known_price",
            "last_price_currency",
            "last_price_error",
        }
        assert client.get("/api/info?include_price=false").json() == {"connected": 3}


def test_revisioned_modules_validate_namespace_and_serve_relative_imports(tmp_path: Path) -> None:
    import re
    from urllib.parse import urljoin

    app_settings = settings(tmp_path)
    app = create_app(app_settings, FakeRuntime(app_settings))
    prefix = f"/static/v/{app.state.asset_revision}/"
    with TestClient(app) as client:
        pending = [prefix + "js/app.js"]
        visited = set()
        while pending:
            url = pending.pop()
            if url in visited:
                continue
            visited.add(url)
            assert url.startswith(prefix)
            response = client.get(url)
            assert response.status_code == 200
            assert response.headers["content-type"].split(";")[0] in {
                "text/javascript",
                "application/javascript",
            }
            assert response.headers["cache-control"].endswith("immutable")
            pending.extend(
                urljoin(url, module)
                for module in re.findall(r"from\s+['\"]([^'\"]+\.js)['\"]", response.text)
            )
        assert len(visited) == len(list(Path("src/static/js").rglob("*.js")))
        for asset in [
            "/static/v/incorrect/js/app.js",
            "/static/v/incorrect/%2e%2e/%2e%2e/js/app.js",
            prefix + "%2e%2e/%2e%2e/js/app.js",
            prefix.rstrip("/"),
            prefix + "js/does-not-exist.js",
        ]:
            assert client.get(asset).status_code == 404, asset
        assert client.get("/static/js/app.js").status_code == 200


def test_asset_content_revision_changes_with_dependency(tmp_path: Path) -> None:
    from app import _asset_revision

    entry = tmp_path / "app.js"
    dependency = tmp_path / "feature.js"
    entry.write_text("import './feature.js';")
    dependency.write_text("export const value = 1;")
    before = _asset_revision(tmp_path, "unknown")
    dependency.write_text("export const value = 2;")
    assert _asset_revision(tmp_path, "unknown") != before
