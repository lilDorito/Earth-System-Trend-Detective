# builds the Hugging Face dataset (data/hf) from the ingested grids and stations, and verifies it
#
#   python scripts/ingest/hf_dataset.py build              # everything
#   python scripts/ingest/hf_dataset.py build sst merra2_t2m
#   python scripts/ingest/hf_dataset.py verify
#   python scripts/ingest/hf_dataset.py trends             # trend map products only (build runs it too)
#   hf upload lilDorito/earth-trend-data data/hf . --repo-type dataset

import argparse
import os
import time
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.csv as pacsv
import pyarrow.parquet as pq
from common import ROOT, load_env

load_env()
import nasa_grid  # noqa: E402  (variable tables only)
import ocean  # noqa: E402

OUT = Path(os.environ.get("HF_DATASET_DIR", ROOT / "data" / "hf"))
NASA_DIR = Path(os.environ.get("NASA_GRID_DIR", ROOT / "data" / "nasa_grid"))
OCEAN_DIR = Path(os.environ.get("OCEAN_DIR", ROOT / "data" / "ocean")) / "processed"
EXTRA_DIR = Path(os.environ.get("EXTRA_DIR", ROOT / "data" / "extra")) / "processed"
NCEI_DIR = Path(os.environ.get("NCEI_DIR", ROOT / "data" / "ncei")) / "processed"
REPO = os.environ.get("HF_DATASET", "lilDorito/earth-trend-data")

GRID_SCHEMA = pa.schema(
    [
        ("date", pa.date32()),
        ("lat", pa.float32()),
        ("lon", pa.float32()),
        ("value", pa.float32()),
        ("valid_frac", pa.float32()),
    ]
)


# dictionary for coordinates and ids, byte-stream-split for measured floats (dictionaries bloat noisy values)
def encoding(schema: pa.Schema) -> dict:
    floats = [f.name for f in schema if pa.types.is_floating(f.type) and f.name not in ("lat", "lon")]
    return dict(
        compression="zstd",
        compression_level=9,
        write_statistics=True,
        use_dictionary=[name for name in schema.names if name not in floats],
        use_byte_stream_split=floats,
    )


LICENSES = {
    "NASA": "NASA Earth science data, no restrictions on use; credit the source",
    "NOAA": "NOAA open data, public domain; credit the source",
    "CMEMS": "Copernicus Marine Service licence: free use and redistribution with attribution",
    "EN4": "Met Office EN4, Non-Commercial Government Licence: non-commercial use with attribution",
    "OceanSODA": "CC BY 4.0 (Gregor and Gruber, OceanSODA-ETHZ)",
    "GFED5": "CC BY 4.0 (Chen et al. 2023, GFED5 burned area)",
}

# grids from scripts/ingest/extra.py: (units, name, group, domain, product)
EXTRA = {
    "aod": ("1", "Aerosol optical depth at 550 nm (MERRA-2)", "atmosphere", "global", "M2TMNXAER v5.12.4"),
    "to3": ("DU", "Total column ozone (MERRA-2)", "atmosphere", "global", "M2TMNXCHM v5.12.4"),
    "ndvi": ("1", "Vegetation index NDVI (MODIS Terra)", "land", "land", "MOD13C2 v061"),
    "burned_area": ("km2/month", "Burned area (GFED5)", "land", "land", "GFED5"),
}


def license_of(desc: str) -> str:
    if "GFED5" in desc:
        return LICENSES["GFED5"]
    if "EN4" in desc:
        return LICENSES["EN4"]
    if "OceanSODA" in desc:
        return LICENSES["OceanSODA"]
    if "CMEMS" in desc:
        return LICENSES["CMEMS"]
    if "NOAA" in desc or "NSIDC" in desc:
        return LICENSES["NOAA"]
    return LICENSES["NASA"]


def variables() -> dict[str, dict]:
    out = {}
    for key, spec in nasa_grid.VARIABLES.items():
        group, domain = ("land", "land") if key.startswith("gldas") else ("atmosphere", "global")
        out[key] = dict(kind="csv", units=spec["units"], name=spec["desc"], group=group, domain=domain,
                        product=f"{spec['short_name']} v{spec['version']}")
    for key, (units, desc) in ocean.VARS.items():
        out[key] = dict(kind="nc", units=units, name=desc, group="ocean", domain="ocean", product=desc.split("(")[-1].rstrip(")"))
    for key, (units, desc, group, domain, product) in EXTRA.items():
        out[key] = dict(kind="extra", units=units, name=desc, group=group, domain=domain, product=product)
    return out


