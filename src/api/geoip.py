"""Geolocation and external-connectivity endpoints."""

from fastapi import APIRouter, Depends

from runtime import AppRuntime

from .dependencies import runtime_from

router = APIRouter(prefix="/api")


@router.get("/connectivity")
def connectivity(runtime: AppRuntime = Depends(runtime_from)):
    return runtime.connectivity.snapshot()


@router.post("/connectivity/api-prompt-ack")
def acknowledge_connectivity_prompt(runtime: AppRuntime = Depends(runtime_from)):
    runtime.connectivity.acknowledge_prompt()
    return {"success": True}


@router.post("/geodb/toggle-db-only")
def toggle_geoip_api(runtime: AppRuntime = Depends(runtime_from)):
    disabled = runtime.toggle_geoip_api()
    return {
        "success": True,
        "geo_db_only_mode": disabled,
        "message": "API lookup disabled. To re-enable, return to this menu."
        if disabled
        else "API lookup re-enabled.",
    }


@router.post("/geodb/toggle-auto-update")
def toggle_auto_update(runtime: AppRuntime = Depends(runtime_from)):
    enabled = runtime.toggle_geoip_auto_update()
    return {
        "success": True,
        "auto_update": enabled,
        "message": "Auto-update enabled" if enabled else "Auto-update disabled",
    }


@router.post("/geodb/update")
def update_database(runtime: AppRuntime = Depends(runtime_from)):
    return runtime.geo_database.update()
