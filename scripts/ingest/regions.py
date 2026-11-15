# region weights for the dataset: share of each 1 degree cell inside Natural Earth countries and admin-1 regions
#
#   python scripts/ingest/regions.py      # writes data/hf/regions/{index,weights}.parquet and app/web/public/regions

import argparse
import json
import os
import time
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import requests
import shapely
from common import ROOT
from shapely.geometry import box, shape

OUT = Path(os.environ.get("HF_DATASET_DIR", ROOT / "data" / "hf"))
RAW = ROOT / "data" / "raw" / "natural_earth"
NE_URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/{}.geojson"
# Ukraine's point of view: Crimea and Sevastopol belong to Ukraine, as in the UN's view
COUNTRIES = "ne_10m_admin_0_countries_ukr"
ADMIN1 = "ne_10m_admin_1_states_provinces"
ADMIN1_COUNTRY = {"UA-43": "UKR", "UA-40": "UKR"}  # admin-1 has no point-of-view variant
MIN_FRAC = 1e-4
WEB = ROOT / "app" / "web" / "public" / "regions"
OUTLINE_TOLERANCE = 0.02  # degrees (about 2 km): finer than a border line at the closest zoom
CELL_KM2 = 111.195**2  # one square degree at the equator


def load(name: str) -> list[dict]:
    path = RAW / f"{name}.geojson"
    if not path.exists():
        print(f"  downloading {name}")
        RAW.mkdir(parents=True, exist_ok=True)
        r = requests.get(NE_URL.format(name), timeout=300)
        r.raise_for_status()
        tmp = path.with_suffix(".tmp")
        tmp.write_bytes(r.content)
        tmp.replace(path)
    return json.loads(path.read_text(encoding="utf-8"))["features"]


# clipping to one latitude band first keeps every intersection small, even for Russia or Canada
def cell_fractions(geom) -> list[tuple[float, float, float]]:
    out = []
    west, south, east, north = geom.bounds
    for lat0 in range(int(np.floor(south)), int(np.ceil(north))):
        strip = shapely.intersection(geom, box(-180, lat0, 180, lat0 + 1))
        if strip.is_empty:
            continue
        w, _, e, _ = strip.bounds
        lons = np.arange(int(np.floor(w)), int(np.ceil(e)))
        cells = shapely.box(lons, lat0, lons + 1, lat0 + 1)
        # area in square degrees, which within one cell is its share of the cell's area
        frac = shapely.area(shapely.intersection(cells, strip))
        out += [(lat0 + 0.5, lon0 + 0.5, min(1.0, float(f))) for lon0, f in zip(lons, frac) if f > 0]
    # slivers along the border are dropped, but a region smaller than that keeps its biggest cell
    kept = [c for c in out if c[2] >= MIN_FRAC]
    return kept or sorted(out, key=lambda c: c[2])[-1:]


# west and east around the widest empty stretch of longitude, so west > east for regions across 180 degrees
def lon_range(geom) -> tuple[float, float]:
    spans = sorted((g.bounds[0], g.bounds[2]) for g in getattr(geom, "geoms", [geom]))
    merged = [list(spans[0])]
    for w, e in spans[1:]:
        if w <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], e)
        else:
            merged.append([w, e])
    gaps = [(merged[0][0] + 360 - merged[-1][1], len(merged) - 1)]
    gaps += [(merged[k + 1][0] - merged[k][1], k) for k in range(len(merged) - 1)]
    _, k = max(gaps)
    return merged[(k + 1) % len(merged)][0], merged[k][1]


def build_region(rid: str, geom, row: dict) -> tuple[dict, list[tuple]]:
    geom = shapely.make_valid(geom)
    cells = cell_fractions(geom)
    area = sum(f * np.cos(np.deg2rad(lat)) for lat, _, f in cells) * CELL_KM2
    _, south, _, north = geom.bounds
    west, east = lon_range(geom)
    meta = row | dict(id=rid, south=south, north=north, west=west, east=east, cells=len(cells), area_km2=round(area))
    return meta, [(rid, lat, lon, f) for lat, lon, f in cells]


def outline(geom) -> list[list[float]]:
    rings = []
    for part in getattr(geom, "geoms", [geom]):
        if part.geom_type != "Polygon":
            continue
        part = part.simplify(OUTLINE_TOLERANCE, preserve_topology=True)
        for ring in [part.exterior, *part.interiors]:
            coords = np.round(np.asarray(ring.coords), 2)
            if len(coords) >= 4:
                rings.append(coords.ravel().tolist())
    return rings


