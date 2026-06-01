"""DHT11 temperature/humidity sensor driver for GPIO4 / physical pin 7."""

from __future__ import annotations

import logging
from typing import Mapping

LOGGER = logging.getLogger(__name__)


def normalize_dht11_reading(temperature: float | int | None, humidity: float | int | None) -> Mapping[str, float]:
    values: dict[str, float] = {}
    if temperature is not None:
        values["temperature"] = round(float(temperature), 2)
    if humidity is not None:
        values["humidity"] = round(float(humidity), 2)
    return values


class DHT11Sensor:
    """Read temperature and humidity from a DHT11 connected to a board pin."""

    def __init__(self, pin_name: str = "D4", *, use_pulseio: bool = False) -> None:
        import adafruit_dht
        import board

        pin = getattr(board, pin_name)
        self.device = adafruit_dht.DHT11(pin, use_pulseio=use_pulseio)

    def read(self) -> Mapping[str, float]:
        try:
            return normalize_dht11_reading(self.device.temperature, self.device.humidity)
        except RuntimeError as exc:
            LOGGER.warning("DHT11 transient read failure: %s", exc)
            return {}

    def close(self) -> None:
        exit_fn = getattr(self.device, "exit", None)
        if callable(exit_fn):
            exit_fn()
