# Is Earth okay?

> NASA Space Apps Challenge 2026 · *Be An Earth System Trend Detective!*

**Live:** https://earth-system-trend-detective-nasa.vercel.app
**Dataset:** https://huggingface.co/datasets/lilDorito/earth-trend-data

Pick a place and a measurement, and the map answers the question in its name: *Not really okay: +0.4 °C per decade*, or *Looks fine here*. Behind every answer is a test of whether the change is real or just the usual ups and downs, on 38 climate and ocean variables (2000-2025) from NASA, NOAA and partner datasets, plus 1,800 weather stations.

## Why

Climate data is public, but reading it is hard. One hot summer looks like a trend; a real trend can hide under noisy years. This app does the statistics for you and says the result in one sentence, with the uncertainty explained in plain words rather than hidden.

## How to use it

1. **Pick a measurement** in the left panel: air temperature, rain, soil moisture, sea ice, ocean heat, currents and more.
2. **Read the globe.** Each place is coloured by how fast it changed since 2000. Dots mark changes too steady to be chance.
3. **Click a place.** Point mode picks one spot; Region picks a country, province or sea; "Several" adds more regions to one selection; Box draws your own area.
4. **Read the panel.** A verdict, the trend in words, a chart you can zoom, how it compares with the world, and a quick analysis of how to interpret it.
5. **Press play** on the timeline to see each year.

The first visit opens a short tutorial; the **Tutorial** button in the header replays it, and every control has an info tip. **Demos** has ready-made questions such as "Is Kyiv getting warmer?" and "Did the Arctic ice come back after 2007?".

## Features

- **Trend map.** A GPU-drawn globe coloured by change or by actual values, with significance dots, a year-by-year timeline, isobars for pressure, the sea-ice edge, and drifting streaks for wind and ocean currents.
- **Any place.** Points, countries, provinces, seas, several regions as one area, or a drawn box.
- **Verdict.** "Not really okay", "Looks fine here" or "Changing here", read as a reply to the site's name.
- **Quick analysis.** Is the trend clear yet (and if not, how many more years it needs), is it steady or one jump, does it hold from any start year, does a second dataset agree, how much is El Niño.
- **What else is changing.** Every variable at the same place, ranked by how strongly it changed compared with its usual ups and downs.
- **Clear warnings.** Clicking land for an ocean measurement, or the sea for a land one, says so instead of guessing.
- **Stations against satellites.** Ground weather stations (temperature, rain, wind) next to the satellite data for the same spot.
- **CO₂ context.** The NOAA CO₂ record beside the variables it drives.
- **Works on phones.** Panels become a bottom sheet; there is also a pink "marshmallow" theme on phones.

## How the answer is decided

| Step | Method |
|---|---|
| Trend at a place | Sen's slope; Mann-Kendall test with the Hamed-Rao autocorrelation correction |
| Many places at once | Benjamini-Hochberg false discovery rate at 5% across the map (cells that never change are left out) |
| Area averages | each 1° cell weighted by the share of the area it covers × cos(latitude) × the share of months with data |
| Verdict | not significant: "Looks fine here"; significant in the worrying direction (warming, sea level rise, less ice, lower pH, ...): "Not really okay"; significant where neither direction is plainly bad (rain, wind, currents): "Changing here" |
| Jump or trend | one step against a straight line, compared by BIC with the break year searched |
| El Niño | regression on the annual Niño 3.4 index computed from sea surface temperature |

Details are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Data

All variables are monthly, on one 1° × 1° grid, 2000-2025 unless noted.

| Group | Variables | Source |
|---|---|---|
| Atmosphere | air temperature (2 m), surface temperature, humidity, water vapour, 10 m wind, surface pressure | NASA MERRA-2 |
| Atmosphere | aerosols (AOD), total ozone | NASA MERRA-2 |
| Atmosphere | precipitation | NASA GPM IMERG |
| Land | air and skin temperature, rain, evaporation, potential evaporation, soil moisture (3 layers), snow, sunlight, wind | NASA GLDAS Noah |
| Land | vegetation index (NDVI) | NASA MODIS Terra |
| Land | burned area (to 2020) | GFED5 |
| Ocean | sea surface temperature | NOAA OISST |
| Ocean | sea level | Copernicus Marine (DUACS) |
| Ocean | sea ice (to 2024) | NOAA/NSIDC |
| Ocean | salinity, ocean heat (0-700 m, 0-2000 m) | Met Office EN4 |
| Ocean | pH, pCO₂ (to 2024) | OceanSODA-ETHZ |
| Ocean | chlorophyll (from 2002) | NASA MODIS-Aqua |
| Ocean | ocean mass (from 2002) | NASA GRACE / GRACE-FO |
| Ocean | surface currents: speed, eastward, northward | NASA OSCAR |
| Other | weather stations | NOAA NCEI |
| Other | atmospheric CO₂ | NOAA GML |

