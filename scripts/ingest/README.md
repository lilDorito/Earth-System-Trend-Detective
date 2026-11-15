# Data ingestion scripts

Three command-line tools that build the local datasets for the project. All outputs go to `data/` (git-ignored); the folders can be moved with `NCEI_DIR`, `OCEAN_DIR`, `EXTRA_DIR` and `NASA_GRID_DIR`.

```
python -m pip install -r requirements-ingest.txt
```

Secrets are read from `.env` in the project root (or from environment variables):

| Variable | Used by | How to get it |
|---|---|---|
| `NCEI_TOKEN` | `ncei.py` | https://www.ncei.noaa.gov/cdo-web/token (5 requests/s, 10 000/day per token) |
| `EARTHDATA_TOKEN` | `ocean.py` (chl, grace, oscar), `extra.py` (aod, ozone), `nasa_grid.py` | https://urs.earthdata.nasa.gov, Generate Token (expires, renew on 401/403) |
| `CMEMS_USERNAME`, `CMEMS_PASSWORD` | `ocean.py` (sealevel) | free account at https://data.marine.copernicus.eu |

## NCEI station data (`ncei.py`)

Monthly GSOM summaries (18 variables, 2000 to 2026-09) for a worldwide set of stations.

```
python scripts/ingest/ncei.py stations                  # once: choose stations -> data/ncei/processed/stations_selected.csv
python scripts/ingest/ncei.py extra-stations            # once: add 1-2 stations for every country that has none
python scripts/ingest/ncei.py download --part 0 --of 4  # parts 0..3, can be split between people
python scripts/ingest/ncei.py build    --part 0 --of 4
python scripts/ingest/ncei.py merge                     # -> monthly_long.parquet, monthly_wide.parquet, stations.csv
```

API responses are cached, the daily request counter stops at 9 500, and every command can be rerun: finished stations are skipped.

## Ocean grids (`ocean.py`)

Monthly 1x1 degree NetCDF grids, 2000-2025, one file per variable in `data/ocean/processed/<variable>.nc`
(`time`, `lat` -89.5..89.5, `lon` -179.5..179.5), plus `catalog.csv` with coverage.

| Variable | Description | Source | Period |
|---|---|---|---|
| `sst` | sea surface temperature, degC | NOAA OISST v2.1 | 2000-2025 |
| `sla` | sea level anomaly, m | CMEMS DUACS | 2000-2025 |
| `sea_ice_conc` | sea ice concentration, 0-1 | NOAA/NSIDC CDR v4 | 2000-2024, polar cells only |
| `sss` | sea surface salinity, psu | EN4.2.2 | 2000-2025 |
| `sal_0_700` | mean salinity 0-700 m, psu | EN4.2.2 | 2000-2025 |
| `ohc_0_700`, `ohc_0_2000` | ocean heat content, J/m2 | EN4.2.2 | 2000-2025 |
| `ph`, `pco2` | surface pH, pCO2 (uatm) | OceanSODA-ETHZ | 2000-2024 |
| `chlor_a` | chlorophyll-a, mg/m3 | NASA MODIS-Aqua | 2002-07 to 2025 |
| `u_current`, `v_current` | surface currents, m/s | NASA OSCAR | 2000-2025 |
| `ocean_mass` | ocean mass, cm of water | GRACE/GRACE-FO (JPL) | 2002-04 to 2025, gap 2017-07..2018-05 |

```
python scripts/ingest/ocean.py list                              # variables and sources
python scripts/ingest/ocean.py run                               # everything, then merge
python scripts/ingest/ocean.py run --source oscar --workers 8    # one source, 8 months in parallel
python scripts/ingest/ocean.py run --source oscar --workers 8 --oscar-step 5   # every 5th daily file, about 5x faster
python scripts/ingest/derive_current.py                          # current_speed.nc and current_direction.nc from u and v
python scripts/ingest/ocean.py merge                             # rebuild the merged files and catalog.csv
```

`run` checks credentials and disk space, skips sources it cannot run with a clear message, retries failing sources (`--passes`), writes `data/ocean/run.log` and prints a summary. Raw files are deleted after processing (`--keep-raw` keeps them). If a server is down, rerun the same command later: finished years are skipped. A file that cannot be downloaded automatically (for example OceanSODA) can be placed by hand into `data/ocean/raw/<source>/`.

OSCAR files store `u` and `v` as `(time, longitude, latitude)`; the script transposes them by dimension name. `derive_current.py` adds `current_speed` (m/s, `sqrt(u^2 + v^2)` of the monthly mean vector) and `current_direction` (degrees clockwise from north, direction the water flows towards). The monthly mean vector understates the mean speed where the current changes direction.

## Extra grids: aerosols, ozone, vegetation, fires, CO2 (`extra.py`)

Monthly 1x1 degree NetCDF grids (same layout as the ocean grids, 2000-2025) in `data/extra/processed/<variable>.nc`, plus `co2_monthly.csv` and `catalog.csv`.

