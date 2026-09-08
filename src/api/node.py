"""Bitcoin node information endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from runtime import AppRuntime

from .dependencies import runtime_from

router = APIRouter(prefix="/api")


@router.get("/info")
def dashboard_info(currency: str = "USD", runtime: AppRuntime = Depends(runtime_from)):
    return runtime.node.dashboard_info(currency)


@router.get("/mempool")
def mempool(currency: str = "USD", runtime: AppRuntime = Depends(runtime_from)):
    return runtime.node.mempool(currency)


@router.get("/blockchain")
def blockchain(runtime: AppRuntime = Depends(runtime_from)):
    return runtime.node.blockchain()


@router.get("/blocks/recent")
def recent_blocks(
    limit: int = Query(25, ge=1, le=100), runtime: AppRuntime = Depends(runtime_from)
):
    return runtime.node.recent_blocks(limit)


@router.get("/rpc-info")
def rpc_info(runtime: AppRuntime = Depends(runtime_from)):
    connection = runtime.rpc.connection_info
    return {
        "scheme": connection.scheme,
        "host": connection.host,
        "port": connection.port,
        "network": connection.network,
        "endpoint": runtime.settings.rpc_url,
    }
