import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


class PiClientContractTests(unittest.TestCase):
    def test_config_builds_api_gateway_measurement_url(self):
        from src.config import PiClientConfig

        config = PiClientConfig.from_env(
            {
                "API_BASE_URL": "https://example.execute-api.ap-northeast-2.amazonaws.com/",
                "DEVICE_ID": "rpi_001",
                "SAMPLE_INTERVAL_SEC": "15",
                "HTTP_TIMEOUT_SEC": "8",
                "MOCK_SENSOR": "false",
                "DHT11_PIN": "D4",
            }
        )

        self.assertEqual(
            config.measurements_url,
            "https://example.execute-api.ap-northeast-2.amazonaws.com/measurements/environment",
        )
        self.assertEqual(config.sample_interval_sec, 15)
        self.assertEqual(config.http_timeout_sec, 8)
        self.assertFalse(config.use_mock_sensor)
        self.assertEqual(config.dht11_pin, "D4")

    def test_build_payload_matches_server_contract_and_omits_missing_values(self):
        from src.publisher import build_payload

        now = datetime(2026, 4, 22, 5, 18, 6, 176000, tzinfo=timezone.utc)
        payload = build_payload(
            "rpi_001",
            {
                "pm25": 47.47,
                "pm10": 79.77,
                "co2": 1380.72,
                "voc": None,
                "temperature": 22.06,
                "humidity": 46.28,
            },
            now=now,
        )

        self.assertEqual(
            payload,
            {
                "device_id": "rpi_001",
                "timestamp": "2026-04-22T05:18:06.176Z",
                "pm25": 47.47,
                "pm10": 79.77,
                "co2": 1380.72,
                "temperature": 22.06,
                "humidity": 46.28,
            },
        )

    def test_mock_sensor_returns_environment_values_in_expected_ranges(self):
        from src.sensors.mock import read_environment

        values = read_environment(seed=4)

        self.assertGreaterEqual(values["pm25"], 0)
        self.assertGreaterEqual(values["pm10"], values["pm25"])
        self.assertGreaterEqual(values["co2"], 400)
        self.assertLessEqual(values["voc"], 1)
        self.assertGreaterEqual(values["humidity"], 0)
        self.assertLessEqual(values["humidity"], 100)

    def test_config_validation_requires_api_base_url_only(self):
        from src.config import PiClientConfig, validate_config

        config = PiClientConfig.from_env({})

        with self.assertRaises(ValueError) as ctx:
            validate_config(config)

        self.assertIn("API_BASE_URL", str(ctx.exception))

    def test_post_measurement_sends_json_to_api_gateway(self):
        from src.config import PiClientConfig
        from src.publisher import post_measurement

        captured = {}

        class FakeResponse:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def read(self):
                return b'{"ok":true}'

        def fake_urlopen(request, timeout):
            captured["url"] = request.full_url
            captured["headers"] = dict(request.header_items())
            captured["body"] = request.data.decode("utf-8")
            captured["timeout"] = timeout
            return FakeResponse()

        config = PiClientConfig.from_env(
            {
                "API_BASE_URL": "https://example.execute-api.ap-northeast-2.amazonaws.com",
                "HTTP_TIMEOUT_SEC": "3",
            }
        )
        response_body = post_measurement(
            config,
            {"device_id": "rpi_001", "pm25": 12.3},
            opener=fake_urlopen,
        )

        self.assertEqual(captured["url"], "https://example.execute-api.ap-northeast-2.amazonaws.com/measurements/environment")
        self.assertEqual(captured["headers"]["Content-type"], "application/json")
        self.assertEqual(captured["body"], '{"device_id":"rpi_001","pm25":12.3}')
        self.assertEqual(captured["timeout"], 3)
        self.assertEqual(response_body, '{"ok":true}')

    def test_post_measurement_raises_readable_error_on_http_failure(self):
        from src.config import PiClientConfig
        from src.publisher import MeasurementPostError, post_measurement

        def fake_urlopen(request, timeout):
            raise HTTPError(request.full_url, 500, "Internal Server Error", hdrs=None, fp=None)

        config = PiClientConfig.from_env({"API_BASE_URL": "https://example.execute-api.ap-northeast-2.amazonaws.com"})

        with self.assertRaises(MeasurementPostError) as ctx:
            post_measurement(config, {"device_id": "rpi_001"}, opener=fake_urlopen)

        self.assertIn("500", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