def source_path(key: str, kind: str) -> Path | None:
    candidates = {
        "csv": [NASA_DIR / "processed" / f"{key}.csv", NASA_DIR / f"{key}.csv"],
        "nc": [OCEAN_DIR / f"{key}.nc"],
        # extra.py writes to data/extra/processed; files dropped straight into data/ work too
        "extra": [EXTRA_DIR / f"{key}.nc", ROOT / "data" / f"{key}.nc"],
    }[kind]
    return next((p for p in candidates if p.exists()), None)


def read_csv(path: Path) -> pa.Table:
    types = {name: GRID_SCHEMA.field(name).type for name in GRID_SCHEMA.names}
    return pacsv.read_csv(path, convert_options=pacsv.ConvertOptions(column_types=types)).select(GRID_SCHEMA.names)


def read_nc(path: Path, key: str) -> pa.Table:
    import xarray as xr

    with xr.open_dataset(path) as ds:
        data = ds[key].transpose("time", "lat", "lon").values.astype(np.float32)
        dates = ds["time"].values.astype("datetime64[D]")
        lat = ds["lat"].values.astype(np.float32)
        lon = ds["lon"].values.astype(np.float32)
    t, i, j = np.nonzero(np.isfinite(data))
    return pa.table(
        {
            "date": pa.array(dates[t], pa.date32()),
            "lat": lat[i],
            "lon": lon[j],
            "value": data[t, i, j],
            "valid_frac": pa.nulls(len(t), pa.float32()),
        },
        schema=GRID_SCHEMA,
    )


# one row group per latitude band, sorted by cell then date, so a point series is one small ranged read
def write_grid(table: pa.Table, path: Path) -> None:
    table = table.sort_by([("lat", "ascending"), ("lon", "ascending"), ("date", "ascending")])
    lats = table["lat"].to_numpy()
    edges = np.flatnonzero(np.diff(lats)) + 1
    starts, ends = np.r_[0, edges], np.r_[edges, len(lats)]
    with pq.ParquetWriter(path, GRID_SCHEMA, **encoding(GRID_SCHEMA)) as writer:
        for a, b in zip(starts, ends):
            writer.write_table(table.slice(a, b - a))


def write_annual(table: pa.Table, path: Path) -> None:
    years = pc.year(table["date"]).cast(pa.int16())
    grouped = (
        table.select(["lat", "lon", "value"])
        .append_column("year", years)
        .group_by(["year", "lat", "lon"])
        .aggregate([("value", "mean"), ("value", "count")])
    )
    annual = pa.table(
        {
            "year": grouped["year"],
            "lat": grouped["lat"],
            "lon": grouped["lon"],
            "value": grouped["value_mean"].cast(pa.float32()),
            "months": grouped["value_count"].cast(pa.int8()),
        }
    ).sort_by([("year", "ascending"), ("lat", "ascending"), ("lon", "ascending")])
    pq.write_table(annual, path, **encoding(annual.schema))


def summary(key: str, meta: dict, table: pa.Table) -> dict:
    values = table["value"]
    dates = table["date"]
    low, high = pc.quantile(values, q=[0.02, 0.98], interpolation="nearest").to_pylist()
    cells = pa.table({"lat": table["lat"], "lon": table["lon"]}).group_by(["lat", "lon"]).aggregate([]).num_rows
    return dict(
        key=key,
        name=meta["name"],
        units=meta["units"],
        group=meta["group"],
        domain=meta["domain"],
        product=meta["product"],
        license=license_of(meta["name"]),
        start=str(pc.min(dates).as_py())[:7],
        end=str(pc.max(dates).as_py())[:7],
        months=pc.count_distinct(dates).as_py(),
        cells=cells,
        rows=table.num_rows,
        min=pc.min(values).as_py(),
        max=pc.max(values).as_py(),
        p02=low,
        p98=high,
    )


def build_grids(keys: list[str]) -> list[dict]:
    (OUT / "grid").mkdir(parents=True, exist_ok=True)
    (OUT / "annual").mkdir(parents=True, exist_ok=True)
    rows = []
    for key, meta in variables().items():
        if keys and key not in keys:
            continue
        path = source_path(key, meta["kind"])
        if path is None:
            print(f"  skip {key}: no source file")
            continue
        started = time.time()
        table = read_csv(path) if meta["kind"] == "csv" else read_nc(path, key)
        if key in LAND_ONLY and (OUT / "regions" / "weights.parquet").exists():
            table = land_cells(table)
        if not table.num_rows:
            print(f"  skip {key}: no values")
            continue
        write_grid(table, OUT / "grid" / f"{key}.parquet")
        write_annual(table, OUT / "annual" / f"{key}.parquet")
        rows.append(summary(key, meta, table))
        size = (OUT / "grid" / f"{key}.parquet").stat().st_size / 1e6
        print(f"  {key:24s} {table.num_rows:>11,} rows  {path.stat().st_size / 1e6:7.1f} MB -> {size:6.1f} MB  {time.time() - started:5.1f}s")
    return rows


