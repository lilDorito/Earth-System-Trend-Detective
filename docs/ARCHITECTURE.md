# Architecture

## Data flow

## The contract (`src/contracts.py`)

## Adding a data source

## Giovanni notes

## Statistics notes

### Global trend map (`src/gridtrends.py`, `app/api/trendmap.py`)

- Input: annual mean T2M per grid cell (`data/grid/annual.npz`, built by `scripts/prepare_grid.py`), or a synthetic demo field.
- Grid layer: vectorized Mann-Kendall + Sen's slope per cell, p-value with a simplified lag-1 autocorrelation variance factor, Benjamini-Hochberg FDR at 5% across cells. Fast but approximate: p differs slightly from pymannkendall's Hamed-Rao.
- Point endpoint: `pymannkendall.hamed_rao_modification_test` on the nearest cell (Sen slope identical to the grid layer), plus the FDR flag from the grid.
- Frontend: `features/trendmap/` (R3F globe, ECharts, Zustand store `useTrendMapStore`).

