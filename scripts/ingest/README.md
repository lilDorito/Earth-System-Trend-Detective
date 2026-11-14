# Data ingestion scripts

Two command-line tools that build the local datasets for the project. All outputs go to `data/` (git-ignored); the folders can be moved with `NCEI_DIR` and `OCEAN_DIR`.

```
python -m pip install -r requirements-ingest.txt
```

Secrets are read from `.env` in the project root (or from environment variables):

| Variable | Used by | How to get it |
|---|---|---|
| `NCEI_TOKEN` | `ncei.py` | https://www.ncei.noaa.gov/cdo-web/token (5 requests/s, 10 000/day per token) |
| `EARTHDATA_TOKEN` | `ocean.py` (chl, grace, oscar) | https://urs.earthdata.nasa.gov, Generate Token (expires, renew on 401/403) |
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
python scripts/ingest/ocean.py merge                             # rebuild the merged files and catalog.csv
```

`run` checks credentials and disk space, skips sources it cannot run with a clear message, retries failing sources (`--passes`), writes `data/ocean/run.log` and prints a summary. Raw files are deleted after processing (`--keep-raw` keeps them). If a server is down, rerun the same command later: finished years are skipped. A file that cannot be downloaded automatically (for example OceanSODA) can be placed by hand into `data/ocean/raw/<source>/`.
