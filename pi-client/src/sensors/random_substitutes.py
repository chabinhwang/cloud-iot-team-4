"""Random substitute sensors for hardware that is currently unavailable.

Used when ZPH01 and SGP30 modules cannot be connected, while keeping the same
server payload contract for the API Gateway demo.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from typing import Mapping


@dataclass
class RandomZPH01DustSensor:
    """Generate plausible PM values instead of reading the unavailable ZPH01."""

    seed: int | None = None
    pm25_min: float = 5.0
    pm25_max: float = 65.0
    pm10_extra_min: float = 4.0
    pm10_extra_max: float = 45.0
    _rng: random.Random = field(init=False, repr=False)

    def __post_init__(self) -> None:
        self._rng = random.Random(self.seed) if self.seed is not None else random.Random()

    def read(self) -> Mapping[str, float]:
        pm25 = round(self._rng.uniform(self.pm25_min, self.pm25_max), 2)
        pm10 = round(pm25 + self._rng.uniform(self.pm10_extra_min, self.pm10_extra_max), 2)
        return {"pm25": pm25, "pm10": pm10}


@dataclass
class RandomSGP30AirQualitySensor:
    """Generate plausible eCO2/VOC values instead of reading the unavailable SGP30."""

    seed: int | None = None
    co2_min: int = 450
    co2_max: int = 1600
    voc_min: float = 0.05
    voc_max: float = 0.85
    _rng: random.Random = field(init=False, repr=False)

    def __post_init__(self) -> None:
        self._rng = random.Random(self.seed) if self.seed is not None else random.Random()

    def read(self) -> Mapping[str, float | int]:
        return {
            "co2": int(round(self._rng.uniform(self.co2_min, self.co2_max))),
            "voc": round(self._rng.uniform(self.voc_min, self.voc_max), 2),
        }
