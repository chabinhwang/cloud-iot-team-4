"""API Gateway HTTP poster for Raspberry Pi environment readings."""

from __future__ import annotations

import json
import logging
import threading
from datetime import datetime, timezone
from typing import Callable, Mapping
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .config import PiClientConfig
from .sensors.mock import read_environment

LOGGER = logging.getLogger(__name__)
SensorReader = Callable[[], Mapping[str, float | int | None]]
UrlOpener = Callable[[Request, float], object]


class MeasurementPostError(RuntimeError):
    """Raised when API Gateway rejects or cannot receive a measurement."""


def _to_utc_timestamp(now: datetime | None = None) -> str:
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    current = current.astimezone(timezone.utc)
    return current.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def build_payload(
    device_id: str,
    sensor_values: Mapping[str, float | int | None],
    *,
    now: datetime | None = None,
) -> dict[str, str | float | int]:
    """Build the JSON payload consumed by the API Gateway/Lambda pipeline."""

    payload: dict[str, str | float | int] = {
        "device_id": device_id,
        "timestamp": _to_utc_timestamp(now),
    }
    for key, value in sensor_values.items():
        if value is not None:
            payload[key] = value
    return payload


def post_measurement(
    config: PiClientConfig,
    payload: Mapping[str, str | float | int],
    *,
    opener: UrlOpener = urlopen,
) -> str:
    """POST one measurement payload to API Gateway and return response text."""

    encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    request = Request(
        config.measurements_url,
        data=encoded,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with opener(request, timeout=config.http_timeout_sec) as response:
            body = response.read().decode("utf-8")
            status = getattr(response, "status", None)
    except HTTPError as exc:
        raise MeasurementPostError(f"API Gateway POST failed with HTTP {exc.code}: {exc.reason}") from exc
    except URLError as exc:
        raise MeasurementPostError(f"API Gateway POST failed: {exc.reason}") from exc

    if status is not None and not (200 <= int(status) < 300):
        raise MeasurementPostError(f"API Gateway POST failed with HTTP {status}: {body}")

    return body


def publish_once(
    config: PiClientConfig,
    sensor_values: Mapping[str, float | int | None],
) -> dict[str, str | float | int]:
    """Build and POST one environment reading."""

    payload = build_payload(config.device_id, sensor_values)
    response_body = post_measurement(config, payload)
    LOGGER.info("Posted %s", json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    if response_body:
        LOGGER.info("API response %s", response_body)
    return payload


def run_publisher(
    config: PiClientConfig,
    *,
    sensor_reader: SensorReader = read_environment,
    stop_event: threading.Event | None = None,
) -> None:
    """Run the continuous sensor-read → API Gateway POST loop."""

    shutdown = stop_event or threading.Event()
    LOGGER.info("Posting measurements to %s", config.measurements_url)

    while not shutdown.is_set():
        try:
            publish_once(config, sensor_reader())
        except Exception:  # noqa: BLE001 - keep daemon alive across transient network/sensor failures
            LOGGER.exception("Post cycle failed; will retry after interval")
        shutdown.wait(config.sample_interval_sec)
