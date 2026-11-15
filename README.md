# Earth Trend Detective

> NASA Space Apps Challenge 2026 · *Be An Earth System Trend Detective!*

**Live:** https://earth-system-trend-detective-nasa.vercel.app

Pick a place on Earth and a variable, and find out whether it is really changing or just going up and down from year to year. Built on 35 gridded climate and ocean variables (2000-2025) from NASA, NOAA and partner datasets, plus 1,800 weather stations.

## Features

- **Trend map.** A globe coloured by the trend of any variable, with significant cells stippled (Mann-Kendall, Sen's slope, FDR 5%). Switch between change and actual values, play the years one by one, or overlay wind, isobars or the sea-ice edge.
- **Any area.** Click a point, a country, a province or a sea, or draw a box. You get the area's trend, how it compares with the world average, and one stripe per year.
- **Trust checks.** Is it a trend or a single jump? Does it hold if you start a few years later? Does an independent dataset agree? How much of it is El Niño? How many more years are needed to be sure?
- **Every variable at once.** Ranks what changed most at a place, with false discoveries controlled across variables.
- **Process fingerprints.** Finds where several signals line up, for example drying out (less rain, drier soil, warmer air) or ocean warming with acidification.
- **Stations against satellites.** Weather station trends next to the grid cell they sit in.
- **Explorer.** Monthly series for a place, with a trend test or a before/after test around a date.
- **Demos and Learn.** Ready-made cases, mostly about Ukraine, and short explainers for students.

## Run locally

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cd app/web && npm install && cd ../..
python scripts/dev.py          # web on :5173, API on :5055, synthetic data
python scripts/dev.py --live   # real data from the Hugging Face dataset
```

Tests: `pytest`.

## Data

All data is in the public [earth-trend-data](https://huggingface.co/datasets/lilDorito/earth-trend-data) dataset on Hugging Face, built by `scripts/ingest/` (see its [README](scripts/ingest/README.md)). Sources: NASA MERRA-2, GLDAS, GPM IMERG, MODIS and GRACE; NOAA OISST, NSIDC sea ice, NCEI stations and GML CO₂; Copernicus sea level; Met Office EN4; OceanSODA-ETHZ; GFED5. Borders: Natural Earth. Globe imagery: NASA Blue Marble. NASA does not endorse this project.

## Docs

- [Architecture](docs/ARCHITECTURE.md): how it works
- [AI use](docs/AI_DISCLOSURE.md): how we used AI