def build_stations() -> None:
    out = OUT / "stations"
    out.mkdir(parents=True, exist_ok=True)
    wide = pq.read_table(NCEI_DIR / "monthly_wide.parquet")
    columns = {"station_id": wide["station_id"].cast(pa.string()), "date": wide["date"].cast(pa.date32())}
    columns |= {name: wide[name].cast(pa.float32()) for name in wide.column_names if name not in columns}
    wide = pa.table(columns).sort_by([("station_id", "ascending"), ("date", "ascending")])
    pq.write_table(wide, out / "monthly.parquet", row_group_size=20_000, **encoding(wide.schema))
    for name in ("stations", "trends_station"):
        table = pa.Table.from_pandas(pd.read_csv(NCEI_DIR / f"{name}.csv"), preserve_index=False)
        pq.write_table(table, out / f"{name}.parquet", **encoding(table.schema))
    print(f"  stations: {wide.num_rows:,} station-months, {pq.read_metadata(out / 'stations.parquet').num_rows:,} stations")


# global monthly series (NOAA GML CO2) next to the grids: series/<name>.parquet
def build_series() -> None:
    sources = [EXTRA_DIR / "co2_monthly.csv", ROOT / "data" / "co2_monthly.csv"]
    path = next((p for p in sources if p.exists()), None)
    if path is None:
        return
    frame = pd.read_csv(path, parse_dates=["time"])
    (OUT / "series").mkdir(exist_ok=True)
    frame.astype({c: "float32" for c in frame.columns if c != "time"}).to_parquet(OUT / "series" / "co2.parquet", index=False, compression="zstd")
    print(f"  series: co2, {len(frame)} months ({frame['time'].min():%Y-%m} to {frame['time'].max():%Y-%m})")


# GFED stores zeros over the ocean; "never burns" there would dilute every regional mean
LAND_ONLY = {"burned_area"}


def land_cells(table: pa.Table) -> pa.Table:
    # cells that overlap any country (Natural Earth, regions/weights.parquet)
    weights = pq.read_table(OUT / "regions" / "weights.parquet").to_pandas()
    index = pq.read_table(OUT / "regions" / "index.parquet", columns=["id", "kind"]).to_pandas()
    countries = set(index.loc[index["kind"] == "country", "id"])
    land = weights[weights["id"].isin(countries)][["lat", "lon"]].drop_duplicates()
    keys = pa.array((np.rint((land["lat"] + 89.5)) * 360 + np.rint(land["lon"] + 179.5)).astype(np.int32))
    cell = pc.cast(pc.add(pc.multiply(pc.round(pc.add(table["lat"], 89.5)), 360), pc.round(pc.add(table["lon"], 179.5))), pa.int32())
    return table.filter(pc.is_in(cell, value_set=keys))


def write_catalog(rows: list[dict]) -> pd.DataFrame:
    path = OUT / "catalog.parquet"
    catalog = pd.DataFrame(rows)
    if path.exists():
        old = pd.read_parquet(path)
        catalog = pd.concat([old[~old["key"].isin(catalog["key"])], catalog])
    order = list(variables())
    catalog = catalog.sort_values("key", key=lambda s: s.map(order.index)).reset_index(drop=True)
    catalog.to_parquet(path, index=False, compression="zstd")
    return catalog


