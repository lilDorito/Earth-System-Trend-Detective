# Is Earth okay?

> NASA Space Apps Challenge 2026 · *Be An Earth System Trend Detective!*

**Live:** https://earth-system-trend-detective-nasa.vercel.app

Pick a place and a measurement, and the map answers the question in its name: *Not really okay: +0.4 °C per decade*, or *Looks fine here*. Behind every answer is a test of whether the change is real or just the usual ups and downs, on 38 climate and ocean variables (2000-2025) from NASA, NOAA and partner datasets, plus 1,800 weather stations.

## Features

- **Trend map.** A globe coloured by how fast any variable changed since 2000. Dots mark changes too steady to be chance. Switch between change and actual values, play the years one by one, or watch wind and ocean currents drift across it.
- **Any place.** Click a point, a country, a province or a sea, pick several regions at once, or draw a box. The panel gives a one-line verdict, the trend in plain words, how it compares with the world average, and a chart you can zoom.
- **Quick analysis.** Short checks that help interpret a trend: is it clear yet, is it steady or one jump, does it hold from any start year, does a second dataset agree, how much is El Niño.
- **What else is changing.** Every variable at the same place, strongest change first.
- **Clear warnings.** Clicking land for an ocean measurement, or the sea for a land one, says so instead of guessing.
- **Stations against satellites.** Ground weather stations next to the satellite data for the same spot.
- **Tutorial and demos.** A step-by-step tour on the first visit, tooltips on everything, and ready-made questions that open the map ready to answer them.

## Run locally

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cd app/web && npm install && cd ../..
python scripts/dev.py          # web on :5173, API on :5055, synthetic data
python scripts/dev.py --live   # real data from the Hugging Face dataset
```

Put `HF_DATASET_PATH=data/hf` in front to read a local copy of the dataset instead of the Hub. Tests: `pytest`.

## Data

All data is in the public [earth-trend-data](https://huggingface.co/datasets/lilDorito/earth-trend-data) dataset on Hugging Face, built by `scripts/ingest/` (see its [README](scripts/ingest/README.md)). Sources: NASA MERRA-2, GLDAS, GPM IMERG, MODIS, GRACE and OSCAR; NOAA OISST, NSIDC sea ice, NCEI stations and GML CO₂; Copernicus sea level; Met Office EN4; OceanSODA-ETHZ; GFED5. Borders: Natural Earth. Globe imagery: NASA Blue Marble. NASA does not endorse this project.

## Docs

- [Architecture](docs/ARCHITECTURE.md): how it works
- [AI use](docs/AI_DISCLOSURE.md): how we used AI