def write_web(frame: pd.DataFrame, shapes: dict[str, object]) -> None:
    (WEB / "outlines").mkdir(parents=True, exist_ok=True)
    columns = ["id", "name", "kind", "country", "type", "lat", "lon", "south", "north", "west", "east", "area_km2", "name_uk"]
    rows = frame[columns].assign(kind=frame["kind"].map({"country": "c", "admin1": "a"}))
    rows[["lat", "lon", "south", "north", "west", "east"]] = rows[["lat", "lon", "south", "north", "west", "east"]].round(3)
    index = {"columns": columns, "rows": rows.values.tolist()}
    text = json.dumps(index, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    (WEB / "index.json").write_text(text, encoding="utf-8")
    for country, ids in frame.groupby("country")["id"]:
        outlines = {rid: outline(shapes[rid]) for rid in ids}
        (WEB / "outlines" / f"{country}.json").write_text(json.dumps(outlines, separators=(",", ":")), encoding="utf-8")
    size = sum(f.stat().st_size for f in WEB.rglob("*.json")) / 1e6
    print(f"  web: index and {frame['country'].nunique()} outline files, {size:.1f} MB in {WEB.relative_to(ROOT)}")


def build() -> None:
    started = time.time()
    index, weights, shapes = [], [], {}

    countries = load(COUNTRIES)
    names = {}
    for feature in countries:
        p = feature["properties"]
        code = p["ADM0_A3"]
        names[code] = p["NAME"]
        row = dict(name=p["NAME"], kind="country", country=code.lower(), country_name=p["NAME"],
                   type=p["TYPE"], lat=p["LABEL_Y"], lon=p["LABEL_X"], name_uk=p.get("NAME_UK") or "")
        shapes[code.lower()] = shape(feature["geometry"])
        meta, cells = build_region(code.lower(), shapes[code.lower()], row)
        index.append(meta)
        weights += cells
    print(f"  countries: {len(countries)}")

    admin1 = load(ADMIN1)
    for feature in admin1:
        p = feature["properties"]
        code = ADMIN1_COUNTRY.get(p["iso_3166_2"], p["adm0_a3"])
        name = p["name_en"] or p["name"]
        if not name:
            continue  # a few unnamed slivers with placeholder codes
        row = dict(name=name, kind="admin1", country=code.lower(), country_name=names.get(code, p["admin"]),
                   type=p["type_en"] or "", lat=p["latitude"], lon=p["longitude"], name_uk=p.get("name_uk") or "")
        # ids carry the country they are listed under: UKR-283, not RUS-283, for Crimea
        rid = p["adm1_code"].lower()
        if code != p["adm0_a3"]:
            rid = code.lower() + rid[3:]
        shapes[rid] = shape(feature["geometry"])
        meta, cells = build_region(rid, shapes[rid], row)
        index.append(meta)
        weights += cells
    print(f"  admin-1 regions: {len(index) - len(countries)}")

    assert len({r["id"] for r in index}) == len(index), "region ids must be unique"
    out = OUT / "regions"
    out.mkdir(parents=True, exist_ok=True)
    frame = pd.DataFrame(index)[["id", "name", "kind", "country", "country_name", "type", "lat", "lon",
                                 "south", "north", "west", "east", "cells", "area_km2", "name_uk"]]
    frame.drop(columns="name_uk").to_parquet(out / "index.parquet", index=False, compression="zstd")
    table = pa.table(
        {
            "id": pa.array([w[0] for w in weights]),
            "lat": pa.array([w[1] for w in weights], pa.float32()),
            "lon": pa.array([w[2] for w in weights], pa.float32()),
            "frac": pa.array([w[3] for w in weights], pa.float32()),
        }
    )
    pq.write_table(table, out / "weights.parquet", compression="zstd", use_dictionary=["id", "lat", "lon"])
    write_web(frame, shapes)
    print(f"done: {len(frame)} regions, {len(table):,} cell weights in {time.time() - started:.0f} s")

    if (OUT / "catalog.parquet").exists():
        import hf_dataset

        hf_dataset.write_card(pd.read_parquet(OUT / "catalog.parquet"))


def main() -> None:
    parser = argparse.ArgumentParser(description="Build region cell weights from Natural Earth boundaries")
    parser.parse_args()
    build()


if __name__ == "__main__":
    main()
