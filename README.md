# Earth Trend Detective

> NASA Space Apps Challenge 2026 · *Be An Earth System Trend Detective!*
> **Status:** skeleton. Runs end to end on mock data; adapters and stats are being filled in.

Pick any place on Earth and an Earth science variable (temperature, soil moisture, rainfall, NO₂...), see how it changed over time, and find out whether the change is **statistically significant**. Two modes:

- **Trend:** gradual change. Linear regression + Mann-Kendall / Sen's slope on deseasonalized monthly data.
- **Event impact:** step change around a date. Before vs. after, Welch t-test.

Works worldwide; the demo cases focus on Ukraine.

## Quick start

```bash
# API (Python 3.13)
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.api.main:app --reload # http://localhost:8000/docs

# Web
cd app/web
npm install
npm run dev # http://localhost:5173, proxies /api to :8000
```

Checks: `pytest` and `python scripts/run_smoke.py`.

## Structure

```
configs/              variables, regions, demos, region types (YAML, no code)
src/
  contracts.py        THE shared data contract (Series, TrendResult, EventResult, VariableInfo)
  sources/            one adapter per provider -> same Series out
    giovanni.py       point time series        (data, first priority)
    harmony.py        area-averaged series     (data)
    mock.py           synthetic data for DATA_MODE=mock
  cache.py            local cache of raw responses (data)
  units.py            raw -> display units
  processing.py       monthly resample, climatology, anomalies (stats)
  stats.py            trend + event analysis (stats, currently MOCK)
  pipeline.py         fetch -> process -> analyze
app/
  api/                FastAPI: /api/health, /variables, /regions, /region-types, /demos, POST /analyze
  web/                React + TS + Vite, R3F globe, ECharts, Tailwind, shadcn/ui, Zustand
scripts/              fetch_variables, prefetch_demos, run_smoke
data/                 cache/ + raw/ (ignored), demos/ (committed, offline demo data)
tests/                contract + API tests
docs/                 ARCHITECTURE.md, TEAM.md, AI_DISCLOSURE.md
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the data flow and contract, and [`docs/TEAM.md`](docs/TEAM.md) for who owns what.

## Data

NASA Giovanni (MERRA-2, GLDAS, GPM IMERG, OMI, ...), accessed with an Earthdata Login token. NASA does not endorse this project.
