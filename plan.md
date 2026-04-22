# 천식환자 공간 조성 가이드 서비스 - 서버 아키텍처 설계

## 1. 프로젝트 개요

### 서비스 목적
천식 환자의 야간 생체 데이터(Fitbit)와 실내 환경 데이터(IoT 센서)를 통합 분석하여, 개인의 건강 민감도에 따라 동적으로 달라지는 맞춤형 공간 조성 가이드를 제공한다.

### 개발 범위 (현 단계)
실제 하드웨어(Raspberry Pi, Fitbit Band) 없이 서버 단독으로 전체 파이프라인을 검증할 수 있는 구조를 구축한다. Mock 데이터 소스를 통해 실제 기기 연동 시점에 인터페이스 변경 없이 교체 가능하도록 설계한다.

### 기술 스택
- **런타임**: Node.js
- **웹 서버**: Express.js
- **MQTT 브로커**: aedes (임베디드)
- **MQTT 클라이언트**: MQTT.js
- **HTTP 클라이언트**: Axios.js
- **외부 연동**: Fitbit Web API, 기상청/에어코리아 API, Discord Webhook

---

## 2. 전체 아키텍처

### 논리 계층 구조

```
┌─────────────────────────────────────────────────────┐
│              외부 데이터 소스 계층                    │
│  [Fitbit Cloud] [기상청 API] [에어코리아 API]         │
└─────────────────────────────────────────────────────┘
                        ↕ HTTPS (Axios)
┌─────────────────────────────────────────────────────┐
│              데이터 수집 계층                         │
│  - MQTT Subscriber (센서 데이터 수신)                 │
│  - Fitbit Service (OAuth + API 호출)                │
│  - Weather Service (외부 API 호출)                   │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│              데이터 저장 계층                         │
│  - Store 추상화 (초기 In-Memory → 향후 DB)           │
│  - 최근 환경/생체 데이터 캐싱, 토큰 저장              │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│              비즈니스 로직 계층                       │
│  - Guide Service (가중치 알고리즘, 순수 함수)         │
│  - Scheduler (기상 시각 트리거)                      │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│              출력 계층                                │
│  - Discord Webhook (리포트 발송)                     │
│  - REST API (수동 조회/트리거)                       │
└─────────────────────────────────────────────────────┘
                        ↕
┌─────────────────────────────────────────────────────┐
│              인프라 계층                              │
│  - aedes MQTT Broker (임베디드, port 1883)          │
│  - Express HTTP Server (port 3000)                  │
│  - Mock Publishers (개발용)                          │
└─────────────────────────────────────────────────────┘
```

### 데이터 흐름

**수집 경로 (Inbound)**
1. RPi 센서 데이터 → MQTT publish → aedes 브로커 → 서버 Subscriber → Store 저장
2. Fitbit Cloud → Axios GET → Fitbit Service → Store 저장
3. 기상청/에어코리아 → Axios GET → Weather Service → Guide Service 직접 전달

**처리 경로 (Processing)**
4. Scheduler(cron) 또는 수동 API 호출 → Guide Service 실행
5. Store에서 야간 생체/환경 데이터 조회 → 가중치 알고리즘 적용 → 리포트 생성

**출력 경로 (Outbound)**
6. 생성된 리포트 → Discord Webhook (Axios POST) → 사용자 전달

---

## 3. 모듈 구조

