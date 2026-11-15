# FastAPI app: health, region list and the trend map, insight and station routers

import os

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from src import dataset
from src.config import settings

from .stations import router as stations_router
from .insights import router as insights_router
from .trendmap import router as trendmap_router

CORS_ORIGINS = [o.strip().rstrip("/") for o in os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(",")]

app = FastAPI(title="Is Earth okay? API", version="0.1")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o for o in CORS_ORIGINS if o],
    allow_origin_regex=os.environ.get("CORS_ORIGIN_REGEX") or None,
    allow_methods=["GET"],
    allow_headers=["*"],
)
# level 6: five times faster than the default 9 for 4% more bytes, which matters on a small CPU
app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=6)
app.include_router(trendmap_router)
app.include_router(stations_router)
app.include_router(insights_router)


@app.get("/api/health")
def health():
    try:
        count = len(dataset.catalog()) if settings.data_mode == "live" else 1
    except dataset.DatasetError:
        count = 0
    return {"status": "ok", "data_mode": settings.data_mode, "variables": count}


@app.get("/api/boundaries")
def boundaries(q: str = "", country: str | None = None, kind: str | None = None, limit: int = Query(50, ge=1, le=5000)):
    try:
        frame = dataset.regions()
    except dataset.DatasetError as e:
        raise HTTPException(503, str(e))
    if q:
        frame = frame[frame["name"].str.contains(q, case=False, regex=False)]
    if country:
        frame = frame[frame["country"] == country.lower()]
    if kind:
        frame = frame[frame["kind"] == kind]
    frame = frame.sort_values(["kind", "area_km2"], ascending=[False, False]).head(limit)
    return frame.to_dict("records")
