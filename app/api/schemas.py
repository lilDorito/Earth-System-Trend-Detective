# API request and response models

from datetime import date, datetime

from pydantic import BaseModel, Field, model_validator

from src.contracts import AnalysisResult, Location, Mode, SeriesMeta


class AnalyzeRequest(BaseModel):
    variable: str = Field(..., description="variable key from /api/variables")
    location: Location
    start: date
    end: date
    mode: Mode = "trend"
    event_date: date | None = None
    deseasonalize: bool = True
    region_name: str | None = None

    @model_validator(mode="after")
    def check(self):
        if self.end <= self.start:
            raise ValueError("end must be after start")
        if self.mode == "event" and self.event_date is None:
            raise ValueError("event mode needs event_date")
        if self.event_date and not (self.start < self.event_date < self.end):
            raise ValueError("event_date must be inside the period")
        return self


class SeriesPoint(BaseModel):
    time: datetime
    value: float | None
    climatology: float | None
    anomaly: float | None


class AnalyzeResponse(BaseModel):
    meta: SeriesMeta
    series: list[SeriesPoint]
    result: AnalysisResult
