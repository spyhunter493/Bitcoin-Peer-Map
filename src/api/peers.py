"""Peer list and peer-management endpoints."""

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel

from runtime import AppRuntime

from .dependencies import runtime_from

router = APIRouter(prefix="/api")


class PeerIdRequest(BaseModel):
    peer_id: int | None = None


class AddressRequest(BaseModel):
    address: str = ""


@router.get("/peers")
def list_peers(
    response: Response,
    include_status: bool = False,
    runtime: AppRuntime = Depends(runtime_from),
):
    response.headers["Cache-Control"] = "no-store"
    if include_status:
        return runtime.peers.snapshot()
    return runtime.peers.list_peers()


@router.post("/peer/connect")
async def connect_peer(payload: AddressRequest, runtime: AppRuntime = Depends(runtime_from)):
    return await runtime.node.connect(payload.address)


@router.post("/peer/disconnect")
async def disconnect_peer(payload: PeerIdRequest, runtime: AppRuntime = Depends(runtime_from)):
    return await runtime.node.disconnect(payload.peer_id)


@router.post("/peer/ban")
async def ban_peer(payload: PeerIdRequest, runtime: AppRuntime = Depends(runtime_from)):
    return await runtime.node.ban(payload.peer_id)


@router.post("/peer/unban")
async def unban_peer(payload: AddressRequest, runtime: AppRuntime = Depends(runtime_from)):
    return await runtime.node.unban(payload.address)


@router.get("/bans")
def list_bans(runtime: AppRuntime = Depends(runtime_from)):
    return runtime.node.bans()


@router.post("/bans/clear")
def clear_bans(runtime: AppRuntime = Depends(runtime_from)):
    return runtime.node.clear_bans()
