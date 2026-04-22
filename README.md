# 천식환자 공간 조성 가이드 서비스

> 26-1 클라우드IoT 4팀

천식 환자의 **야간 생체 데이터(Fitbit)** 와 **실내 환경 데이터(IoT 센서)** 를 통합 분석하여, 개인의 건강 민감도에 따라 동적으로 달라지는 **맞춤형 공간 조성 가이드**를 Discord로 전달하는 서비스입니다.

현 단계는 실제 하드웨어(Raspberry Pi, Fitbit Band) 없이도 **서버 단독으로 전체 파이프라인을 검증** 가능한 구조입니다. Mock 데이터 소스를 켜둔 채 기동하면 외부 의존 없이 즉시 동작합니다.

상세 설계는 [`plan.md`](./plan.md) 참고.

---

## 빠른 시작 (Mock 모드, 실제 API 키 불필요)

```bash
cd asthma-server
cp .env.example .env         # 기본값이 이미 Mock 모드
npm install
npm start
```

기동 로그:
```
[broker] aedes listening on tcp://0.0.0.0:1883
[scheduler] cron='0 7 * * *' tz=Asia/Seoul
[http] listening on :3000
[subscriber] connected → mqtt://localhost:1883
[mock-sensor] publishing every 5000ms → health/sensor/rpi_001/environment
[broker] mock-sensor-xxxxxx → health/sensor/rpi_001/environment (148B)
```

5초마다 Mock 센서가 데이터를 publish하고, 서버 Subscriber가 수신 → Store에 저장됩니다.

### 동작 확인 (REST)

```bash
# 1) 헬스체크
curl http://localhost:3000/health

# 2) Mock publisher가 보내고 있는 최신 실내 환경
curl http://localhost:3000/api/data/environment

# 3) 가이드 즉시 실행 — Discord 미발송 프리뷰
curl -X POST http://localhost:3000/api/guide/trigger \
  -H 'content-type: application/json' \
  -d '{"scenario":"severe","sendToDiscord":false}'

# 4) Mock Fitbit 시나리오 선택 (healthy | mild | severe | random)
curl "http://localhost:3000/api/guide/preview?scenario=mild"
```

3번 응답 예시 (severe 시나리오 + 나쁜 실내 환경):
```json
{
  "ok": true,
  "report": {
    "status_summary": { "overall": "danger", "overall_emoji": "🔴", "perMetric": { ... } },
    "health_analysis": {
      "weight": 0.8,
      "level": "high",
      "reasons": ["SpO2 90% (심각: <92)", "호흡수 24회/분 (심각: >22)", "수면 290분 (<360)", "HRV 15ms (낮음)"]
    },
    "environment_action": {
      "primary": "ventilate",
      "message": "창문을 열고 10~15분 환기하세요 (CO₂ 배출).",
      "suggestions": [ ... ]
    }
  }
}
```

### 단위 테스트

```bash
cd asthma-server
npm test
```

`tests/guide.service.test.js` — 가중치/가이드 8개 케이스 (건강/민감/실내외 조합별 action 검증).

---

## 주요 특징

- **임베디드 MQTT 브로커**: Node.js 프로세스 내부에서 `aedes` TCP 브로커(1883) 기동 → 외부 브로커 설치 불필요
- **Mock 우선 설계**: 환경변수 토글로 실제 기기/외부 API 없이 end-to-end 검증
- **동적 임계치**: 야간 생체지표로 `health_weight(0~1)` 산출 → 민감도가 높은 날은 임계치를 엄격하게 적용
- **순수 함수 가이드 로직**: `guide.service.js`는 외부 의존 없음 → 단위 테스트/Lambda 이식 용이
- **실외 공기질 기반 분기**: 실외가 나쁘면 "환기" 대신 "공기청정기" 가이드로 자동 전환
- **Discord Embed 리포트**: 상태 색상(🟢/🟡/🔴) + 항목별 필드 + 권장 조치 목록

---

## 기술 스택

| 역할 | 라이브러리 |
|---|---|
| 런타임 | Node.js 20+ (ESM) |
| 웹 서버 | Express.js |
| MQTT 브로커 | aedes (임베디드) |
| MQTT 클라이언트 | MQTT.js |
| HTTP 클라이언트 | Axios |
| 스케줄러 | node-cron |
| 환경변수 | dotenv |
| 테스트 | node:test (builtin) |

---

## 아키텍처 요약

