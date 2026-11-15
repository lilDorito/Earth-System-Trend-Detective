# monthly series from the 1-degree grids of the Hugging Face dataset; variable_id is the dataset key

from datetime import date, datetime, timezone

import pandas as pd

from .. import dataset
from ..contracts import BBox, Location, Point, Series, SeriesMeta, VariableInfo
from .base import SourceError


class HfGridSource:
    name = "hf_grid"

    def fetch(self, variable: VariableInfo, location: Location, start: date, end: date) -> Series:
        key = variable.variable_id
        grid_lat = grid_lon = cells = coverage = region_name = None
        try:
            if isinstance(location, Point):
                df, grid_lat, grid_lon = dataset.point_series(key, location.lat, location.lon)
            else:
                if isinstance(location, BBox):
                    area = dataset.area_series(key, location.south, location.north, location.west, location.east)
                else:
                    area = dataset.region_series(key, location.id)
                    region_name = dataset.region(location.id)["name"]
                df, cells, coverage = area.df, area.cells, round(area.coverage, 3)
        except (dataset.DatasetError, KeyError) as e:
            raise SourceError(str(e).strip("'\"")) from e
        except OSError as e:
            raise SourceError(f"Could not read the dataset: {e}") from e

        df = df[(df["time"] >= pd.Timestamp(start, tz="UTC")) & (df["time"] <= pd.Timestamp(end, tz="UTC"))]
        if df.empty:
            raise SourceError(f"No {variable.name.lower()} data in this period")
        meta = SeriesMeta(
            variable_key=variable.key,
            variable_id=key,
            variable_name=variable.name,
            units_raw=variable.units_raw,
            units=variable.units,
            resolution="monthly",
            location=location,
            grid_lat=grid_lat,
            grid_lon=grid_lon,
            cells=cells,
            coverage=coverage,
            region_name=region_name,
            source="hf_grid",
            fetched_at=datetime.now(timezone.utc),
        )
        return Series(df=df.reset_index(drop=True), meta=meta)
