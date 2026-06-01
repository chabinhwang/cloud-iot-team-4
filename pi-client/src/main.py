"""Command-line entry point for the Raspberry Pi AWS IoT publisher."""

from __future__ import annotations

import logging
import signal
import threading

from .config import PiClientConfig, load_dotenv_if_available, validate_config
from .publisher import SensorReader, run_publisher
from .sensors.environment import create_hardware_sensor_suite
from .sensors.mock import read_environment


def _install_signal_handlers(stop_event: threading.Event) -> None:
    def request_stop(signum, frame):
        logging.getLogger(__name__).info("Received signal %s; stopping", signum)
        stop_event.set()

    signal.signal(signal.SIGINT, request_stop)
    signal.signal(signal.SIGTERM, request_stop)


def _select_sensor_reader(config: PiClientConfig) -> SensorReader:
    if config.use_mock_sensor:
        return read_environment
    suite = create_hardware_sensor_suite(config)
    return suite.read_environment


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s - %(message)s",
    )
    load_dotenv_if_available()
    config = PiClientConfig.from_env()
    validate_config(config)

    sensor_reader = _select_sensor_reader(config)
    if config.use_mock_sensor:
        logging.getLogger(__name__).warning(
            "MOCK_SENSOR=true: publishing generated values instead of physical sensor readings"
        )

    stop_event = threading.Event()
    _install_signal_handlers(stop_event)
    run_publisher(config, sensor_reader=sensor_reader, stop_event=stop_event)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