```
[Mock sensor-publisher] ─┐
  또는 실제 RPi(미래)     │
                          ▼
                   [aedes MQTT 브로커 :1883]
                          │
                          ▼
                   [서버 Subscriber] ──▶ [Store(In-Memory)]
                                              ▲
                                              │
[Mock/실제 Fitbit Web API] ──▶ [Fitbit Service]
[Mock/실제 에어코리아·기상청] ──▶ [Weather Service]
                                              │
                                              ▼
                                      [Guide Service] (순수함수)
                                              │
                    ┌─────────────────────────┴──────────────────────────┐
                    ▼                                                    ▼
              [Scheduler (cron)]                               [REST API (수동 트리거)]
                    │                                                    │
                    └──────────────────┬─────────────────────────────────┘
                                       ▼
                              [Discord Service]
                                       │
                                       ▼
                              [Discord Webhook]
```

토픽 네이밍: `health/sensor/{deviceId}/environment`, `health/fitbit/{userId}/biometric`

---

## 폴더 구조

```
cloud-iot-team-4/
├── plan.md                       # 설계 문서
├── README.md                     # 본 파일
└── asthma-server/                # 서버 구현
    ├── package.json
    ├── .env.example
    └── src/
        ├── server.js             # 전체 진입점 (브로커+subscriber+publisher+스케줄러+HTTP)
        ├── app.js                # Express 앱 구성
        ├── config/index.js       # 환경변수 · 임계치
        ├── mqtt/
        │   ├── broker.js         # aedes 임베디드 브로커
        │   ├── client.js         # 서버 자신의 Subscriber
        │   └── handlers.js       # 토픽별 메시지 처리 → Store
        ├── services/
        │   ├── guide.service.js  # 가중치 알고리즘 (순수함수)
        │   ├── report.service.js # 파이프라인 오케스트레이션
        │   ├── fitbit.service.js # OAuth + API (Mock/Real)
        │   ├── weather.service.js# 에어코리아/기상청 (Mock/Real)
        │   └── discord.service.js# Webhook 전송
        ├── store/memory.js       # In-Memory 저장소 (추상화 인터페이스)
        ├── scheduler/cron.js     # 기상 시각 트리거
        ├── routes/               # REST 엔드포인트
        │   ├── auth.routes.js
        │   ├── data.routes.js
        │   └── guide.routes.js
        └── mocks/
            ├── sensor-publisher.js  # Mock RPi MQTT Publisher
            └── fitbit.mock.js        # Mock Fitbit 야간 집계
```

---

## 환경변수 (.env)

| 키 | 기본값 | 설명 |
|---|---|---|
| `PORT` | 3000 | HTTP 포트 |
| `EMBEDDED_BROKER` | true | aedes 임베디드 브로커 기동 여부 |
| `MQTT_PORT` | 1883 | 브로커 listen 포트 |
| `MQTT_URL` | mqtt://localhost:1883 | Subscriber/Publisher 접속 URL |
| `USE_MOCK_SENSOR` | true | Mock 센서 Publisher 자동 기동 |
| `USE_MOCK_FITBIT` | true | Fitbit Mock 응답 반환 |
| `USE_MOCK_WEATHER` | true | 실외 공기질/기상 Mock 반환 |
| `USE_MOCK_DISCORD` | true | Discord 전송을 콘솔 로그로 대체 |
| `MOCK_SENSOR_INTERVAL_MS` | 5000 | Mock 센서 publish 주기 |
| `SCHEDULER_ENABLED` | true | cron 스케줄러 활성 |
| `MORNING_CRON` | `0 7 * * *` | 기상 시각 cron (기본 매일 07:00) |
| `DEFAULT_TIMEZONE` | Asia/Seoul | cron 타임존 |
| `DEFAULT_USER_ID` | user_001 | Mock/기본 사용자 ID |
| `DEFAULT_DEVICE_ID` | rpi_001 | Mock/기본 디바이스 ID |
| `FITBIT_CLIENT_ID` / `FITBIT_CLIENT_SECRET` | (없음) | OAuth 자격증명 (실제 연동 시) |
| `AIRKOREA_API_KEY` / `KMA_API_KEY` | (없음) | 공공데이터포털 API 키 |
| `DISCORD_WEBHOOK_URL` | (없음) | 실제 Discord 채널 Webhook |

---

## 실제 모드로 전환하기

각 항목을 하나씩 끌 수 있음 (나머지는 Mock 유지 가능):

### Fitbit 실제 연동
```bash
USE_MOCK_FITBIT=false
FITBIT_CLIENT_ID=...
FITBIT_CLIENT_SECRET=...
FITBIT_REDIRECT_URI=http://localhost:3000/auth/fitbit/callback
```
1. `GET /auth/fitbit/login` → `authorizeUrl`로 이동하여 동의
2. Fitbit이 `/auth/fitbit/callback?code=...`로 리다이렉트 → Access/Refresh 토큰이 Store에 저장됨
3. 이후 `/api/guide/trigger`는 실제 Fitbit API에서 야간 집계를 가져옴