Borders: Natural Earth (Ukraine's point-of-view edition). Globe imagery: NASA Blue Marble. NASA does not endorse this project. The processed dataset is public on [Hugging Face](https://huggingface.co/datasets/lilDorito/earth-trend-data), with a licence note for each source.

## Run it locally

Needs Python 3.11+ and Node 20+.

```bash
git clone https://github.com/lilDorito/Earth-System-Trend-Detective
cd Earth-System-Trend-Detective
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cd app/web && npm install && cd ../..

python scripts/dev.py --live   # real data, read from Hugging Face
python scripts/dev.py          # synthetic data, no network needed
```

Open http://localhost:5173 (the API runs on port 5055 and reloads on code changes). The dataset is pinned to one commit (`REVISION` in `src/dataset.py`), so everyone sees the same numbers, and no account or key is needed. With a local copy of the dataset, put `HF_DATASET_PATH=data/hf` in front of the command.

Tests: `pytest`. Front-end checks: `cd app/web && npx tsc --noEmit -p . && npm run build`.

## Rebuild the dataset from the sources

This takes several hours, mostly downloading. It needs free accounts for NASA Earthdata (`EARTHDATA_TOKEN`), Copernicus Marine (`CMEMS_USERNAME`, `CMEMS_PASSWORD`) and a NOAA NCEI token (`NCEI_TOKEN`), set in `.env`.

```bash
pip install -r requirements-ingest.txt

python scripts/ingest/nasa_grid.py run          # MERRA-2, GLDAS, IMERG grids
python scripts/ingest/nasa_grid.py assemble
python scripts/ingest/ocean.py run              # ocean grids, including OSCAR currents
python scripts/ingest/extra.py run --source co2,fires
python scripts/ingest/extra.py run --source aod,ozone,ndvi
python scripts/ingest/ncei.py stations          # weather stations, then:
python scripts/ingest/ncei.py download --part 0 --of 1
python scripts/ingest/ncei.py build --part 0 --of 1
python scripts/ingest/ncei.py merge
python scripts/ingest/regions.py                # Natural Earth region weights and the web's outline files

python scripts/ingest/hf_dataset.py build       # one grid per variable, annual means, trend maps, insights
python scripts/ingest/hf_dataset.py verify      # compares every grid with its source
```

`HF_DATASET_PATH=data/hf python scripts/dev.py --live` then runs the app on the rebuilt copy. Every step, its options and the credentials each source needs are in [scripts/ingest/README.md](scripts/ingest/README.md).

## Deploy

- **API** on Render: `render.yaml` is a blueprint (Python, `uvicorn app.api.main:app`). Set `DATA_MODE=live` and `CORS_ORIGINS` to the site's address. The free plan has 512 MB, which the API fits by precomputed trend files and small caches.
- **Website** on Vercel: root `app/web`, build `npm run build`, output `dist`. Set `VITE_DATA_SOURCE=api` and `VITE_API_URL` to the API's address.
- **New dataset version:** `hf upload lilDorito/earth-trend-data data/hf . --repo-type dataset`, then put the new commit hash in `REVISION` in `src/dataset.py`.

## Project layout

```
app/api/            FastAPI: trend map, insights, stations
app/web/            React + TypeScript + Vite website
  src/features/     globe (three.js shaders), trendmap (panels, styles, verdict), stations, charts
  src/components/   tutorial, tooltips, UI parts
  public/regions/   country, province and sea outlines for the map
src/                dataset access, grid trends, insights, stations
scripts/ingest/     download and convert every source, build the Hugging Face dataset
scripts/dev.py      runs the API and the website together
tests/              pytest suite on a tiny local copy of the dataset
docs/               architecture and AI use
```

**Built with:** Python (NumPy, SciPy, pandas, pyarrow, pymannkendall, FastAPI), React, TypeScript, Vite, three.js with react-three-fiber, ECharts, Tailwind CSS. Hosted on Render, Vercel and Hugging Face.

## Docs

- [Architecture](docs/ARCHITECTURE.md): how it works
- [AI use](docs/AI_DISCLOSURE.md): how we used AI
- [Data ingestion](scripts/ingest/README.md): every source and how it is processed
