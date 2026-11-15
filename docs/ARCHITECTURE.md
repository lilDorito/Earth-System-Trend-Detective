# Architecture

```
sources (NASA, NOAA, ...) --scripts/ingest--> Hugging Face dataset --FastAPI (Render)--> React app (Vercel)
                                              grids, trends, insights   reads ranges        globe + panels
```

## Data

`scripts/ingest/` downloads each source and puts it on one grid: monthly values, 1 degree, 2000-2025. `hf_dataset.py` writes the dataset:

| Path | Contents |
|---|---|
| `grid/<var>.parquet` | monthly values per cell, one row group per latitude band, so a point read is about 0.3 MB |
| `annual/<var>.parquet` | annual means per cell (a year needs 9 months) |
| `trends/<var>.npz` | precomputed whole-record trend grid, significance, year maps, colour scales |
| `insights/cells.npz`, `regions.npz` | per-cell statistics for every variable, annual series for every region |
| `regions/` | Natural Earth countries, provinces and seas as cell weights |
| `stations/` | NCEI monthly station data |
| `catalog.parquet` | units, period, licence and value range per variable |

The API reads the dataset straight from the Hub with ranged reads (`src/dataset.py`), pinned to one commit (`REVISION`). `HF_DATASET_PATH=data/hf` reads a local copy instead.

## Statistics

- **Trend:** Sen's slope with Mann-Kendall, corrected for lag-1 autocorrelation (Hamed-Rao at a point, a simplified variance factor on the grid).
- **Many tests at once:** Benjamini-Hochberg FDR at 5%, across cells on the map and across variables in the scanner.
- **Areas:** each cell is weighted by the share of the area it covers × cos(lat) × the share of months with data.
- **Trust checks** (`src/insights.py`): trend against a single jump (BIC, break year searched), start-year robustness, agreement with an independent product of the same quantity, regression on the Niño 3.4 index, and years still needed for p < 0.05.
- **Event mode** (explorer): mean before against mean after a date, Welch t-test with an effective sample size.

## API (`app/api/`, FastAPI)

- `trendmap.py`: map layers, year frames, point and region panels, wind.
- `insights.py`: scanner, trust checks, fingerprints (`configs/scenarios.yaml`), opposite trends.
- `stations.py`: station trends and station-against-grid comparison.
- `main.py`: explorer analysis (`POST /api/analyze`), variables, boundaries.

The whole-record map reads precomputed files, so opening a variable takes about 0.2 s. Custom year ranges are computed on request. Render's free plan has 512 MB, so heavy loads run one at a time behind a lock, at most three variables stay in memory, and gzipped responses are cached.

## Frontend (`app/web/`, React + TypeScript + Vite)

- **Globe:** react-three-fiber. The trend field is a shader on a sphere: palette, significance stipple and land mask on the GPU. Wind and ocean current streaks, contours and outlines are separate layers.
- **State:** Zustand stores per page. **Charts:** ECharts. **UI:** Tailwind and shadcn/ui.
- **Regions:** search and outlines read static files in `public/regions/`, so they cost no API call.
- **Layout:** panels stack on the right on wide screens and form a bottom sheet on phones, and the globe shifts to stay centred in the free space.
- **Mock mode:** a synthetic data source in the browser with the same interface, so the UI runs without the backend.

## Configuration

`configs/*.yaml` holds the variables, preset regions, demos and fingerprints, with no code.
