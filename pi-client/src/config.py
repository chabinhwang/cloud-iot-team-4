"""Configuration for the Raspberry Pi API Gateway measurement poster."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

DEFAULT_DEVICE_ID = "rpi_001"
DEFAULT_INTERVAL_SEC = 30.0
DEFAULT_HTTP_TIMEOUT_SEC = 10.0


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


def _parse_bool(environ: Mapping[str, str], key: str, default: bool) -> bool:
    raw = environ.get(key)
    if raw is None or raw == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "y", "on"}


@dataclass(frozen=True)
class PiClientConfig:
    """Runtime configuration loaded from environment variables."""

    api_base_url: str
    device_id: str = DEFAULT_DEVICE_ID
    sample_interval_sec: float = DEFAULT_INTERVAL_SEC
    http_timeout_sec: float = DEFAULT_HTTP_TIMEOUT_SEC
    use_mock_sensor: bool = True
    dht11_pin: str = "D4"
    dht11_use_pulseio: bool = False

    @classmethod
    def from_env(cls, environ: Mapping[str, str] | None = None) -> "PiClientConfig":
        env = os.environ if environ is None else environ
        device_id = env.get("DEVICE_ID", DEFAULT_DEVICE_ID).strip() or DEFAULT_DEVICE_ID

        return cls(
            api_base_url=env.get("API_BASE_URL", "").strip(),
            device_id=device_id,
            sample_interval_sec=_parse_float(env, "SAMPLE_INTERVAL_SEC", DEFAULT_INTERVAL_SEC),
            http_timeout_sec=_parse_float(env, "HTTP_TIMEOUT_SEC", DEFAULT_HTTP_TIMEOUT_SEC),
            use_mock_sensor=_parse_bool(env, "MOCK_SENSOR", True),
            dht11_pin=env.get("DHT11_PIN", "D4").strip() or "D4",
            dht11_use_pulseio=_parse_bool(env, "DHT11_USE_PULSEIO", False),
        )

    @property
    def measurements_url(self) -> str:
        return f"{self.api_base_url.rstrip('/')}/measurements/environment"


def validate_config(config: PiClientConfig) -> None:
    """Validate values that must be present before posting to API Gateway."""

    if not config.api_base_url:
        raise ValueError("API_BASE_URL is required")
    if not config.api_base_url.startswith(("http://", "https://")):
        raise ValueError("API_BASE_URL must start with http:// or https://")
