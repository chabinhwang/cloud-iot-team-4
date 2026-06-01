"""Winsen ZPH01/ZPH01B UART dust sensor driver.

Wiring used by this project:
- CTRL/PIN1 -> GND before power-on, selecting UART mode
- VCC/PIN3 -> 5V
- GND/PIN5 -> GND
- TXD/PIN4 -> Raspberry Pi GPIO15 RXD / physical pin 10

The sensor sends one 9-byte frame every second at 9600 8N1. It does not need
commands from the Raspberry Pi.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

FRAME_LENGTH = 9
START_BYTE = 0xFF
TYPE_CODE = 0x18
DEFAULT_PM25_COEFFICIENT = 1000.0


class ZPH01ProtocolError(ValueError):
    """Raised when a ZPH01 UART frame is incomplete or invalid."""


@dataclass(frozen=True)
class ZPH01Reading:
    low_pulse_rate_percent: float
    pm25: float

    def as_environment_values(self) -> Mapping[str, float]:
        return {"pm25": self.pm25}


def zph01_checksum(frame_without_checksum: bytes) -> int:
    """Return the ZPH01 checksum byte.

    Winsen's checksum sums bytes 1..7, negates the low byte, then adds 1.
    The start byte at index 0 is intentionally excluded.
    """

    if len(frame_without_checksum) != FRAME_LENGTH - 1:
        raise ZPH01ProtocolError(f"ZPH01 checksum needs 8 bytes, got {len(frame_without_checksum)}")
    return ((~sum(frame_without_checksum[1:]) + 1) & 0xFF)


def parse_zph01_frame(frame: bytes, *, pm25_coefficient: float = DEFAULT_PM25_COEFFICIENT) -> ZPH01Reading:
    """Parse a 9-byte ZPH01 UART frame into a PM2.5 reading.

    The frame reports low-pulse-rate as integer and decimal percent bytes.
    PM2.5 is derived using the manual's empirical coefficient:
    ``pm25 = coefficient * (low_pulse_rate_percent / 100)``.
    """

    if len(frame) != FRAME_LENGTH:
        raise ZPH01ProtocolError(f"ZPH01 frame must be {FRAME_LENGTH} bytes, got {len(frame)}")
    if frame[0] != START_BYTE:
        raise ZPH01ProtocolError(f"Invalid ZPH01 start byte: 0x{frame[0]:02x}")
    if frame[1] != TYPE_CODE:
        raise ZPH01ProtocolError(f"Invalid ZPH01 type code: 0x{frame[1]:02x}")

    expected = zph01_checksum(frame[:-1])
    if frame[-1] != expected:
        raise ZPH01ProtocolError(f"Invalid ZPH01 checksum: got 0x{frame[-1]:02x}, expected 0x{expected:02x}")

    integer_percent = frame[3]
    decimal_percent = frame[4]
    if integer_percent > 100 or decimal_percent > 99:
        raise ZPH01ProtocolError(
            f"Invalid ZPH01 low pulse rate bytes: integer={integer_percent}, decimal={decimal_percent}"
        )

    low_pulse_rate_percent = round(integer_percent + decimal_percent / 100.0, 2)
    pm25 = round(pm25_coefficient * (low_pulse_rate_percent / 100.0), 2)
    return ZPH01Reading(low_pulse_rate_percent=low_pulse_rate_percent, pm25=pm25)


class ZPH01Sensor:
    """Read PM2.5 from the ZPH01 UART stream."""

    def __init__(
        self,
        port: str = "/dev/serial0",
        *,
        baudrate: int = 9600,
        timeout_sec: float = 2.0,
        pm25_coefficient: float = DEFAULT_PM25_COEFFICIENT,
    ) -> None:
        import serial

        self.pm25_coefficient = pm25_coefficient
        self.serial = serial.Serial(port=port, baudrate=baudrate, timeout=timeout_sec)

    def read(self) -> Mapping[str, float]:
        frame = self._read_frame()
        return parse_zph01_frame(frame, pm25_coefficient=self.pm25_coefficient).as_environment_values()

    def _read_frame(self) -> bytes:
        while True:
            first = self.serial.read(1)
            if first == b"":
                raise ZPH01ProtocolError("Timed out waiting for ZPH01 start byte")
            if first[0] != START_BYTE:
                continue

            rest = self.serial.read(FRAME_LENGTH - 1)
            if len(rest) != FRAME_LENGTH - 1:
                raise ZPH01ProtocolError(f"Timed out reading ZPH01 frame body, got {len(rest)} bytes")
            frame = first + rest
            if frame[1] == TYPE_CODE:
                return frame

    def close(self) -> None:
        self.serial.close()
