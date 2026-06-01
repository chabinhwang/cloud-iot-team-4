"""SGP30 TVOC/eCO2 sensor driver for Raspberry Pi I2C pins GPIO2/GPIO3."""

from __future__ import annotations

import logging
from typing import Mapping

LOGGER = logging.getLogger(__name__)
DEFAULT_TVOC_MAX_PPB = 1000.0


def normalize_sgp30_reading(
    eco2_ppm: float | int | None,
    tvoc_ppb: float | int | None,
    *,
    tvoc_max_ppb: float = DEFAULT_TVOC_MAX_PPB,
) -> Mapping[str, float | int]:
    values: dict[str, float | int] = {}
    if eco2_ppm is not None:
        values["co2"] = int(round(float(eco2_ppm)))
    if tvoc_ppb is not None:
        normalized_voc = max(0.0, min(float(tvoc_ppb) / tvoc_max_ppb, 1.0))
        values["voc"] = round(normalized_voc, 3)
    return values


class SGP30Sensor:
    """Read equivalent CO2 and TVOC from an SGP30 over I2C."""

    def __init__(self, *, i2c_frequency: int = 100_000, tvoc_max_ppb: float = DEFAULT_TVOC_MAX_PPB) -> None:
        import adafruit_sgp30
        import board
        import busio

        self.tvoc_max_ppb = tvoc_max_ppb
        self.i2c = busio.I2C(board.SCL, board.SDA, frequency=i2c_frequency)
        self.device = adafruit_sgp30.Adafruit_SGP30(self.i2c)
        self.device.iaq_init()
        LOGGER.info("SGP30 initialized: serial=%s", [hex(part) for part in self.device.serial])

    def read(self) -> Mapping[str, float | int]:
        return normalize_sgp30_reading(self.device.eCO2, self.device.TVOC, tvoc_max_ppb=self.tvoc_max_ppb)

    def close(self) -> None:
        deinit = getattr(self.i2c, "deinit", None)
        if callable(deinit):
            deinit()
