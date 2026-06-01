import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


class ZPH01ProtocolTests(unittest.TestCase):
    def test_checksum_matches_winsen_protocol(self):
        from src.sensors.zph01 import zph01_checksum

        frame_without_checksum = bytes([0xFF, 0x18, 0x00, 0x12, 0x13, 0x00, 0x01, 0x00])

        self.assertEqual(zph01_checksum(frame_without_checksum), 0xC2)

    def test_parse_valid_uart_frame_to_pm25(self):
        from src.sensors.zph01 import parse_zph01_frame

        reading = parse_zph01_frame(bytes([0xFF, 0x18, 0x00, 0x12, 0x13, 0x00, 0x01, 0x00, 0xC2]))

        self.assertEqual(reading.low_pulse_rate_percent, 18.19)
        self.assertEqual(reading.pm25, 181.9)
        self.assertEqual(reading.as_environment_values(), {"pm25": 181.9})

    def test_rejects_bad_zph01_checksum(self):
        from src.sensors.zph01 import ZPH01ProtocolError, parse_zph01_frame

        with self.assertRaises(ZPH01ProtocolError):
            parse_zph01_frame(bytes([0xFF, 0x18, 0x00, 0x12, 0x13, 0x00, 0x01, 0x00, 0x00]))


class SensorAdapterTests(unittest.TestCase):
    def test_dht11_normalizer_returns_temperature_and_humidity(self):
        from src.sensors.dht11 import normalize_dht11_reading

        self.assertEqual(
            normalize_dht11_reading(22.064, 46.286),
            {"temperature": 22.06, "humidity": 46.29},
        )

    def test_sgp30_normalizer_maps_eco2_and_tvoc_to_server_fields(self):
        from src.sensors.sgp30 import normalize_sgp30_reading

        self.assertEqual(
            normalize_sgp30_reading(512, 23),
            {"co2": 512, "voc": 0.023},
        )

    def test_environment_suite_merges_sensor_values_and_continues_on_failure(self):
        from src.sensors.environment import EnvironmentSensorSuite

        class GoodSensor:
            def read(self):
                return {"temperature": 23.1}

        class FailingSensor:
            def read(self):
                raise RuntimeError("transient read failure")

        class DustSensor:
            def read(self):
                return {"pm25": 18.2}

        suite = EnvironmentSensorSuite([GoodSensor(), FailingSensor(), DustSensor()])

        self.assertEqual(suite.read_environment(), {"temperature": 23.1, "pm25": 18.2})

    def test_environment_factory_skips_sensor_init_failure(self):
        from src.sensors.environment import create_sensor_suite_from_factories

        class GoodSensor:
            def read(self):
                return {"humidity": 44.0}

        suite = create_sensor_suite_from_factories(
            [
                ("bad", lambda: (_ for _ in ()).throw(RuntimeError("missing device"))),
                ("good", GoodSensor),
            ]
        )

        self.assertEqual(suite.read_environment(), {"humidity": 44.0})


class RandomSubstituteSensorTests(unittest.TestCase):
    def test_random_zph01_substitute_generates_dust_values_in_range(self):
        from src.sensors.random_substitutes import RandomZPH01DustSensor

        values = RandomZPH01DustSensor(seed=7).read()

        self.assertGreaterEqual(values["pm25"], 5)
        self.assertLessEqual(values["pm25"], 65)
        self.assertGreaterEqual(values["pm10"], values["pm25"])
        self.assertLessEqual(values["pm10"], 120)

    def test_random_sgp30_substitute_generates_air_quality_values_in_range(self):
        from src.sensors.random_substitutes import RandomSGP30AirQualitySensor

        values = RandomSGP30AirQualitySensor(seed=11).read()

        self.assertGreaterEqual(values["co2"], 450)
        self.assertLessEqual(values["co2"], 1600)
        self.assertGreaterEqual(values["voc"], 0.05)
        self.assertLessEqual(values["voc"], 0.85)

    def test_hardware_suite_uses_random_substitutes_for_unavailable_sensors(self):
        from src.config import PiClientConfig
        from src.sensors.environment import create_hardware_sensor_suite
        from src.sensors.random_substitutes import RandomSGP30AirQualitySensor, RandomZPH01DustSensor

        config = PiClientConfig.from_env({"AWS_IOT_ENDPOINT": "endpoint"})
        suite = create_hardware_sensor_suite(config)

        self.assertTrue(any(isinstance(sensor, RandomZPH01DustSensor) for sensor in suite.sensors))
        self.assertTrue(any(isinstance(sensor, RandomSGP30AirQualitySensor) for sensor in suite.sensors))


if __name__ == "__main__":
    unittest.main()