```
asthma-server/
├── src/
│   ├── app.js                    # Express 앱 구성
│   ├── server.js                 # 전체 진입점 (브로커+서버+스케줄러 기동)
│   │
│   ├── config/
│   │   └── index.js              # 환경변수, 임계치 상수 (WHO/ASHRAE 기준)
│   │
│   ├── mqtt/
│   │   ├── broker.js             # aedes 임베디드 브로커
│   │   ├── client.js             # 서버 자신의 Subscriber
│   │   └── handlers.js           # 토픽별 메시지 처리
│   │
│   ├── routes/
│   │   ├── auth.routes.js        # Fitbit OAuth 엔드포인트
│   │   ├── data.routes.js        # 데이터 조회 API
│   │   └── guide.routes.js       # 가이드 수동 트리거
│   │
│   ├── services/
│   │   ├── fitbit.service.js     # Fitbit API 호출
│   │   ├── weather.service.js    # 외부 기상 API 호출
│   │   ├── discord.service.js    # Discord Webhook 전송
│   │   └── guide.service.js      # 가중치 알고리즘 (핵심 로직)
│   │
│   ├── store/
│   │   └── memory.js             # In-Memory 저장소 (추상화된 인터페이스)
│   │
│   ├── scheduler/
│   │   └── cron.js               # 기상 시각 트리거
│   │
│   └── mocks/
│       ├── sensor-publisher.js   # RPi 센서 Mock MQTT Publisher
│       └── fitbit.mock.js        # Fitbit 응답 Mock
│
├── .env                          # OAuth 키, Webhook URL, API Key
└── package.json
```

---

## 4. MQTT 통신 구조

### 임베디드 브로커 방식
- aedes가 Node.js 프로세스 내부에서 TCP 서버로 동작 (port 1883)
- 서버 Subscriber, Mock Publisher, 추후 실제 RPi 모두 동일 브로커에 접속
- 브로커는 메시지 중개만 담당, 비즈니스 로직 없음

### 토픽 네이밍 규칙
```
health/sensor/{device_id}/environment    # RPi 환경 센서 데이터
health/fitbit/{user_id}/biometric        # Fitbit 집계 데이터 (RPi 경유)
health/system/{device_id}/status         # 디바이스 상태 (향후)
```

### 메시지 페이로드 스키마
기획서 2.3 데이터 명세서를 따름. `user_id`, `timestamp`, `fitbit`, `environment` 필드를 포함한 JSON 구조.

### 브로커/클라이언트 역할 분리
- **aedes 브로커**: 라우팅 전담
- **서버 Subscriber (MQTT.js)**: `health/+/+/+` 구독, 핸들러로 전달
- **Mock Publisher (개발용)**: 주기적으로 가짜 센서 데이터 publish
- **실제 RPi (향후)**: URL만 `mqtt://<서버IP>:1883`으로 변경하면 기존 코드 재사용

### 운영 전환 고려사항
환경변수 `EMBEDDED_BROKER` 토글로 임베디드 브로커 기동 여부 제어. 운영 단계에서 Mosquitto 등 외부 브로커로 전환 시 Subscriber의 접속 URL만 변경.

---

## 5. 핵심 서비스 설계

### Guide Service (가중치 알고리즘)
- **입력**: 야간 Fitbit 데이터, 아침 환경 데이터, 실외 공기질 데이터
- **처리**: 기획서 3.2 의사코드 기반 health_weight 산출 → 동적 임계치 계산 → 환기/공기청정 가이드 결정
- **출력**: status_summary, health_analysis, environment_action을 포함한 리포트 객체
- **설계 원칙**: 순수 함수로 구현. MQTT/HTTP와 분리되어 단위 테스트 용이. 향후 AWS Lambda 이식 가능.

### Fitbit Service
- OAuth 2.0 Authorization Code Flow
- 필요 Scope: `sleep`, `heartrate`, `oxygen_saturation`, `respiratory_rate`
- Access Token을 Store에 저장, 만료 시 Refresh Token으로 갱신
- Mock 모드 지원 (`USE_MOCK_FITBIT` 환경변수)

### Weather Service
- 에어코리아 Open API로 실외 PM2.5/PM10 조회
- 기상청 API로 기온/습도 조회
- 가이드 생성 시 실외 공기질이 나쁘면 환기 대신 공기청정기 가동 권장

### Discord Service
- Webhook URL로 POST
- Embed 형식으로 리포트 시각화 (상태 색상, 필드 구조화)

