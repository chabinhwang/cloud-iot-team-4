# pi-client

라즈베리파이에서 환경 데이터를 만들어 **API Gateway HTTP API**로 직접 POST하는 클라이언트입니다.
현재 과제 범위에서는 AWS IoT Core/MQTT/Thing/인증서를 쓰지 않습니다.

상위 프로젝트 개요: [../README.md](../README.md) · 서버/AWS Lambda: [../asthma-server/README.md](../asthma-server/README.md)

---

## 현재 실행 흐름

```text
Raspberry Pi
  → POST /measurements/environment
  → API Gateway
  → Lambda
  → DynamoDB
```

- DHT11: 실제 GPIO4 센서값 사용
- ZPH01: 사용할 수 없으므로 `pm25`, `pm10` 랜덤 대체값 사용
- SGP30: 사용할 수 없으므로 `co2`, `voc` 랜덤 대체값 사용

---

## 파일 구조

```text
pi-client/
├── .env.example
├── requirements.txt
├── src/
│   ├── config.py              # API_BASE_URL, DEVICE_ID, DHT11 설정
│   ├── main.py                # CLI/systemd 진입점
│   ├── publisher.py           # API Gateway HTTP POST 루프
│   └── sensors/
│       ├── dht11.py           # DHT11 실제 온습도 reader
│       ├── environment.py     # DHT11 + 랜덤 대체값 병합
│       ├── random_substitutes.py
│       ├── mock.py            # 전체 mock/demo용
│       ├── zph01.py           # 실제 ZPH01 driver 보관용, 현재 실행 경로 미사용
│       └── sgp30.py           # 실제 SGP30 driver 보관용, 현재 실행 경로 미사용
├── systemd/
│   └── cloud-iot-pi.service
└── tests/
```

---

## 센서 사용 방식

### 실제 센서: DHT11

| DHT11 핀 | Raspberry Pi 4 연결 | 설명 |
|---|---|---|
| DATA | GPIO4 / 물리 Pin 7 | 데이터 신호 |
| VCC | 3.3V | 전원 공급 |
| GND | GND | 접지 |

DATA에는 10kΩ 풀업 저항을 3.3V에 연결합니다.

```text
3.3V ── 10kΩ ── DATA ── GPIO4
```

### 랜덤 대체값

| 대체 대상 | publish 필드 | 랜덤 범위 |
|---|---|---|
| ZPH01 미세먼지 센서 | `pm25` | 5 ~ 65 µg/m³ |
| ZPH01 미세먼지 센서 | `pm10` | `pm25 + 4` ~ `pm25 + 45` µg/m³ |
| SGP30 공기질 센서 | `co2` | 450 ~ 1600 ppm |
| SGP30 공기질 센서 | `voc` | 0.05 ~ 0.85 |

---

## POST payload 예시

```json
{
  "device_id": "rpi_001",
  "timestamp": "2026-04-22T05:18:06.176Z",
  "pm25": 31.42,
  "pm10": 58.7,
  "co2": 812,
  "voc": 0.37,
  "temperature": 24.0,
  "humidity": 48.0
}
```

전송 URL:

```text
https://2en76mdnw1.execute-api.ap-northeast-2.amazonaws.com/measurements/environment
```

---

## Raspberry Pi에서 clone 후 스크립트로 실행

```bash
cd ~
git clone https://github.com/chabinhwang/cloud-iot-team-4.git
cd cloud-iot-team-4/pi-client
```

설치 스크립트 실행:

```bash
./scripts/setup-pi.sh
```

이 스크립트가 하는 일:

- `git`, `python3-venv`, `python3-pip`, `libgpiod2` 설치
- 현재 사용자를 `gpio` 그룹에 추가
- `.venv` 생성
- `requirements.txt` 설치

`gpio` 그룹이 새로 추가되면 재부팅 또는 로그아웃/로그인이 필요할 수 있습니다.

```bash
sudo reboot
```

재부팅 후 다시 들어와서 `.env`를 직접 만듭니다.

```bash
cd ~/cloud-iot-team-4/pi-client
cp .env.example .env
nano .env
```

핵심값:

```dotenv
API_BASE_URL=https://2en76mdnw1.execute-api.ap-northeast-2.amazonaws.com
DEVICE_ID=rpi_001
SAMPLE_INTERVAL_SEC=30
MOCK_SENSOR=false
DHT11_PIN=D4
```

실행 스크립트:

```bash
./scripts/run-pi-client.sh
```

정상 출력 예:

```text
[run] Starting pi-client. Press Ctrl+C to stop.
[run] Using env file: /home/pi/cloud-iot-team-4/pi-client/.env
INFO src.publisher - Posting measurements to https://2en76mdnw1.execute-api.ap-northeast-2.amazonaws.com/measurements/environment
INFO src.publisher - Posted {"device_id":"rpi_001","timestamp":"...","pm25":31.42,"pm10":58.7,"temperature":24.0,"humidity":48.0,"co2":812,"voc":0.37}
INFO src.publisher - API response {"ok":true,...}
```

중지는 `Ctrl+C`.

---

## AWS 없이 센서 payload만 CLI에서 보기

API 호출 없이 값만 확인하려면:

```bash
cd ~/cloud-iot-team-4/pi-client
. .venv/bin/activate

PYTHONPATH=. python - <<'PY'
from src.config import PiClientConfig
from src.sensors.environment import create_hardware_sensor_suite

config = PiClientConfig.from_env({"API_BASE_URL": "http://example.local"})
suite = create_hardware_sensor_suite(config)
print(suite.read_environment())
PY
```

예상:

```text
{'pm25': 31.42, 'pm10': 58.7, 'temperature': 24.0, 'humidity': 48.0, 'co2': 812, 'voc': 0.37}
```

---

## API만 curl로 테스트

```bash
curl -X POST https://2en76mdnw1.execute-api.ap-northeast-2.amazonaws.com/measurements/environment \
  -H 'content-type: application/json' \
  -d '{"device_id":"rpi_001","pm25":30,"pm10":55,"co2":800,"voc":0.3,"temperature":24,"humidity":45}'
```

---

## systemd 자동 실행

CLI 실행이 확인된 뒤 등록합니다.

```bash
cd ~/cloud-iot-team-4/pi-client
sudo cp .env /etc/cloud-iot-pi.env
sudo cp systemd/cloud-iot-pi.service /etc/systemd/system/cloud-iot-pi.service
sudo systemctl daemon-reload
sudo systemctl enable --now cloud-iot-pi.service
sudo journalctl -u cloud-iot-pi.service -f
```

중지/재시작:

```bash
sudo systemctl stop cloud-iot-pi.service
sudo systemctl restart cloud-iot-pi.service
```

---

## 로컬 검증

```bash
python3 -m unittest discover -s pi-client/tests -v
python3 -m py_compile $(find pi-client/src -name '*.py')
```