CARD = """---
pretty_name: Earth Trend Detective data
license: other
license_name: mixed-open-data
license_link: LICENSE.md
tags: [climate, earth-observation, nasa, noaa, time-series, geospatial]
size_categories: [100M<n<1B]
configs:
  - config_name: catalog
    data_files: catalog.parquet
  - config_name: stations
    data_files: stations/stations.parquet
  - config_name: station_trends
    data_files: stations/trends_station.parquet
  - config_name: station_monthly
    data_files: stations/monthly.parquet
  - config_name: regions
    data_files: regions/index.parquet
---

# Earth Trend Detective data

Monthly 1 x 1 degree grids, 2000 to 2025, for {count} variables (atmosphere, land and ocean), plus monthly
station summaries from NOAA NCEI. Built for [Earth Trend Detective](https://github.com/lilDorito/Earth-System-Trend-Detective)
from public NASA, NOAA, Copernicus, Met Office and ETH Zurich products; see each variable's licence below.

## Layout

| Path | Content |
|---|---|
| `catalog.parquet` | one row per variable: units, product, period, coverage, value range (`p02`/`p98` for colour scales), licence |
| `grid/<variable>.parquet` | `date, lat, lon, value, valid_frac`, sorted by cell then date, one row group per latitude band |
| `annual/<variable>.parquet` | `year, lat, lon, value, months`: annual mean per cell and the number of months it averages |
| `stations/monthly.parquet` | NCEI GSOM monthly values, one column per element (TAVG, PRCP, ...), per station |
| `stations/stations.parquet` | station metadata and coverage |
| `stations/trends_station.parquet` | per-station Mann-Kendall / Sen trends per element |
| `regions/index.parquet` | Natural Earth countries and admin-1 regions: id, name, country, bounds, label point, area |
| `regions/weights.parquet` | `id, lat, lon, frac`: share of each cell's area inside the region |
| `series/co2.parquet` | NOAA GML monthly CO2, global mean and Mauna Loa (ppm) |
| `insights/cells.npz`, `insights/regions.npz` | every variable's per-cell trend, p, scatter and jump flag in one file, the annual mean series of every region, and an annual Nino 3.4 index |
| `trends/<variable>.npz` | whole-record trend map products: Sen slope per year and FDR significance per cell, 2-degree year maps (anomalies and values), global means, colour scales |

`lat`/`lon` are cell centres (integer + 0.5); `date` is the first day of the month. Cells without data are omitted.
`valid_frac` is the share of the cell covered by valid source data (NASA grids only, cells below 0.5 dropped).
A region mean weights each cell by `frac * cos(lat) * valid_frac`.

## Reading

```python
import pandas as pd
cell = pd.read_parquet("hf://datasets/{repo}/grid/merra2_t2m.parquet",
                       filters=[("lat", "==", 50.5), ("lon", "==", 30.5)])
```

```sql
-- DuckDB reads only the row group of that latitude band
SELECT date, value FROM 'hf://datasets/{repo}/grid/sst.parquet' WHERE lat = 45.5 AND lon = 30.5;
```

## Variables

| Variable | Description | Units | Period | Domain | Licence |
|---|---|---|---|---|---|
{table}

## Caveats

- IMERG ends in 2025-09; GLDAS has no data south of 60S and its variables do not share one land mask.
- MERRA-2 (0.5 x 0.625 deg) does not nest in 1 degree cells; cells were assigned by centre.
- Several GLDAS series show a step around 2010-2011 (likely a change in model forcing); `gldas_swe` and
  `gldas_snowdepth` are not physical over ice sheets.
- `sea_ice_conc` covers polar cells only; `chlor_a` starts 2002-07, `ocean_mass` 2002-04 with a gap 2017-07 to 2018-05.
"""

LICENSE = """# Licences

This dataset combines products under different terms. Credit the original source when you use a variable.

{lines}

Station data: NOAA NCEI Global Summary of the Month, public domain. CO2 series: NOAA GML, public domain.

Region boundaries: Natural Earth 1:10m (v5.1.2), public domain; countries from Ukraine's point-of-view edition.
"""


def write_card(catalog: pd.DataFrame) -> None:
    table = "\n".join(
        f"| `{r.key}` | {r.name} | {r.units} | {r.start} to {r.end} | {r.domain} | {r.license.split(':')[0].split(',')[0]} |"
        for r in catalog.itertuples()
    )
    (OUT / "README.md").write_text(CARD.format(count=len(catalog), repo=REPO, table=table), encoding="utf-8")
    lines = "\n".join(f"- {text}" for text in LICENSES.values())
    (OUT / "LICENSE.md").write_text(LICENSE.format(lines=lines), encoding="utf-8")


