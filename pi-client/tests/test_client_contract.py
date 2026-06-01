import os
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


class PiClientContractTests(unittest.TestCase):
    def test_config_builds_aws_iot_topic_from_device_id(self):
        from src.config import PiClientConfig

        config = PiClientConfig.from_env(
            {
                "AWS_IOT_ENDPOINT": "example-ats.iot.ap-northeast-2.amazonaws.com",
                "DEVICE_ID": "rpi_001",
                "AWS_IOT_ROOT_CA": "certs/AmazonRootCA1.pem",
                "AWS_IOT_CERT": "certs/rpi_001.pem.crt",
                "AWS_IOT_PRIVATE_KEY": "certs/rpi_001.private.key",
                "SAMPLE_INTERVAL_SEC": "15",
                "PUBLISH_QOS": "1",
                "MOCK_SENSOR": "false",
                "ZPH01_SERIAL_PORT": "/dev/serial0",
                "DHT11_PIN": "D4",
                "SGP30_I2C_FREQUENCY": "100000",
            }
        )

        self.assertEqual(config.topic, "health/sensor/rpi_001/environment")
        self.assertEqual(config.sample_interval_sec, 15)
        self.assertEqual(config.publish_qos, 1)
        self.assertFalse(config.use_mock_sensor)
        self.assertEqual(config.zph01_serial_port, "/dev/serial0")
        self.assertEqual(config.dht11_pin, "D4")
        self.assertEqual(config.sgp30_i2c_frequency, 100000)

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

    def test_config_validation_reports_missing_certificate_files(self):
        from src.config import PiClientConfig, validate_config

        config = PiClientConfig.from_env(
            {
                "AWS_IOT_ENDPOINT": "example-ats.iot.ap-northeast-2.amazonaws.com",
                "AWS_IOT_ROOT_CA": "/tmp/missing-root-ca.pem",
                "AWS_IOT_CERT": "/tmp/missing-cert.pem.crt",
                "AWS_IOT_PRIVATE_KEY": "/tmp/missing-private.pem.key",
            }
        )

        with self.assertRaises(FileNotFoundError) as ctx:
            validate_config(config)

        self.assertIn("AWS_IOT_ROOT_CA", str(ctx.exception))
        self.assertIn("AWS_IOT_CERT", str(ctx.exception))
        self.assertIn("AWS_IOT_PRIVATE_KEY", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
