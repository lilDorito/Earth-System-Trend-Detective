# Earth Trend Detective

> NASA Space Apps Challenge 2026 · *Be An Earth System Trend Detective!*
> **Status:** skeleton. Runs end to end on mock data; adapters and stats are being filled in.

Pick any place on Earth and an Earth science variable (temperature, soil moisture, rainfall, NO₂...), see how it changed over time, and find out whether the change is **statistically significant**. Two modes:

- **Trend:** gradual change. Linear regression + Mann-Kendall / Sen's slope on deseasonalized monthly data.
- **Event impact:** step change around a date. Before vs. after, Welch t-test.

Works worldwide; the demo cases focus on Ukraine.

Plus a **global trend map** (`/map`): a spinning Earth with a per-cell temperature-trend layer (Sen's slope, FDR-significance mask) and click-to-chart with Hamed-Rao Mann-Kendall at any point.

## Quick start

One command for API + web (after `pip install -r requirements.txt`): `python scripts/dev.py` -> http://localhost:5173 (API on :5055). Add `--live` for real data from the Hugging Face dataset instead of the mock. Ctrl+C stops both. Manual steps below.

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

Real data: set `DATA_MODE=live` in `.env`. Air temperature, soil moisture, precipitation, sea surface temperature and sea level then come from the [Earth Trend Detective dataset](https://huggingface.co/datasets/lilDorito/earth-trend-data) on Hugging Face (public, no token), and the trend map offers all 31 gridded variables. NO₂ stays synthetic. `HF_DATASET_PATH=data/hf` reads a local copy instead of the Hub.

Port 8000 busy (Windows `WinError 10013`)? `uvicorn app.api.main:app --port 8765` and `VITE_DATA_SOURCE=api VITE_API_TARGET=http://localhost:8765 npm run dev`.

### Data

With `DATA_MODE=mock` the map runs on a synthetic field (badge "synthetic field"). Live data comes from the dataset, built by the scripts in `scripts/ingest/` (see its README): `nasa_grid.py`, `ocean.py` and `ncei.py` download the sources, `hf_dataset.py` converts them to Parquet (`data/hf`, about 1 GB) and checks the result, then `hf upload lilDorito/earth-trend-data data/hf . --repo-type dataset` publishes it. After an upload, set `HF_DATASET_REVISION` to the new commit.

## Structure

```
configs/              variables, regions, demos, region types (YAML, no code)
src/
  contracts.py        THE shared data contract (Series, TrendResult, EventResult, VariableInfo)
  sources/            one adapter per provider -> same Series out
    hf_grid.py        monthly series from the Hugging Face dataset (point: nearest cell with data, box or region: weighted mean)
    power.py          NASA POWER monthly point series via API (no token)
    giovanni.py       point time series        (data, first priority)
    harmony.py        area-averaged series     (data)
    mock.py           synthetic data for DATA_MODE=mock
  cache.py            local cache of raw responses (data)
  units.py            raw -> display units
  processing.py       monthly resample, climatology, anomalies (stats)
  stats.py            trend (OLS + Mann-Kendall/Hamed-Rao) + event (Welch, autocorrelation-adjusted)
  dataset.py          the Hugging Face dataset: catalog, annual grids, point, box and region series (ranged Parquet reads)
  gridtrends.py       global grid: Mann-Kendall + Sen per cell, FDR, demo field (feeds /map)
  pipeline.py         fetch -> process -> analyze
app/
  api/                FastAPI: /api/health, /variables, /regions, /region-types, /demos, POST /analyze, /api/trendmap/{variables,meta,grid,frames,global-mean,region,point}, /api/stations{,/elements,/compare}
  web/                React + TS + Vite, R3F globe, ECharts, Tailwind, shadcn/ui, Zustand
    src/api/          typed client + in-browser mock with the same interface
    src/features/     globe (shared canvas), explorer (wizard + results), trendmap, stations, charts
scripts/              dev, run_smoke, prepare_grid, prepare_gistemp
  ingest/             source downloads (NASA grids, ocean grids, NCEI stations) and the Hugging Face dataset build
data/                 cache/ + raw/ (ignored), demos/ (committed, offline demo data)
tests/                contract + API tests
docs/                 ARCHITECTURE.md, TEAM.md, AI_DISCLOSURE.md
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the data flow and contract, and [`docs/TEAM.md`](docs/TEAM.md) for who owns what.

## Data

NASA Giovanni (MERRA-2, GLDAS, GPM IMERG, OMI, ...), accessed with an Earthdata Login token. NASA does not endorse this project.

Globe imagery: NASA Blue Marble Next Generation with topography and bathymetry (July 2004): an 8K/4K base texture plus full-resolution 22.5° tiles (`public/textures/tiles/`) that load when zoomed in. Borders: [Natural Earth](https://www.naturalearthdata.com/) via `world-atlas`, with Crimea shown as part of Ukraine. Cities: Natural Earth populated places with a per-country quota, rebuilt with `node app/web/scripts/build-cities.mjs`.