### Scheduler
- node-cron으로 기상 시각(예: 07:00) 자동 실행
- 사용자별 기상 시각 개인화 가능하도록 설계
- 개발 중 수동 테스트용 `POST /api/guide/trigger` API 병행 제공

---

## 6. 저장소 추상화

### 현 단계: In-Memory Store
- JavaScript `Map` 기반 간단 구현
- `saveEnvironment(deviceId, data)`, `saveBiometric(userId, data)`, `getLatest(...)` 인터페이스
- 프로세스 재시작 시 소실되나, 개발 단계에선 문제없음

### 향후 확장
- 동일 인터페이스를 유지하며 SQLite(로컬) 또는 Redis(캐시) + DynamoDB(영구)로 교체
- 기획서 5절 "DB는 RPi 로컬에만 둔다" 원칙과의 정합성 검토 필요. 서버에는 **가이드 생성에 필요한 최소 캐싱**만 유지하고 영구 개인정보는 저장하지 않는 방향 권장.

---

## 7. 외부 연동 설계 (Axios 기반)

| 대상 | 프로토콜 | 인증 | 호출 시점 |
|---|---|---|---|
| Fitbit Web API | HTTPS | OAuth 2.0 Bearer | 기상 시 + 토큰 갱신 시 |
| 에어코리아 API | HTTPS | API Key | 가이드 생성 시 |
| 기상청 API | HTTPS | API Key | 가이드 생성 시 |
| Discord Webhook | HTTPS | Webhook URL | 리포트 발송 시 |

Axios 인스턴스를 서비스별로 분리하여 baseURL, 타임아웃, 인터셉터(토큰 주입, 에러 처리)를 개별 관리한다.

---

## 8. Mock 전략

### 목적
실제 하드웨어 없이 전체 파이프라인을 검증하며, Mock↔Real 전환이 코드 수정 없이 환경변수로 가능해야 함.

### Mock 구성
- **sensor-publisher**: 주기적으로(예: 5초) 랜덤 환경 데이터를 MQTT publish
- **fitbit.mock**: Fitbit API 응답 형식의 야간 데이터 반환 (낮은 SpO2, 높은 호흡수 등 이상 케이스 포함)

### 전환 스위치
```
USE_MOCK_SENSOR=true       # Mock Publisher 자동 기동
USE_MOCK_FITBIT=true       # Fitbit Service가 Mock 응답 반환
EMBEDDED_BROKER=true       # aedes 브로커 내장 기동
```

---

## 9. 개발 로드맵

| 단계 | 작업 | 산출물 |
|---|---|---|
| 1 | Express 골격 + config 상수화 | `/health` 동작 |
| 2 | aedes 브로커 + Subscriber + Mock Publisher | MQTT 파이프라인 로그 확인 |
| 3 | Store + 가중치 알고리즘 | 단위 테스트 통과 |
| 4 | Fitbit OAuth + API 연동 | 실제 야간 데이터 수집 |
| 5 | Weather + Discord 연동 | 리포트 전송 확인 |
| 6 | Scheduler 연결 | 자동 모닝 브리핑 동작 |
| 7 | 실제 RPi 연동 | Mock Publisher 제거, 브로커 URL만 변경 |

---

## 10. 설계 원칙 요약

1. **계층 분리**: 수집/저장/로직/출력을 독립 모듈로 분리하여 테스트 및 교체 용이성 확보
2. **순수 함수 지향**: 가중치 알고리즘은 외부 의존성 없이 입출력만으로 동작
3. **Mock 우선**: 모든 외부 의존성(하드웨어, 외부 API)은 Mock으로 대체 가능해야 함
4. **환경변수 토글**: Mock/Real, 임베디드/외부 브로커 전환이 코드 변경 없이 가능
5. **인터페이스 안정성**: RPi 실물 연동 시점에 서버 코드 변경이 최소화되도록 토픽/스키마를 미리 확정
6. **보안 최소 원칙**: 개인 민감정보는 서버 영구 저장을 지양, 필요한 최소 캐싱만 유지