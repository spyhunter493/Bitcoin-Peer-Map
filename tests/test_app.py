from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from app import create_app
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
        assert "/static/js/core/api.js?v=abcdef0123456789abcdef0123456789abcdef01" in dashboard.text
        assert (
            "/static/js/core/modal.js?v=abcdef0123456789abcdef0123456789abcdef01" in dashboard.text
        )
        assert (
            "/static/js/features/node-monitor.js?v=abcdef0123456789abcdef0123456789abcdef01"
            in dashboard.text
        )
        assert (
            "/static/js/features/peer-actions.js?v=abcdef0123456789abcdef0123456789abcdef01"
            in dashboard.text
        )
        assert (
            "/static/js/features/display-settings.js?v=abcdef0123456789abcdef0123456789abcdef01"
            in dashboard.text
        )
        assert (
            "/static/js/features/world-map.js?v=abcdef0123456789abcdef0123456789abcdef01"
            in dashboard.text
        )
        assert (
            "/static/js/features/distribution-data.js?v=abcdef0123456789abcdef0123456789abcdef01"
            in dashboard.text
        )
        assert "/static/js/app.js?v=abcdef0123456789abcdef0123456789abcdef01" in dashboard.text
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
            "/static/js/app.js?v=abcdef0123456789abcdef0123456789abcdef01",
            headers={"Accept-Encoding": "gzip"},
        )
        assert versioned_asset.status_code == 200
        assert versioned_asset.headers["cache-control"] == ("public, max-age=31536000, immutable")
        assert versioned_asset.headers["content-encoding"] == "gzip"

        assert client.get("/api/changes").status_code == 404
        assert client.get("/api/netspeed").status_code == 404
        assert client.get("/api/update-check").status_code == 404

    assert runtime.stopped is True
