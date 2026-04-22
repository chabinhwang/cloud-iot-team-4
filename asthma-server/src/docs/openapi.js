// OpenAPI 3.0 스펙 빌더 — swagger-jsdoc이 각 라우트의 @openapi 주석을 수집해 병합.
// 재사용되는 스키마/파라미터/예시는 여기서 한 번만 선언하고 $ref로 참조.

import swaggerJsdoc from 'swagger-jsdoc';

const definition = {
  openapi: '3.0.3',
  info: {
    title: '천식환자 공간 조성 가이드 API',
    version: '0.1.0',
    description: [
      '야간 생체 데이터(Fitbit) + 실내 환경(IoT 센서) + 실외 공기질을 통합해',
      '개인의 건강 민감도에 따라 동적으로 달라지는 공간 조성 가이드를 Discord로 전달하는 서비스의 REST API.',
      '',
      '기본 `.env.example` 설정은 Fitbit · Weather · Discord · Sensor를 모두 Mock으로 돌립니다.',
      'Mock 상태에서 바로 호출 가능한 엔드포인트는 `Health`, `Data`, `Guide` 태그 아래 있습니다.',
      '`Auth` 태그(Fitbit OAuth)는 `FITBIT_CLIENT_ID`가 실제로 설정된 경우에만 의미가 있습니다.',
    ].join('\n'),
    contact: { name: '26-1 클라우드IoT 4팀' },
  },
  servers: [
    { url: 'http://localhost:3000', description: '로컬 개발 서버' },
  ],
  tags: [
    { name: 'Health', description: '서버 상태 및 설정 확인' },
    { name: 'Data', description: 'MQTT Subscriber가 Store에 쌓은 최신 측정값 조회' },
    { name: 'Guide', description: '가이드 파이프라인 실행 / 프리뷰 (핵심 도메인 기능)' },
    { name: 'Auth', description: 'Fitbit OAuth 2.0 인가 플로우 (실제 연동 시)' },
  ],
  components: {
    schemas: {
      HealthResponse: {
        type: 'object',
        properties: {
          ok: { type: 'boolean', example: true },
          uptime_s: { type: 'integer', description: '프로세스 가동 시간(초)', example: 42 },
          mqtt: { type: 'string', example: 'mqtt://localhost:1883' },
          mocks: {
            type: 'object',
            description: '각 외부 의존성의 Mock 토글 상태',
            properties: {
              sensor: { type: 'boolean', example: true },
              fitbit: { type: 'boolean', example: true },
              weather: { type: 'boolean', example: true },
              discord: { type: 'boolean', example: true },
            },
          },
          timestamp: { type: 'string', format: 'date-time' },
        },
      },
      EnvironmentRecord: {
        type: 'object',
        description: '실내 환경 센서 한 건 (MQTT 토픽 `health/sensor/{deviceId}/environment` 수신본)',
        properties: {
          deviceId: { type: 'string', example: 'rpi_001' },
          device_id: { type: 'string', example: 'rpi_001' },
          timestamp: { type: 'string', format: 'date-time' },
          pm25: { type: 'number', description: '초미세먼지 µg/m³', example: 47.47 },
          pm10: { type: 'number', description: '미세먼지 µg/m³', example: 79.77 },
          co2: { type: 'number', description: '이산화탄소 ppm', example: 1380.72 },
          voc: { type: 'number', description: '휘발성 유기화합물 지수', example: 0.59 },
          temperature: { type: 'number', description: '온도 °C', example: 22.06 },
          humidity: { type: 'number', description: '습도 %', example: 46.28 },
        },
      },
      EnvironmentList: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: { $ref: '#/components/schemas/EnvironmentRecord' },
          },
        },
      },
      BiometricRecord: {
        type: 'object',
        description: '야간 생체 집계 (Fitbit 또는 Mock)',
        properties: {
          userId: { type: 'string', example: 'user_001' },
          user_id: { type: 'string', example: 'user_001' },
          timestamp: { type: 'string', format: 'date-time' },
          source: { type: 'string', enum: ['fitbit', 'mock'], example: 'fitbit' },
          sleep_duration_min: { type: 'integer', description: '총 수면 시간(분)', example: 420 },
          avg_spo2: { type: 'number', description: '평균 산소포화도 %', example: 94 },
          min_spo2: { type: 'number', description: '최저 산소포화도 %', example: 91 },
          avg_respiratory_rate: { type: 'number', description: '평균 호흡수 회/분', example: 19 },
          max_respiratory_rate: { type: 'number', description: '최대 호흡수 회/분', example: 22 },
          resting_hr: { type: 'number', description: '안정 심박 bpm', example: 72 },
          hrv: { type: 'number', description: '심박변이도 ms', example: 35 },
        },
      },
      BiometricList: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: { $ref: '#/components/schemas/BiometricRecord' },
          },
        },
      },
      GuideStatus: {
        type: 'string',
        enum: ['good', 'warning', 'danger'],
        description: '항목/전체 상태',
      },
      GuideReport: {
        type: 'object',
        description: '가이드 파이프라인 결과 리포트',
        properties: {
          status_summary: {
            type: 'object',
            properties: {
              overall: { $ref: '#/components/schemas/GuideStatus' },
              overall_emoji: { type: 'string', example: '🔴' },
              perMetric: {
                type: 'object',
                additionalProperties: { $ref: '#/components/schemas/GuideStatus' },
                description: '항목별 상태 (pm25, pm10, co2, voc, temperature, humidity)',
              },
            },
          },
          health_analysis: {
            type: 'object',
            properties: {
              weight: {
                type: 'number',
                format: 'float',
                minimum: 0,
                maximum: 1,
                description: '야간 생체지표로 산출한 건강 민감도 가중치',
                example: 0.8,
              },
              level: { type: 'string', enum: ['low', 'medium', 'high'], example: 'high' },
              reasons: {
                type: 'array',
                items: { type: 'string' },
                example: ['SpO2 90% (심각: <92)', '호흡수 24회/분 (심각: >22)'],
              },
            },
          },
          environment_action: {
            type: 'object',
            properties: {
              primary: {
                type: 'string',
                enum: ['ventilate', 'air_purifier', 'ventilate_and_purify', 'maintain'],
                description: '1차 권장 조치',
              },
              message: {
                type: 'string',
                example: '창문을 열고 10~15분 환기하세요 (CO₂ 배출).',
              },
              suggestions: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
      GuidePipelineResult: {
        type: 'object',
        properties: {
          ok: { type: 'boolean', example: true },
          skipped: {
            type: 'boolean',
            description: '입력 데이터 부족 등의 이유로 파이프라인이 건너뛰어졌는지',
            example: false,
          },
          report: { $ref: '#/components/schemas/GuideReport' },
          discord: {
            type: 'object',
            nullable: true,
            description: 'sendToDiscord=true일 때만 존재',
            properties: {
              sent: { type: 'boolean' },
              mocked: { type: 'boolean', description: 'USE_MOCK_DISCORD=true면 콘솔 출력으로 대체' },
            },
          },
        },
      },
      GuideTriggerRequest: {
        type: 'object',
        properties: {
          userId: {
            type: 'string',
            description: '대상 사용자 ID (없으면 DEFAULT_USER_ID)',
            example: 'user_001',
          },
          deviceId: {
            type: 'string',
            description: '대상 디바이스 ID (없으면 DEFAULT_DEVICE_ID)',
            example: 'rpi_001',
          },
          scenario: {
            type: 'string',
            enum: ['healthy', 'mild', 'severe', 'random'],
            description: 'Mock Fitbit 시나리오 (USE_MOCK_FITBIT=true일 때만 의미)',
            example: 'severe',
          },
          sendToDiscord: {
            type: 'boolean',
            default: true,
            description: 'Discord Webhook으로 리포트 전송 여부 (Mock이면 콘솔 출력)',
            example: false,
          },
        },
      },
      ErrorResponse: {
        type: 'object',
        properties: {
          error: { type: 'string', example: 'not_found' },
        },
        additionalProperties: true,
      },
    },
    parameters: {
      DeviceIdPath: {
        in: 'path',
        name: 'deviceId',
        required: false,
        schema: { type: 'string' },
        description: '디바이스 ID (생략 시 DEFAULT_DEVICE_ID=rpi_001)',
        example: 'rpi_001',
      },
      UserIdPath: {
        in: 'path',
        name: 'userId',
        required: false,
        schema: { type: 'string' },
        description: '사용자 ID (생략 시 DEFAULT_USER_ID=user_001)',
        example: 'user_001',
      },
      ScenarioQuery: {
        in: 'query',
        name: 'scenario',
        required: false,
        schema: { type: 'string', enum: ['healthy', 'mild', 'severe', 'random'] },
        description: 'Mock Fitbit 시나리오. Mock 모드에서만 적용.',
      },
    },
  },
};

const options = {
  definition,
  // 각 라우트 파일의 @openapi 주석을 스캔 (app.js의 /health 포함)
  apis: ['./src/routes/*.js', './src/app.js'],
};

const spec = swaggerJsdoc(options);

export default spec;
