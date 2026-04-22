# pi-client

> 라즈베리파이에서 실물 센서를 읽어 서버로 MQTT publish 하는 클라이언트

상위 프로젝트 개요: [../README.md](../README.md) · 서버: [../asthma-server/README.md](../asthma-server/README.md)

---

## 이 폴더에서 만들 것

라즈베리파이(4 또는 Zero 2 W 가정) 위에서 **센서 값을 주기적으로 읽어**, 서버의 MQTT 브로커로 아래 계약대로 publish 하는 **간단한 에이전트 한 개**.

- **입력**: GPIO/I²C/UART로 연결된 환경 센서들
- **출력**: MQTT publish `health/sensor/{deviceId}/environment` (JSON, 초/분 주기)
- **실행**: 부팅 시 자동 기동 (systemd service)
- **오프라인 내성**: 브로커 연결이 끊겨도 프로세스가 죽지 않고 재연결

---

## 하드웨어 (예상 BOM)

| 센서 | 측정 항목 | 인터페이스 | 비고 |
|---|---|---|---|
| PMS7003 / SDS011 | PM2.5, PM10 | UART | 미세먼지 |
| MH-Z19B | CO₂ | UART | 환기 판단의 핵심 |
| SGP30 / CCS811 | VOC, (e)CO₂ | I²C | 선택 |
| DHT22 / BME280 | 온도, 습도 | GPIO / I²C | BME280이면 기압도 함께 |

> 실제 선정된 센서 + 배선도(핀 매핑) 는 이 섹션에 표/이미지로 채워 넣을 예정.

---

## 소프트웨어 계획

- **언어**: Python 3.11+ (RPi 생태계 라이브러리 풍부)
- **주요 의존성**:
  - `paho-mqtt` — MQTT 클라이언트
  - `pyserial` — PMS7003 / MH-Z19B UART
  - `smbus2` 또는 `adafruit-circuitpython-*` — I²C 센서
  - `python-dotenv` — 설정
- **구조(예정)**:
  ```
  pi-client/
  ├── README.md              # 본 파일
  ├── pyproject.toml         # 의존성
  ├── .env.example           # MQTT_URL, DEVICE_ID, SAMPLE_INTERVAL_SEC 등
  ├── src/
  │   ├── main.py            # 진입점 (루프 + MQTT 연결 관리)
  │   ├── sensors/
  │   │   ├── pms7003.py     # PM2.5/10 읽기
  │   │   ├── mhz19b.py      # CO₂ 읽기
  │   │   ├── sgp30.py       # VOC 읽기 (선택)
  │   │   └── bme280.py      # 온/습도 읽기
  │   ├── publisher.py       # payload 조립 + MQTT publish + 재연결
  │   └── config.py          # env 로딩 / 기본값
  └── systemd/
      └── pi-client.service  # 부팅 시 자동 기동
  ```

---

## MQTT publish 계약 (서버와 맞춰진 스키마)

- **토픽**: `health/sensor/{deviceId}/environment`
- **QoS**: 0 (센서값 유실 허용, 고빈도)
- **주기**: 기본 5초 (서버 Mock과 동일, `SAMPLE_INTERVAL_SEC`로 조정)
- **페이로드(JSON)**:

```json
{
  "device_id": "rpi_001",
  "timestamp": "2026-04-22T05:18:06.176Z",
  "pm25": 47.47,
  "pm10": 79.77,
  "co2": 1380.72,
  "voc": 0.59,
  "temperature": 22.06,
  "humidity": 46.28
}
```

필드 단위 (WHO/ASHRAE 기준): PM µg/m³ · CO₂ ppm · VOC 지수(0~1) · 온도 °C · 습도 %.
값이 없는 센서 필드는 **키 자체를 생략**하거나 `null`로 보냄 (서버 Guide Service가 누락값 허용).

---

## 환경변수 (`.env`, 예정)

| 키 | 기본값 | 설명 |
|---|---|---|
| `MQTT_URL` | `mqtt://<서버IP>:1883` | 브로커 주소 (서버와 같은 LAN) |
| `DEVICE_ID` | `rpi_001` | 서버가 Store 키로 사용 |
| `SAMPLE_INTERVAL_SEC` | `5` | publish 주기 |
| `MQTT_CLIENT_ID` | `pi-client-{hostname}` | 브로커에서 식별용 |
| `SENSOR_PMS7003_PORT` | `/dev/ttyAMA0` | UART 포트 |
| `SENSOR_MHZ19B_PORT` | `/dev/ttyS0` | UART 포트 |
| `I2C_BUS` | `1` | I²C 버스 번호 |

---

## 실행 흐름 (목표)

1. 부팅 → `systemd`가 `pi-client.service` 기동
2. `.env` 로드, 각 센서 초기화 (실패 시 `null`로 표시하고 계속)
3. `paho-mqtt` 연결 → `MQTT_URL`
4. **루프**: 센서 읽기 → payload 조립 → publish → `SAMPLE_INTERVAL_SEC` 대기
5. 브로커 끊김 시 지수 백오프 재연결, 프로세스는 살아있음
6. `Ctrl+C` / `SIGTERM` 수신 시 graceful shutdown

---

## 서버와의 통합 확인

1. 서버 기동: `cd ../asthma-server && npm start` (단, `USE_MOCK_SENSOR=false`로 두어 Mock publisher 충돌 방지)
2. pi-client 기동 후 서버 로그에 `[broker] pi-client-xxxxxx → health/sensor/rpi_001/environment (NN B)` 확인
3. `curl http://<서버IP>:3000/api/data/environment/rpi_001 | jq` — 방금 publish한 값이 반환되면 OK
4. `curl -X POST http://<서버IP>:3000/api/guide/trigger -H 'content-type: application/json' -d '{"scenario":"severe","sendToDiscord":false}' | jq` — 실제 RPi 값 기반으로 가이드가 생성되는지 확인

---

## 작업 체크리스트

- [ ] 센서 모델 확정 + 배선도 작성
- [ ] `pyproject.toml` / `.env.example` 초안
- [ ] 센서별 드라이버 모듈 (`sensors/*.py`) 각각 단위 테스트 가능하게
- [ ] `publisher.py` — MQTT 재연결 + QoS + LWT(last will) 설정
- [ ] `main.py` — 루프 + signal handling
- [ ] `systemd/pi-client.service` 파일
- [ ] 서버와 end-to-end 통합 테스트 (동일 LAN)
- [ ] README의 하드웨어 표/배선도/트러블슈팅 섹션 채우기
