# Earth Trend Detective

> NASA Space Apps Challenge 2026 · *Be An Earth System Trend Detective!*
> **Status:** skeleton. Runs end to end on mock data; adapters and stats are being filled in.

Pick any place on Earth and an Earth science variable (temperature, soil moisture, rainfall, NO₂...), see how it changed over time, and find out whether the change is **statistically significant**. Two modes:

- **Trend:** gradual change. Linear regression + Mann-Kendall / Sen's slope on deseasonalized monthly data.
- **Event impact:** step change around a date. Before vs. after, Welch t-test.

Works worldwide; the demo cases focus on Ukraine.

Plus a **global trend map** (`/map`): a spinning Earth with a per-cell temperature-trend layer (Sen's slope, FDR-significance mask) and click-to-chart with Hamed-Rao Mann-Kendall at any point.

## Quick start

One command for API + web (after `pip install -r requirements.txt`): `python scripts/dev.py` -> http://localhost:5173 (API on :5055). Ctrl+C stops both. Manual steps below.

```bash
# API (Python 3.13)
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.api.main:app --reload # http://localhost:8000/docs

# Web
cd app/web
npm install
npm run dev # http://localhost:5173
```

The web app runs on its own: by default it uses synthetic data generated in the browser (`src/api/mock/`), so no backend is needed for a UI demo. To talk to the API instead, start uvicorn and run `VITE_DATA_SOURCE=api npm run dev` (dev server proxies `/api` to :8000).

Checks: `pytest` and `python scripts/run_smoke.py`.

Real data for points: set `DATA_MODE=live` in `.env`. Air temperature and precipitation then come from the NASA POWER monthly API (no token, cached in `data/cache`); the other variables stay synthetic until their adapters exist.

Port 8000 busy (Windows `WinError 10013`)? `uvicorn app.api.main:app --port 8765` and `VITE_DATA_SOURCE=api VITE_API_TARGET=http://localhost:8765 npm run dev`.

### Trend map data

Without data the map runs on a synthetic field (badge "demo data, not real"). For real MERRA-2 T2M:

```bash
pip install xarray netcdf4 dask
python scripts/prepare_grid.py path/to/merra2   # monthly *.nc4 -> data/grid/annual.npz (full years only)
```

## Structure

```
configs/              variables, regions, demos, region types (YAML, no code)
src/
  contracts.py        THE shared data contract (Series, TrendResult, EventResult, VariableInfo)
  sources/            one adapter per provider -> same Series out
    power.py          NASA POWER monthly point series via API (no token)
    giovanni.py       point time series        (data, first priority)
    harmony.py        area-averaged series     (data)
    mock.py           synthetic data for DATA_MODE=mock
  cache.py            local cache of raw responses (data)
  units.py            raw -> display units
  processing.py       monthly resample, climatology, anomalies (stats)
  stats.py            trend (OLS + Mann-Kendall/Hamed-Rao) + event (Welch, autocorrelation-adjusted)
  gridtrends.py       global grid: Mann-Kendall + Sen per cell, FDR, demo field (feeds /map)
  pipeline.py         fetch -> process -> analyze
app/
  api/                FastAPI: /api/health, /variables, /regions, /region-types, /demos, POST /analyze, /api/trendmap/{meta,grid,global-mean,point}
  web/                React + TS + Vite, R3F globe, ECharts, Tailwind, shadcn/ui, Zustand
    src/api/          typed client + in-browser mock with the same interface
    src/features/     globe (shared canvas), explorer (wizard + results), trendmap, charts
scripts/              fetch_variables, prefetch_demos, run_smoke, prepare_grid, prepare_gistemp, dev
data/                 cache/ + raw/ (ignored), demos/ (committed, offline demo data)
tests/                contract + API tests
docs/                 ARCHITECTURE.md, TEAM.md, AI_DISCLOSURE.md
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the data flow and contract, and [`docs/TEAM.md`](docs/TEAM.md) for who owns what.

## Data

NASA Giovanni (MERRA-2, GLDAS, GPM IMERG, OMI, ...), accessed with an Earthdata Login token. NASA does not endorse this project.

Globe imagery: NASA Blue Marble Next Generation with topography and bathymetry (July 2004): an 8K/4K base texture plus full-resolution 22.5° tiles (`public/textures/tiles/`) that load when zoomed in. Borders: [Natural Earth](https://www.naturalearthdata.com/) via `world-atlas`, with Crimea shown as part of Ukraine. Cities: Natural Earth populated places with a per-country quota, rebuilt with `node app/web/scripts/build-cities.mjs`.