### 실외 공기질/기상
```bash
USE_MOCK_WEATHER=false
AIRKOREA_API_KEY=...   # 공공데이터포털 - 에어코리아 대기질
KMA_API_KEY=...        # 공공데이터포털 - 기상청 단기예보
```

### Discord
```bash
USE_MOCK_DISCORD=false
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/.../...
```

### 실제 RPi 연결
1. RPi 쪽에서 `mqtt://<서버IP>:1883`으로 접속, 토픽 `health/sensor/{deviceId}/environment`에 JSON publish
2. 서버에서 `USE_MOCK_SENSOR=false`로 Mock Publisher만 끄면 됨 (Subscriber 코드는 동일)

---

## REST API 레퍼런스

| Method | Path | 설명 |
|---|---|---|
| GET | `/health` | 서버/Mock 상태 |
| GET | `/auth/fitbit/login` | Fitbit OAuth 진입 URL 발급 |
| GET | `/auth/fitbit/callback?code=...` | OAuth 콜백 (토큰 교환) |
| GET | `/api/data/environment/:deviceId?` | 최신 실내 환경 (Store) |
| GET | `/api/data/environments` | 모든 디바이스의 최신 환경 |
| GET | `/api/data/biometric/:userId?` | 최신 생체 집계 (Store) |
| GET | `/api/data/biometrics` | 모든 사용자의 최신 생체 |
| GET | `/api/guide/preview` | 가이드 프리뷰 (Discord 미발송) |
| POST | `/api/guide/trigger` | 가이드 실행 (+ 옵션 Discord 발송) |

`POST /api/guide/trigger` body:
```json
{
  "userId": "user_001",
  "deviceId": "rpi_001",
  "scenario": "severe",       // mock일 때만 의미: healthy | mild | severe | random
  "sendToDiscord": true
}
```

---

## MQTT 페이로드 스키마

### `health/sensor/{deviceId}/environment`
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

### `health/fitbit/{userId}/biometric`
```json
{
  "user_id": "user_001",
  "timestamp": "2026-04-22T05:18:08.540Z",
  "source": "fitbit",
  "sleep_duration_min": 420,
  "avg_spo2": 94,
  "min_spo2": 91,
  "avg_respiratory_rate": 19,
  "max_respiratory_rate": 22,
  "resting_hr": 72,
  "hrv": 35
}
```

---

## 가이드 알고리즘 요약

1. **health_weight(0~1)** 산출 — SpO2·호흡수·수면시간·HRV 기반 가중 합산
2. 실내 항목별 **동적 임계치** 적용: `threshold × (1 − weight × 0.5)` (민감할수록 엄격)
3. 항목별 상태(good/warning/danger) 결정 → 최악값이 overall
4. 실외 공기질(에어코리아 PM2.5/PM10) 확인
5. 조건 조합으로 primary action 결정:
   - CO₂ 높음 + 실외 좋음 → `ventilate`
   - CO₂ 높음 + 실외 나쁨 → `air_purifier`
   - 미세먼지 나쁨 + 실외 나쁨 → `air_purifier` (창문 X)
   - 미세먼지 나쁨 + 실외 좋음 → `ventilate_and_purify`
6. Discord Embed 리포트 생성 → Webhook 전송

구체 임계치: `src/config/index.js` (WHO/ASHRAE 기반).

---

## 로드맵 대비 진행 상황

| 단계 | 상태 |
|---|---|
| 1. Express 골격 + config | ✅ |
| 2. aedes 브로커 + Subscriber + Mock Publisher | ✅ |
| 3. Store + 가중치 알고리즘 + 단위 테스트 | ✅ |
| 4. Fitbit OAuth + API 연동 (인터페이스/Mock) | ✅ |
| 5. Weather + Discord 연동 (Mock/Real 토글) | ✅ |
| 6. Scheduler 연결 | ✅ |
| 7. 실제 RPi 연동 | 예정 (하드웨어 필요) |

---

## 설계 원칙

1. **계층 분리** — 수집/저장/로직/출력 독립
2. **순수 함수 지향** — Guide Service는 외부 의존 0
3. **Mock 우선** — 모든 외부 의존성이 Mock으로 대체 가능
4. **환경변수 토글** — Mock/Real, 임베디드/외부 브로커 전환이 코드 변경 없이 가능
5. **인터페이스 안정성** — 실물 연동 시점에 서버 코드 변경 최소화
6. **보안 최소 원칙** — 개인 민감정보는 서버 영구 저장 지양, 최소 캐싱만 유지
