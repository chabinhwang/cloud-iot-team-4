"""Mock environment sensor reader.

This keeps the Raspberry Pi client runnable before the physical sensor models and
wiring are finalized. Replace or compose this module with real drivers under
``src/sensors/`` when hardware is connected.
"""

from __future__ import annotations

import random
from typing import Mapping


def read_environment(seed: int | None = None) -> Mapping[str, float]:
    """Return plausible asthma-guide environment readings.

    Units match the server contract:
    - pm25, pm10: µg/m³
    - co2: ppm
    - voc: normalized 0..1 index
    - temperature: °C
    - humidity: %RH
    """

    rng = random.Random(seed) if seed is not None else random
    pm25 = round(rng.uniform(5, 65), 2)
    pm10 = round(pm25 + rng.uniform(4, 45), 2)

    return {
        "pm25": pm25,
        "pm10": pm10,
        "co2": round(rng.uniform(450, 1600), 2),
        "voc": round(rng.uniform(0.05, 0.85), 2),
        "temperature": round(rng.uniform(18, 30), 2),
        "humidity": round(rng.uniform(30, 75), 2),
    }
