# 천식환자 공간 조성 가이드 서비스

> 26-1 클라우드IoT 4팀

야간 생체 데이터(Fitbit) + 실내 환경 데이터(IoT 센서)를 통합해, 개인 민감도에 따라 달라지는 공간 조성 가이드를 Discord로 전달합니다.

---

## 저장소 구조

| 폴더 | 역할 | 상태 |
|---|---|---|
| [`asthma-server/`](./asthma-server) | MQTT 브로커/구독자, 가이드 파이프라인, Discord 알림, REST API · Swagger UI | ✅ Mock 파이프라인 동작 |
| [`pi-client/`](./pi-client) | 라즈베리파이 — DHT11 실제값 + ZPH01/SGP30 랜덤값 → API Gateway POST | ✅ API Gateway POST 구현 |

각 폴더의 실행 방법·계약은 해당 폴더 README를 참조하세요:
👉 [`asthma-server/README.md`](./asthma-server/README.md) · [`pi-client/README.md`](./pi-client/README.md)

---

## 아키텍처

```text
[Raspberry Pi pi-client]
  - DHT11 real temperature/humidity
  - ZPH01/SGP30 random substitute values
          │
          ▼
[API Gateway POST /measurements/environment]
          │
          ▼
[Lambda]
          │
          ▼
[DynamoDB]
          │
          ▼
[Guide Service / REST API / Discord]
```

Pi 클라이언트 입력 경로: `POST /measurements/environment`

---

## 빠른 시작 (서버 단독, Mock 모드)

```bash
cd asthma-server
cp .env.example .env
npm install && npm start
# → http://localhost:3000/docs 에서 Swagger UI 열기
```

---

## 진행 상황

| 단계 | 상태 |
|---|---|
| 서버: Express + MQTT 브로커/구독자 + Mock 파이프라인 | ✅ |
| 서버: Fitbit / Weather / Discord 연동 (Mock·Real 토글) | ✅ |
| 서버: 스케줄러 + Swagger UI / OpenAPI 자동 문서화 | ✅ |
| pi-client: DHT11 실제값 + 랜덤 대체 센서값 API Gateway POST | ✅ |
