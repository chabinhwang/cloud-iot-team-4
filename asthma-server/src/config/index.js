import 'dotenv/config';

const bool = (v, d = false) => {
  if (v === undefined) return d;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
};

const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

export const config = {
  port: num(process.env.PORT, 3000),

  mqtt: {
    embedded: bool(process.env.EMBEDDED_BROKER, true),
    brokerPort: num(process.env.MQTT_PORT, 1883),
    url: process.env.MQTT_URL || 'mqtt://localhost:1883',
    topics: {
      subscribeAll: 'health/+/+/+',
      environment: (deviceId) => `health/sensor/${deviceId}/environment`,
      biometric: (userId) => `health/fitbit/${userId}/biometric`,
    },
  },

  mock: {
    sensor: bool(process.env.USE_MOCK_SENSOR, true),
    fitbit: bool(process.env.USE_MOCK_FITBIT, true),
    weather: bool(process.env.USE_MOCK_WEATHER, true),
    discord: bool(process.env.USE_MOCK_DISCORD, true),
    sensorIntervalMs: num(process.env.MOCK_SENSOR_INTERVAL_MS, 5000),
  },

  scheduler: {
    enabled: bool(process.env.SCHEDULER_ENABLED, true),
    morningCron: process.env.MORNING_CRON || '0 7 * * *',
    timezone: process.env.DEFAULT_TIMEZONE || 'Asia/Seoul',
  },

  defaults: {
    userId: process.env.DEFAULT_USER_ID || 'user_001',
    deviceId: process.env.DEFAULT_DEVICE_ID || 'rpi_001',
  },

  fitbit: {
    clientId: process.env.FITBIT_CLIENT_ID || '',
    clientSecret: process.env.FITBIT_CLIENT_SECRET || '',
    redirectUri: process.env.FITBIT_REDIRECT_URI || 'http://localhost:3000/auth/fitbit/callback',
    authorizeUrl: 'https://www.fitbit.com/oauth2/authorize',
    tokenUrl: 'https://api.fitbit.com/oauth2/token',
    apiBase: 'https://api.fitbit.com',
    scopes: ['sleep', 'heartrate', 'oxygen_saturation', 'respiratory_rate'],
  },

  weather: {
    airkoreaKey: process.env.AIRKOREA_API_KEY || '',
    kmaKey: process.env.KMA_API_KEY || '',
  },

  discord: {
    webhookUrl: process.env.DISCORD_WEBHOOK_URL || '',
  },

  // WHO/ASHRAE 기준 실내환경 임계치 (base)
  // good: 안전, warning: 주의, danger: 위험
  thresholds: {
    pm25: { good: 15, warning: 25, danger: 35, unit: 'µg/m³' },
    pm10: { good: 30, warning: 50, danger: 80, unit: 'µg/m³' },
    co2: { good: 800, warning: 1000, danger: 1500, unit: 'ppm' },
    voc: { good: 0.3, warning: 0.5, danger: 1.0, unit: 'mg/m³' },
    temperature: { lowGood: 20, lowWarn: 18, highGood: 24, highWarn: 26, unit: '°C' },
    humidity: { lowGood: 40, lowWarn: 30, highGood: 60, highWarn: 70, unit: '%' },
    // 실외 PM2.5: 이보다 나쁘면 환기 대신 공기청정기 권장
    outdoorPm25Bad: 35,
    outdoorPm10Bad: 80,
  },

  // 천식환자 생체지표 이상 기준 (일반적 참고치 기반)
  biometricRisk: {
    spo2: { severe: 92, mild: 95 },
    respiratoryRate: { severe: 22, mild: 18 },
    sleepMinutes: { low: 360 },
  },
};

export default config;
