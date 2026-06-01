"""Configuration for the Raspberry Pi AWS IoT Core publisher."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

DEFAULT_TOPIC_PREFIX = "health/sensor"
DEFAULT_DEVICE_ID = "rpi_001"
DEFAULT_INTERVAL_SEC = 30.0
DEFAULT_QOS = 1
DEFAULT_OPERATION_TIMEOUT_SEC = 10.0
DEFAULT_SENSOR_READ_TIMEOUT_SEC = 2.0


def load_dotenv_if_available(env_file: str | Path = ".env") -> None:
    """Load a local .env file when python-dotenv is installed.

    The client can still run without python-dotenv if variables are provided by
    systemd's EnvironmentFile or the shell.
    """

    try:
        from dotenv import load_dotenv
    except ImportError:
        return

    load_dotenv(dotenv_path=env_file)


def _parse_float(environ: Mapping[str, str], key: str, default: float) -> float:
    raw = environ.get(key)
    if raw is None or raw == "":
        return default
    value = float(raw)
    if value <= 0:
        raise ValueError(f"{key} must be greater than 0")
    return value


def _parse_qos(environ: Mapping[str, str], key: str = "PUBLISH_QOS") -> int:
    raw = environ.get(key)
    if raw is None or raw == "":
        return DEFAULT_QOS
    value = int(raw)
    if value not in (0, 1):
        raise ValueError(f"{key} must be 0 or 1 for AWS IoT MQTT311 publish")
    return value


def _parse_bool(environ: Mapping[str, str], key: str, default: bool) -> bool:
    raw = environ.get(key)
    if raw is None or raw == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "y", "on"}


@dataclass(frozen=True)
class PiClientConfig:
    """Runtime configuration loaded from environment variables."""

    endpoint: str
    root_ca: Path
    cert: Path
    private_key: Path
    device_id: str = DEFAULT_DEVICE_ID
    client_id: str = DEFAULT_DEVICE_ID
    topic_prefix: str = DEFAULT_TOPIC_PREFIX
    sample_interval_sec: float = DEFAULT_INTERVAL_SEC
    publish_qos: int = DEFAULT_QOS
    operation_timeout_sec: float = DEFAULT_OPERATION_TIMEOUT_SEC
    use_mock_sensor: bool = True
    zph01_serial_port: str = "/dev/serial0"
    zph01_baudrate: int = 9600
    zph01_pm25_coefficient: float = 1000.0
    sensor_read_timeout_sec: float = DEFAULT_SENSOR_READ_TIMEOUT_SEC
    dht11_pin: str = "D4"
    dht11_use_pulseio: bool = False
    sgp30_i2c_frequency: int = 100_000
    sgp30_tvoc_max_ppb: float = 1000.0

    @classmethod
    def from_env(cls, environ: Mapping[str, str] | None = None) -> "PiClientConfig":
        env = os.environ if environ is None else environ
        device_id = env.get("DEVICE_ID", DEFAULT_DEVICE_ID).strip() or DEFAULT_DEVICE_ID
        client_id = env.get("MQTT_CLIENT_ID", device_id).strip() or device_id
        topic_prefix = env.get("AWS_IOT_TOPIC_PREFIX", DEFAULT_TOPIC_PREFIX).strip(" /") or DEFAULT_TOPIC_PREFIX

        return cls(
            endpoint=env.get("AWS_IOT_ENDPOINT", "").strip(),
            root_ca=Path(env.get("AWS_IOT_ROOT_CA", "certs/AmazonRootCA1.pem")),
            cert=Path(env.get("AWS_IOT_CERT", f"certs/{device_id}.pem.crt")),
            private_key=Path(env.get("AWS_IOT_PRIVATE_KEY", f"certs/{device_id}.private.pem.key")),
            device_id=device_id,
            client_id=client_id,
            topic_prefix=topic_prefix,
            sample_interval_sec=_parse_float(env, "SAMPLE_INTERVAL_SEC", DEFAULT_INTERVAL_SEC),
            publish_qos=_parse_qos(env),
            operation_timeout_sec=_parse_float(env, "AWS_IOT_OPERATION_TIMEOUT_SEC", DEFAULT_OPERATION_TIMEOUT_SEC),
            use_mock_sensor=_parse_bool(env, "MOCK_SENSOR", True),
            zph01_serial_port=env.get("ZPH01_SERIAL_PORT", "/dev/serial0").strip() or "/dev/serial0",
            zph01_baudrate=int(env.get("ZPH01_BAUDRATE", "9600")),
            zph01_pm25_coefficient=_parse_float(env, "ZPH01_PM25_COEFFICIENT", 1000.0),
            sensor_read_timeout_sec=_parse_float(env, "SENSOR_READ_TIMEOUT_SEC", DEFAULT_SENSOR_READ_TIMEOUT_SEC),
            dht11_pin=env.get("DHT11_PIN", "D4").strip() or "D4",
            dht11_use_pulseio=_parse_bool(env, "DHT11_USE_PULSEIO", False),
            sgp30_i2c_frequency=int(env.get("SGP30_I2C_FREQUENCY", "100000")),
            sgp30_tvoc_max_ppb=_parse_float(env, "SGP30_TVOC_MAX_PPB", 1000.0),
        )

    @property
    def topic(self) -> str:
        return f"{self.topic_prefix}/{self.device_id}/environment"


def validate_config(config: PiClientConfig) -> None:
    """Validate values that must be present before connecting to AWS IoT Core."""

    errors: list[str] = []
    if not config.endpoint:
        errors.append("AWS_IOT_ENDPOINT is required")

    missing_files = []
    for env_name, path in (
        ("AWS_IOT_ROOT_CA", config.root_ca),
        ("AWS_IOT_CERT", config.cert),
        ("AWS_IOT_PRIVATE_KEY", config.private_key),
    ):
        if not path.exists():
            missing_files.append(f"{env_name}={path}")

    if errors:
        raise ValueError("; ".join(errors))
    if missing_files:
        raise FileNotFoundError("Missing AWS IoT certificate files: " + ", ".join(missing_files))
