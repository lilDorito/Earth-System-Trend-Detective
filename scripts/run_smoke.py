# run every demo in configs/demos.yaml through the pipeline and print the verdicts

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pydantic import TypeAdapter

from src import catalog, pipeline
from src.config import settings
from src.contracts import Location

location_adapter = TypeAdapter(Location)


def main():
    print(f"DATA_MODE={settings.data_mode}")
    regions = catalog.regions()
    for demo in catalog.demos():
        for region_key in [demo["region"], demo.get("compare_region")]:
            if not region_key:
                continue
            region = regions[region_key]
            try:
                _, _, result = pipeline.analyze(
                    demo["variable"], location_adapter.validate_python(region["location"]),
                    demo["start"], demo["end"], mode=demo["mode"], event_date=demo.get("event_date"),
                    region_name=region["name"],
                )
                print(f"[ok]   {demo['id']:<26} {region['name']:<34} {result.verdict}")
            except Exception as e:
                print(f"[FAIL] {demo['id']:<26} {region['name']:<34} {type(e).__name__}: {e}")


if __name__ == "__main__":
    main()
