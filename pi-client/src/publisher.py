"""AWS IoT Core MQTT publisher for Raspberry Pi environment readings."""

from __future__ import annotations

import json
import logging
import threading
from datetime import datetime, timezone
from typing import Callable, Mapping

from .config import PiClientConfig
from .sensors.mock import read_environment

LOGGER = logging.getLogger(__name__)
SensorReader = Callable[[], Mapping[str, float | int | None]]


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
    """Build the JSON payload consumed by the AWS Lambda/DynamoDB pipeline."""

    payload: dict[str, str | float | int] = {
        "device_id": device_id,
        "timestamp": _to_utc_timestamp(now),
    }
    for key, value in sensor_values.items():
        if value is not None:
            payload[key] = value
    return payload


def _mqtt_qos(qos: int):
    from awscrt import mqtt

    return mqtt.QoS.AT_LEAST_ONCE if qos == 1 else mqtt.QoS.AT_MOST_ONCE


def create_mqtt_connection(config: PiClientConfig):
    """Create an mTLS MQTT311 connection using AWS IoT Device SDK for Python v2."""

    from awsiot import mqtt_connection_builder

    def on_connection_interrupted(connection, error, **kwargs):
        LOGGER.warning("AWS IoT connection interrupted: %s", error)

    def on_connection_resumed(connection, return_code, session_present, **kwargs):
        LOGGER.info(
            "AWS IoT connection resumed: return_code=%s session_present=%s",
            return_code,
            session_present,
        )

    def on_connection_success(connection, callback_data):
        LOGGER.info("AWS IoT connected: session_present=%s", callback_data.session_present)

    def on_connection_failure(connection, callback_data):
        LOGGER.error("AWS IoT connection failed: %s", callback_data.error)

    def on_connection_closed(connection, callback_data):
        LOGGER.info("AWS IoT connection closed")

    return mqtt_connection_builder.mtls_from_path(
        endpoint=config.endpoint,
        cert_filepath=str(config.cert),
        pri_key_filepath=str(config.private_key),
        ca_filepath=str(config.root_ca),
        client_id=config.client_id,
        clean_session=False,
        keep_alive_secs=30,
        on_connection_interrupted=on_connection_interrupted,
        on_connection_resumed=on_connection_resumed,
        on_connection_success=on_connection_success,
        on_connection_failure=on_connection_failure,
        on_connection_closed=on_connection_closed,
    )


def connect(connection, timeout_sec: float) -> None:
    LOGGER.info("Connecting to AWS IoT Core...")
    connection.connect().result(timeout_sec)


def disconnect(connection, timeout_sec: float) -> None:
    try:
        connection.disconnect().result(timeout_sec)
    except Exception:  # noqa: BLE001 - best-effort shutdown path
        LOGGER.exception("Failed to disconnect cleanly")


def publish_once(
    connection,
    config: PiClientConfig,
    sensor_values: Mapping[str, float | int | None],
) -> dict[str, str | float | int]:
    """Publish one environment reading and wait for the PUBACK when QoS=1."""

    payload = build_payload(config.device_id, sensor_values)
    encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    publish_future, _ = connection.publish(
        topic=config.topic,
        payload=encoded,
        qos=_mqtt_qos(config.publish_qos),
    )
    publish_future.result(config.operation_timeout_sec)
    LOGGER.info("Published %s", encoded)
    return payload


def run_publisher(
    config: PiClientConfig,
    *,
    sensor_reader: SensorReader = read_environment,
    stop_event: threading.Event | None = None,
) -> None:
    """Run the continuous sensor-read → MQTT-publish loop."""

    shutdown = stop_event or threading.Event()
    connection = create_mqtt_connection(config)
    connect(connection, config.operation_timeout_sec)

    try:
        while not shutdown.is_set():
            try:
                publish_once(connection, config, sensor_reader())
            except Exception:  # noqa: BLE001 - keep daemon alive; SDK reconnects automatically
                LOGGER.exception("Publish cycle failed; will retry after interval")
            shutdown.wait(config.sample_interval_sec)
    finally:
        disconnect(connection, config.operation_timeout_sec)