# trends/<key>.npz: whole-record trend grid, year maps and colour scales per variable, read by the API
# (src/trendmaps.py), plus trends/_wind.npz with the mean wind vector
def build_trends(keys: list[str]) -> None:
    import sys

    sys.path.insert(0, str(ROOT))
    from src import dataset, trendmaps

    dataset.LOCAL = str(OUT)
    dataset.catalog.cache_clear()
    out = OUT / "trends"
    out.mkdir(exist_ok=True)
    for key in keys or list(dataset.catalog()):
        if key not in dataset.catalog():
            print(f"  {key:24s} skipped (not in the catalog)")
            continue
        started = time.time()
        path = out / f"{key}.npz"
        products = trendmaps.build(key)
        path.write_bytes(trendmaps.to_bytes(products))
        print(f"  {key:24s} {len(products['years'])} years, {path.stat().st_size / 1e6:.1f} MB, {time.time() - started:.1f} s")
        dataset.annual.cache_clear()
    if (not keys or set(keys) & set(trendmaps.WIND_PARTS)) and all(k in dataset.catalog() for k in trendmaps.WIND_PARTS):
        (out / "_wind.npz").write_bytes(trendmaps.to_bytes(trendmaps.build_wind()))
        print("  _wind                    mean 10 m wind vector")
        dataset.annual.cache_clear()
    # across all variables, so always rebuilt in full
    if (OUT / "regions" / "weights.parquet").exists():
        started = time.time()
        cells, regions = trendmaps.build_insights(list(dataset.catalog()))
        (OUT / "insights").mkdir(exist_ok=True)
        for name, products in (("cells", cells), ("regions", regions)):
            (OUT / "insights" / f"{name}.npz").write_bytes(trendmaps.to_bytes(products))
        size = sum(f.stat().st_size for f in (OUT / "insights").glob("*.npz")) / 1e6
        print(f"  insights: all-variable cells and region series, {size:.1f} MB, {time.time() - started:.0f} s")


def trends(args) -> None:
    print("trend maps:")
    build_trends(args.keys)
    if (OUT / "catalog.parquet").exists():
        write_card(pd.read_parquet(OUT / "catalog.parquet"))


def build(args) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    print("grids:")
    rows = build_grids(args.keys)
    if not args.keys and (NCEI_DIR / "monthly_wide.parquet").exists():
        print("stations:")
        build_stations()
    catalog = write_catalog(rows)
    build_series()
    print("trend maps:")
    build_trends(args.keys)
    write_card(catalog)
    total = sum(f.stat().st_size for f in OUT.rglob("*") if f.is_file()) / 1e6
    print(f"done: {len(catalog)} variables, {total:,.0f} MB in {OUT}")


def verify(args) -> None:
    rng = np.random.default_rng(0)
    failed = 0
    catalog = pd.read_parquet(OUT / "catalog.parquet")
    meta = variables()
    for key in catalog["key"]:
        source = read_csv(source_path(key, "csv")) if meta[key]["kind"] == "csv" else read_nc(source_path(key, meta[key]["kind"]), key)
        if key in LAND_ONLY:
            source = land_cells(source)
        built = pq.read_table(OUT / "grid" / f"{key}.parquet")
        problems = []
        if built.num_rows != source.num_rows:
            problems.append(f"rows {built.num_rows} != {source.num_rows}")
        for stat in ("min", "max", "sum"):
            a, b = getattr(pc, stat)(built["value"]).as_py(), getattr(pc, stat)(source["value"]).as_py()
            if not np.isclose(a, b, rtol=1e-6):
                problems.append(f"{stat} {a} != {b}")
        frame = source.to_pandas()
        for row in frame.sample(5, random_state=int(rng.integers(1 << 31))).itertuples():
            cell = pq.read_table(OUT / "grid" / f"{key}.parquet", filters=[("lat", "==", row.lat), ("lon", "==", row.lon)]).to_pandas()
            expected = frame[(frame.lat == row.lat) & (frame.lon == row.lon)].sort_values("date")
            if not np.array_equal(cell["value"].to_numpy(), expected["value"].to_numpy()):
                problems.append(f"series differs at {row.lat},{row.lon}")
        groups = pq.ParquetFile(OUT / "grid" / f"{key}.parquet").num_row_groups
        annual = pq.read_metadata(OUT / "annual" / f"{key}.parquet").num_rows
        status = "ok" if not problems else "FAIL " + "; ".join(problems)
        failed += bool(problems)
        print(f"  {key:24s} {status:4s}  {built.num_rows:>11,} rows, {groups} row groups, {annual:,} annual rows")
    raise SystemExit(1 if failed else 0)


def main() -> None:
    parser = argparse.ArgumentParser(description="Build and verify the Hugging Face dataset")
    sub = parser.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("build", help="convert sources into data/hf")
    p.add_argument("keys", nargs="*", help="variables to rebuild (default: all, plus stations)")
    p.set_defaults(func=build)
    sub.add_parser("verify", help="compare every grid with its source").set_defaults(func=verify)
    p = sub.add_parser("trends", help="rebuild the trend map products from data/hf")
    p.add_argument("keys", nargs="*", help="variables (default: all)")
    p.set_defaults(func=trends)
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