| Output | Description | Source | Access | Period |
|---|---|---|---|---|
| `aod` | total aerosol optical thickness at 550 nm (`TOTEXTTAU`) | MERRA-2 `M2TMNXAER` v5.12.4, NASA GES DISC | `EARTHDATA_TOKEN` | 2000-2025 |
| `to3` | total column ozone, DU (`TO3`) | MERRA-2 `M2TMNXCHM` v5.12.4, NASA GES DISC | `EARTHDATA_TOKEN` | 2000-2025 |
| `ndvi` | NDVI | MODIS Terra MOD13C2 v061, NetCDF mirror of the University of Hamburg ICDC (https://icdc.cen.uni-hamburg.de/thredds/catalog/ftpthredds/modis_terra_vegetationindex/catalog.html) | public | 2000-02 to 2025-07 |
| `burned_area` | burned area, km2 per 1 degree cell per month | GFED5 burned area, Chen et al. 2023 (https://zenodo.org/records/7668424, `BA.zip`) | public | 2000-2020 |
| `co2_monthly.csv` | CO2, ppm: global marine surface and Mauna Loa | NOAA GML (`co2_mm_gl`, `co2_mm_mlo`) | public | 2000-2025 |

```
python scripts/ingest/extra.py list
python scripts/ingest/extra.py run --source co2,fires
python scripts/ingest/extra.py run --source aod,ozone --workers 3
python scripts/ingest/extra.py run --source ndvi --years 2000-2012    # windows can run in two terminals at once
python scripts/ingest/extra.py status                                 # progress per variable and the last log lines
python scripts/ingest/extra.py merge                                  # rebuild <variable>.nc and catalog.csv from the monthly cache
```

Every finished month is cached in `data/extra/processed/months/<variable>/`, so a run can be stopped and repeated; `run.log` and `processed/status.json` show the progress and ETA. Months missing at the source get a `.none` marker (delete it to try that month again).

MERRA-2 downloads need the GES DISC application to be authorized for your Earthdata account (Applications, Authorized Apps), otherwise every file fails with `EulaNotAccepted`. NDVI is read through OPeNDAP with every `--stride`-th 0.05 degree cell (default 5) so the 726 MB monthly files are not downloaded in full; if OPeNDAP fails the script downloads the file, processes it and deletes it. Aerosols, ozone and NDVI are averaged into 1 degree cells, burned area is summed.

Caveats: burned area ends in 2020, NDVI has no January 2000 and ends in 2025-07. MERRA-2 aerosol and ozone trends partly reflect changes in the assimilated observations, so check regional trends (the Southern Ocean aerosol increase, the ozone peak in 2024) before interpreting them. Analysis figures: `docs/figures/extra/`.

## NASA land and atmosphere grids (`nasa_grid.py`)

Monthly 1x1 degree grids, 2000-2025, for 20 variables from three NASA GES DISC products. Granules are streamed through `earthaccess` and regridded on the fly; raw files are never saved. Without `EARTHDATA_TOKEN` the first run asks for your Earthdata login and keeps it in `~/.netrc`.

| Product | Variables | Domain |
|---|---|---|
| GLDAS Noah 0.25 deg v2.1 (`GLDAS_NOAH025_M`) | 12: `gldas_evap`, `gldas_precip`, `gldas_tair`, `gldas_skin_temp`, `gldas_soilmoist_0_10`, `gldas_soilmoist_10_40`, `gldas_rootmoist`, `gldas_swe`, `gldas_snowdepth`, `gldas_potevap`, `gldas_swdown`, `gldas_wind` | land only, 60S-90N |
| GPM IMERG Final v07 (`GPM_3IMERGM`) | `imerg_precip` | global, land and ocean |
| MERRA-2 (`M2TMNXSLV` 5.12.4) | 7: `merra2_t2m`, `merra2_ts`, `merra2_qv2m`, `merra2_tqv`, `merra2_u10m`, `merra2_v10m`, `merra2_ps` | global, land and ocean |

```
python scripts/ingest/nasa_grid.py list                       # variables, sources, units
python scripts/ingest/nasa_grid.py inspect gldas_evap         # check variable name and units in a real granule
python scripts/ingest/nasa_grid.py run --dry-run              # count granules still to process
python scripts/ingest/nasa_grid.py run gldas_evap gldas_precip gldas_tair gldas_soilmoist_0_10 gldas_swe gldas_rootmoist gldas_soilmoist_10_40 gldas_snowdepth gldas_skin_temp gldas_potevap gldas_swdown gldas_wind
python scripts/ingest/nasa_grid.py run imerg_precip
python scripts/ingest/nasa_grid.py run merra2_t2m merra2_ts merra2_qv2m merra2_tqv merra2_u10m merra2_v10m merra2_ps
python scripts/ingest/nasa_grid.py assemble                   # monthly slices -> one CSV per variable
python scripts/ingest/nasa_grid.py check --lat 50.5 --lon 30.5
```

The three `run` commands can be started in separate terminals (one per product). Variables of one product are read from each granule in a single pass. Finished months are skipped, so an interrupted run continues where it stopped. Network errors are retried with a growing pause.

Output in `data/nasa_grid/`:

- `parts/<variable>/YYYY-MM.csv` (`lat,lon,value,valid_frac`): intermediate monthly slices. Slices from before valid_frac was stored per month use the shared `parts/<variable>/valid_frac.csv` instead.
- `processed/<variable>.csv` (`date,lat,lon,value,valid_frac`): long format, `date` is the first day of the month, `lat`/`lon` are cell centers (integer + 0.5). Cells without data are omitted, there are no NaN rows. All 20 files take about 7 GB.

Regridding: each source cell goes to the 1 degree cell that contains its center and cells are averaged with weight `cos(latitude)`. `valid_frac` is the share of the cell's area covered by valid source data; cells below 0.5 are dropped. Units are converted to `mm/month` (precipitation, evapotranspiration), `degC` (temperatures) or kept as in the source (see `list`).

Analysis: `notebooks/01_nasa_grid_overview.ipynb` (integrity, coverage, global and latitude-band trends, per-cell trend maps, cross-checks between products); its figures are saved to `docs/figures/nasa_grid/`.

Known data caveats:

- IMERG has 309 of 312 months: 2025-10 to 2025-12 are not available (the series ends in 2025-09). 790 IMERG cells also have gaps in some months (not investigated). GLDAS and MERRA-2 have all 312 months.
- The MERRA-2 grid (0.5 x 0.625 deg) does not nest in 1 degree cells, so assigning by cell center shifts the averaging by up to about 0.25 deg. GLDAS and IMERG nest exactly.
- GLDAS has no data south of 60S, and its variables do not share one land mask: 15,332 cells for `gldas_tair`, `gldas_precip`, `gldas_swdown`, `gldas_wind` against 15,180 for the others. Use the common mask when comparing GLDAS variables.
- Open, not yet explained: several GLDAS series (root-zone moisture, potential evaporation, shortwave radiation, wind) show a step around 2010-2011, which looks like a change in model inputs rather than climate. The land-mean air-temperature trend of GLDAS (about +0.6 degC/decade) is roughly twice that of MERRA-2 (about +0.26 degC/decade) although their annual anomalies correlate (r about 0.7). `gldas_swe` and `gldas_snowdepth` take non-physical values over ice sheets (Greenland). Check these before interpreting trends of those variables.

## Hugging Face dataset (`hf_dataset.py`)

Converts the outputs above into the dataset the app reads, in `data/hf/` (about 1 GB instead of 7.4 GB):

```
python scripts/ingest/hf_dataset.py build                # all grids, stations, catalog and dataset card
python scripts/ingest/hf_dataset.py build sst merra2_t2m  # rebuild a few variables, the catalog keeps the rest
python scripts/ingest/hf_dataset.py verify               # compare every grid with its source
python scripts/ingest/hf_dataset.py trends               # trend map products only
python scripts/ingest/regions.py                         # region cell weights (Natural Earth)
hf upload lilDorito/earth-trend-data data/hf . --repo-type dataset
```

`build` also writes `trends/<variable>.npz` (whole-record trend grid, year maps and colour scales, read by the API instead of computing them; about 55 MB in total); `trends` rebuilds only those, e.g. after changing `src/trendmaps.py`, and then the cross-variable `insights/cells.npz` and `insights/regions.npz` (scanner, trust checks, ENSO; about 20 MB, needs the region weights). It reads the NASA CSVs from `data/nasa_grid/processed/` or `data/nasa_grid/`, the ocean NetCDFs from `data/ocean/processed/` and the station files from `data/ncei/processed/`. Grids become `grid/<variable>.parquet` (one schema for all: `date, lat, lon, value, valid_frac`, sorted by cell, one row group per latitude band, so reading one point costs about 0.3 MB) and `annual/<variable>.parquet` (annual means per cell for trend maps). `catalog.parquet` holds units, period, coverage, licence and a robust value range (`p02`, `p98`) per variable. The dataset repo is set by `HF_DATASET`.

## Region weights (`regions.py`)

Downloads Natural Earth 1:10m countries (Ukraine's point-of-view edition, so Crimea is part of Ukraine) and admin-1 regions into `data/raw/natural_earth/`, and writes `data/hf/regions/index.parquet` (id, name, kind, country, bounds, label point, area) and `regions/weights.parquet` (`id, lat, lon, frac`: share of each 1 degree cell inside the region). Shares below 1e-4 of a cell are dropped, except for regions smaller than that, which keep their biggest cell. Ids are lowercase `ADM0_A3` for countries (`ukr`) and `adm1_code` for admin-1 regions (`ukr-321`). Bounds use west > east for regions across 180 degrees. Unnamed admin-1 slivers (placeholder codes) are skipped. Needs `shapely`; takes about 10 s.

It also writes the frontend's copy to `app/web/public/regions/` (commit it, Vercel serves it): `index.json` for search and `outlines/<country>.json` with each country's and its regions' outlines, simplified to 0.02 degrees (about 5 MB in total, Ukraine 9 KB gzipped).
