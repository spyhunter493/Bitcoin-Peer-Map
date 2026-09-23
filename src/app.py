"""FastAPI application factory."""

from __future__ import annotations

import hashlib
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import parse_qs

from fastapi import FastAPI, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.exceptions import HTTPException

from api import geoip, node, peers, system
from runtime import AppRuntime
from settings import AppSettings


def _asset_revision(static_dir: Path, build_revision: str) -> str:
    if build_revision != "unknown":
        return build_revision

    digest = hashlib.sha256()
    for path in sorted(item for item in static_dir.rglob("*") if item.is_file()):
        digest.update(path.relative_to(static_dir).as_posix().encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()[:12]


class RevisionedStaticFiles(StaticFiles):
    def __init__(self, *args, asset_revision: str, **kwargs):
        super().__init__(*args, **kwargs)
        self.asset_revision = asset_revision

    async def get_response(self, path: str, scope):
        # StaticFiles normalizes dot segments before calling get_response. Validate
        # the original route first so a bad revision cannot escape its namespace.
        route = scope["path"].removeprefix(scope.get("root_path", "")).lstrip("/")
        if route.startswith("v/"):
            parts = route.split("/")
            if (
                len(parts) < 3
                or parts[1] != self.asset_revision
                or any(part in {".", ".."} for part in parts)
            ):
                raise HTTPException(status_code=404)
        versioned = path.startswith("v/")
        if versioned:
            _, revision, asset = (path.split("/", 2) + [""])[:3]
            if revision != self.asset_revision or not asset:
                raise HTTPException(status_code=404)
            path = asset
        response = await super().get_response(path, scope)
        if response.status_code in {200, 304}:
            query = parse_qs(scope.get("query_string", b"").decode("ascii", "ignore"))
            if versioned or query.get("v") == [self.asset_revision]:
                response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
            else:
                response.headers["Cache-Control"] = "public, max-age=0, must-revalidate"
        return response


def create_app(settings: AppSettings, runtime: AppRuntime | None = None) -> FastAPI:
    package_dir = Path(__file__).resolve().parent
    static_dir = package_dir / "static"
    templates = Jinja2Templates(directory=str(package_dir / "templates"))
    app_runtime = runtime or AppRuntime(settings)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        app_runtime.start()
        try:
            yield
        finally:
            app_runtime.stop()

    app = FastAPI(
        title="Bitcoin Peer Map",
        description="Bitcoin peer monitoring and management dashboard",
        version=settings.build_revision,
        lifespan=lifespan,
    )
    app.add_middleware(GZipMiddleware, minimum_size=500, compresslevel=6)
    app.state.runtime = app_runtime
    app.include_router(peers.router)
    app.include_router(node.router)
    app.include_router(geoip.router)
    app.include_router(system.router)

    repository_url = f"https://github.com/{settings.github_repository}"
    revision = settings.build_revision
    asset_revision = _asset_revision(static_dir, revision)
    revision_url = (
        f"{repository_url}/commit/{revision}" if revision != "unknown" else repository_url
    )
    app.state.repository_url = repository_url
    app.state.revision = revision
    app.state.revision_url = revision_url
    app.state.asset_revision = asset_revision

    @app.get("/", response_class=HTMLResponse)
    async def dashboard(request: Request):
        response = templates.TemplateResponse(
            request,
            "index.html",
            {
                "revision": revision[:7] if revision != "unknown" else revision,
                "revision_url": revision_url,
                "asset_revision": asset_revision,
                "repository_url": repository_url,
                "repository_discussions_url": f"{repository_url}/discussions",
            },
        )
        response.headers["Cache-Control"] = "no-cache"
        return response

    app.mount(
        "/static",
        RevisionedStaticFiles(directory=str(static_dir), asset_revision=asset_revision),
        name="static",
    )
    return app
