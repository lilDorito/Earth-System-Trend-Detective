# Architecture

## Data flow

## The contract (`src/contracts.py`)

## Adding a data source

## Giovanni notes

## Statistics notes

- Trend (`stats.analyze_trend`): OLS slope and 95% CI on deseasonalized monthly anomalies (CI is optimistic: autocorrelation). Significance and Sen's slope from Mann-Kendall with the Hamed-Rao correction; seasonal Mann-Kendall if the seasonal cycle is kept.
- Event (`stats.analyze_event`): mean before vs after the date, Welch t-test with effective sample size n*(1-r1)/(1+r1) per side. With deseasonalized data the means are anomalies, so `pct_change` is null. Needs at least 6 months per side (HTTP 422 otherwise). Shows association with a date, not proof of cause.

### Global trend map (`src/gridtrends.py`, `app/api/trendmap.py`)

- Input: annual mean T2M per grid cell (`data/grid/annual.npz`, built by `scripts/prepare_grid.py`), or a synthetic demo field.
- Grid layer: vectorized Mann-Kendall + Sen's slope per cell, p-value with a simplified lag-1 autocorrelation variance factor, Benjamini-Hochberg FDR at 5% across cells. Fast but approximate: p differs slightly from pymannkendall's Hamed-Rao.
- Point endpoint: `pymannkendall.hamed_rao_modification_test` on the nearest cell (Sen slope identical to the grid layer), plus the FDR flag from the grid.
- Frontend: `features/trendmap/` (panels, trend layer) on top of the shared `features/globe/GlobeCanvas`, Zustand store `useTrendMapStore`. In mock mode the grid comes from `src/api/mock/trendmap.ts`.

