# Architecture

## Data flow

## The contract (`src/contracts.py`)

## Adding a data source

## Giovanni notes

## Statistics notes

- Trend (`stats.analyze_trend`): OLS slope and 95% CI on deseasonalized monthly anomalies (CI is optimistic: autocorrelation). Significance and Sen's slope from Mann-Kendall with the Hamed-Rao correction; seasonal Mann-Kendall if the seasonal cycle is kept.
- Event (`stats.analyze_event`): mean before vs after the date, Welch t-test with effective sample size n*(1-r1)/(1+r1) per side. With deseasonalized data the means are anomalies, so `pct_change` is null. Needs at least 6 months per side (HTTP 422 otherwise). Shows association with a date, not proof of cause.

### Global trend map (`src/gridtrends.py`, `app/api/trendmap.py`)

- Input (live): annual means per 1-degree cell from the Hugging Face dataset (`src/dataset.py`, `annual/<variable>.parquet`), any of 31 variables. Years the record does not cover in all 12 months are dropped, and a cell-year needs at least 9 months. Mock: a local `data/grid/annual.npz` or a synthetic field.
- Grid layer: vectorized Mann-Kendall + Sen's slope per cell on the real year spacing (records with gaps stay correct), p-value with a simplified lag-1 autocorrelation variance factor, Benjamini-Hochberg FDR at 5% across cells. Only cells with every year present are tested. Fast but approximate: p differs slightly from pymannkendall's Hamed-Rao.
- Point endpoint: `pymannkendall.hamed_rao_modification_test` on the nearest cell with data (up to 3 degrees away), Sen slope on the real years, plus the FDR flag from the grid.
- Colour scales come from the data (`/meta`: 95th percentile of |trend|, 98th of |anomaly|, rounded to 1, 2, 2.5 or 5 x 10^n). Year frames are sent on a 2-degree grid; responses are gzipped.
- Explorer series (`hf_grid` source): one Parquet row group per latitude band, so a point read fetches about 0.3 MB; file footers are cached per process.
- Areas: a location is a point, a box or a region (`{"type": "region", "id": "ukr"}`, ids from `/api/boundaries`). Box and region means weight each cell by `frac * cos(lat) * valid_frac`, where `frac` is the share of the cell inside the area: computed exactly for boxes (west > east crosses 180 degrees), precomputed from Natural Earth polygons for regions (`scripts/ingest/regions.py`). The response meta carries `cells` and `coverage` (share of the area with data, low for land variables over sea and the reverse). Bands are read in parallel: a Russia-sized area takes about 2 s cold.
- Trend map regions: presets are boxes, except Ukraine, which uses its boundary on live data; any boundary id or a box (`south, north, west, east`) works there too.
- Overlay styles (`features/trendmap/styles.ts`): each variable has a change palette (diverging, dark middle so near-zero change fades into the globe) and a values palette (sequential, cmocean-like), plus flags: `log` (chlorophyll), `signed` (sea level, wind components), `isobars` (surface pressure: lines and H/L instead of fills), `edge` (sea ice: 15% edge of the first year against the year shown), `wind` (particles along the mean MERRA-2 10 m wind from `/api/trendmap/wind`). The Change/Values switch picks trends and anomalies or the annual means (`/frames?kind=values`, colour range from `/meta` `value_range`). Significant cells are stippled in the shader. `merra2_wind10m` is a virtual variable: the speed of the annual mean wind vector, built from u and v in `src/dataset.py`.
- Frontend areas: region search and outlines read static files in `public/regions/` (no API call, so they work in mock mode); the mock answers a region from its bounding box. `GlobeCanvas` takes `outline` (rings) and `onBox`; shift-drag or the box tool draws a box (`BoxDraw`, which disables the orbit controls in the capture phase so the drag does not rotate the globe).
- Frontend: `features/trendmap/` (panels, trend layer) on top of the shared `features/globe/GlobeCanvas`, Zustand store `useTrendMapStore`. In mock mode the grid comes from `src/api/mock/trendmap.ts`.

