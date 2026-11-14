# FastAPI app: catalog endpoints and /api/analyze

import math
import os

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from src import catalog, pipeline
from src.config import settings
from src.sources.base import SourceError

from .schemas import AnalyzeRequest, AnalyzeResponse, SeriesPoint
from .trendmap import router as trendmap_router

CORS_ORIGINS = [o.strip().rstrip("/") for o in os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(",")]

app = FastAPI(title="Earth Trend Detective API", version="0.1")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o for o in CORS_ORIGINS if o],
    allow_origin_regex=os.environ.get("CORS_ORIGIN_REGEX") or None,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)
app.include_router(trendmap_router)


@app.get("/api/health")
def health():
    return {"status": "ok", "data_mode": settings.data_mode, "variables": len(catalog.variables())}


@app.get("/api/variables")
def variables():
    return list(catalog.variables().values())


@app.get("/api/regions")
def regions():
    return catalog.regions()


@app.get("/api/region-types")
def region_types():
    return catalog.region_types()


@app.get("/api/demos")
def demos():
    return catalog.demos()


@app.post("/api/analyze", response_model=AnalyzeResponse)
def analyze(req: AnalyzeRequest):
    try:
        series, processed, result = pipeline.analyze(
            req.variable, req.location, req.start, req.end,
            mode=req.mode, event_date=req.event_date,
            deseasonalize=req.deseasonalize, region_name=req.region_name,
        )
    except KeyError as e:
        raise HTTPException(404, str(e).strip("'\""))
    except SourceError as e:
        raise HTTPException(502, str(e))
    except NotImplementedError as e:
        raise HTTPException(501, str(e))

    points = [
        SeriesPoint(**{k: (None if isinstance(v, float) and math.isnan(v) else v) for k, v in row.items()})
        for row in processed.to_dict("records")
    ]
    return AnalyzeResponse(meta=series.meta, series=points, result=result)
