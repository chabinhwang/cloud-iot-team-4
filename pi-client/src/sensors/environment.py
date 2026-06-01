"""Composition layer for DHT11 plus random substitutes for unavailable sensors."""

from __future__ import annotations

import logging
from typing import Callable, Iterable, Mapping, Protocol

from ..config import PiClientConfig
from .dht11 import DHT11Sensor
from .random_substitutes import RandomSGP30AirQualitySensor, RandomZPH01DustSensor

LOGGER = logging.getLogger(__name__)


class EnvironmentSensor(Protocol):
    def read(self) -> Mapping[str, float | int | None]:
        ...


class EnvironmentSensorSuite:
    """Merge readings from independent sensor providers.

    One failing sensor should not stop publication of values from the others.
    """

    def __init__(self, sensors: Iterable[EnvironmentSensor]) -> None:
        self.sensors = list(sensors)

    def read_environment(self) -> Mapping[str, float | int | None]:
        merged: dict[str, float | int | None] = {}
        for sensor in self.sensors:
            try:
                merged.update(sensor.read())
            except Exception as exc:  # noqa: BLE001 - keep daemon alive across transient hardware failures
                LOGGER.warning("Skipping failed sensor read from %s: %s", sensor.__class__.__name__, exc)
        return merged

    def close(self) -> None:
        for sensor in self.sensors:
            close = getattr(sensor, "close", None)
            if callable(close):
                close()



def create_sensor_suite_from_factories(
    factories: Iterable[tuple[str, Callable[[], EnvironmentSensor]]],
) -> EnvironmentSensorSuite:
    sensors: list[EnvironmentSensor] = []
    for name, factory in factories:
        try:
            sensors.append(factory())
        except Exception as exc:  # noqa: BLE001 - allow partial hardware availability
            LOGGER.warning("Skipping %s sensor initialization: %s", name, exc)
    return EnvironmentSensorSuite(sensors)


def create_hardware_sensor_suite(config: PiClientConfig) -> EnvironmentSensorSuite:
    return create_sensor_suite_from_factories(
        [
            ("RandomZPH01", RandomZPH01DustSensor),
            ("DHT11", lambda: DHT11Sensor(pin_name=config.dht11_pin, use_pulseio=config.dht11_use_pulseio)),
            ("RandomSGP30", RandomSGP30AirQualitySensor),
        ]
    )
