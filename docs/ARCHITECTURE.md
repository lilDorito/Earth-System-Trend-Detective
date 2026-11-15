# Architecture

```
sources (NASA, NOAA, ...) --scripts/ingest--> Hugging Face dataset --FastAPI (Render)--> React app (Vercel)
                                              grids, trends, insights   reads ranges        globe + panels
```

## Data

`scripts/ingest/` downloads each source and puts it on one grid: monthly values, 1 degree, 2000-2025. `hf_dataset.py` writes the dataset:

| Path | Contents | Used by the app for |
|---|---|---|
| `annual/<var>.parquet` | annual means per cell (a year needs 9 months) | point and region panels, custom year ranges |
| `trends/<var>.npz` | precomputed whole-record trend grid, significance, year maps, colour scales | the map |
| `trends/_wind.npz`, `_current.npz` | mean 10 m wind and surface current vectors | the drifting streaks |
| `insights/cells.npz`, `regions.npz` | per-cell statistics for every variable, annual series for every region | quick analysis, what else is changing |
| `regions/` | Natural Earth countries, provinces and seas as cell weights | areas |
| `stations/` | NCEI monthly station data | stations |
| `series/co2.parquet` | NOAA GML monthly CO₂ | the CO₂ chart |
| `catalog.parquet` | units, period, licence and value range per variable | everything |
| `grid/<var>.parquet` | monthly values per cell, one row group per latitude band | not read by the app; for anyone using the dataset |

The API reads the dataset straight from the Hub with ranged reads (`src/dataset.py`), pinned to one commit (`REVISION`). `HF_DATASET_PATH=data/hf` reads a local copy instead.

## Statistics

- **Trend:** Sen's slope with Mann-Kendall, corrected for lag-1 autocorrelation (Hamed-Rao at a point, a simplified variance factor on the grid).
- **Many tests at once:** Benjamini-Hochberg FDR at 5%, across cells on the map (cells that never change are left out) and across variables in the scanner.
- **Areas:** each cell is weighted by the share of the area it covers × cos(lat) × the share of months with data. Several regions add their shares, capped at a whole cell.
- **Verdict** (`app/web/src/features/trendmap/verdict.ts`): a trend that is not significant reads "Looks fine here"; a significant one in the worrying direction (warming, sea level rise, less ice, lower pH, ...) "Not really okay"; a significant one where neither direction is plainly bad (rain, wind, currents, ...) "Changing here".
- **Quick analysis** (`src/insights.py`): trend against a single jump (BIC, break year searched), start-year robustness, agreement with an independent product of the same quantity, regression on the Niño 3.4 index, and years still needed for p < 0.05.

## API (`app/api/`, FastAPI)

- `trendmap.py`: map layers, year frames, point and region panels (a preset, a region, several regions or a box), wind and current vectors (`/flow`), CO₂.
- `insights.py`: what else is changing (`/scan`) and quick analysis (`/diagnose`).
- `stations.py`: station trends and station-against-grid comparison.
- `main.py`: health and the region list (`/api/boundaries`).

The whole-record map reads precomputed files, so opening a variable takes about 0.2 s. Custom year ranges are computed on request. Render's free plan has 512 MB, so heavy loads run one at a time behind a lock, at most three variables stay in memory, and gzipped responses are cached.

## Frontend (`app/web/`, React + TypeScript + Vite)

- **Globe:** react-three-fiber. The trend field is a shader on a sphere: palette, significance dots and land mask on the GPU. Wind and current streaks, contours and outlines are separate layers.
- **State:** Zustand stores. **Charts:** ECharts with wheel zoom, drag and a hover readout. **UI:** Tailwind and shadcn/ui.
- **Regions:** outlines and the click lookup read static files in `public/regions/`, so they cost no API call. Region mode picks a country or sea; with "Several" each click adds or removes a region.
- **Layout:** panels stack on the right on wide screens and form a bottom sheet on phones; the globe stays put when a panel opens.
- **Tutorial:** `components/Tutorial.tsx` lights up one control at a time (`data-tour` attributes) and waits for the reader to click the globe.
- **Mock mode:** a synthetic data source in the browser with the same interface, so the UI runs without the backend.
