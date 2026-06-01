import assert from 'node:assert/strict';
import test from 'node:test';
import { createHandler, normalizeFitbitInput } from '../lambda/index.mjs';

function makeMemoryDb() {
  const envs = new Map();
  const bios = new Map();
  const guides = new Map();
  const fitbitTokens = new Map();
  return {
    tableName: 'TestTable',
    async saveEnvironment(data) {
      const item = {
        PK: `DEVICE#${data.device_id || data.deviceId || 'rpi_001'}`,
        SK: `ENV#${data.timestamp}`,
        type: 'environment',
        data: { ...data, device_id: data.device_id || data.deviceId || 'rpi_001' },
      };
      envs.set(item.PK, item);
      return item;
    },
    async saveBiometric(data) {
      const bio = normalizeFitbitInput(data);
      const item = {
        PK: `USER#${bio.user_id}`,
        SK: `BIO#${bio.date}`,
        type: 'biometric',
        data: bio,
      };
      bios.set(item.PK, item);
      return item;
    },
    async saveFitbitToken(token) {
      const item = {
        PK: `USER#${token.user_id || 'user_001'}`,
        SK: 'FITBIT_TOKEN',
        type: 'fitbit_token',
        data: { ...token, user_id: token.user_id || 'user_001' },
      };
      fitbitTokens.set(item.PK, item);
      return item;
    },
    async getFitbitToken(userId = 'user_001') {
      return fitbitTokens.get(`USER#${userId}`) ?? null;
    },
    async getLatestEnvironment(deviceId) {
      return envs.get(`DEVICE#${deviceId}`) ?? null;
    },
    async getLatestBiometric(userId) {
      return bios.get(`USER#${userId}`) ?? null;
    },
    async saveGuide({ userId, date, report, sources }) {
      const item = { PK: `USER#${userId}`, SK: `GUIDE#${date}`, type: 'guide', data: report, sources };
      guides.set(`${userId}:${date}`, item);
      return item;
    },
    async getGuide(userId, date) {
      return guides.get(`${userId}:${date}`) ?? null;
    },
  };
}

function httpEvent(method, path, body, queryStringParameters) {
  return {
    version: '2.0',
    rawPath: path,
    requestContext: { http: { method, path } },
    queryStringParameters,
    body: body ? JSON.stringify(body) : undefined,
  };
}

test('Lambda HTTP flow stores environment, biometric, guide, and retrieves today guide', async () => {
  const handler = createHandler({ db: makeMemoryDb() });

  const envRes = await handler(
    httpEvent('POST', '/measurements/environment', {
      device_id: 'rpi_001',
      timestamp: '2026-06-01T00:00:00Z',
      pm25: 32.4,
      pm10: 55.1,
      co2: 1250,
      voc: 0.58,
      temperature: 25.2,
      humidity: 64,
    }),
  );
  assert.equal(envRes.statusCode, 201);

  const bioRes = await handler(
    httpEvent('POST', '/biometrics/fitbit', {
      user_id: 'user_001',
      date: '2026-06-01',
      sleep_minutes: 320,
      avg_spo2: 92,
      respiratory_rate: 23,
      resting_hr: 82,
      hrv: 18,
    }),
  );
  assert.equal(bioRes.statusCode, 201);

  const guideRes = await handler(
    httpEvent('POST', '/guides/generate', {
      user_id: 'user_001',
      device_id: 'rpi_001',
      date: '2026-06-01',
    }),
  );
  assert.equal(guideRes.statusCode, 201);
  const guideBody = JSON.parse(guideRes.body);
  assert.equal(guideBody.ok, true);
  assert.equal(guideBody.report.health_analysis.level, 'high');
  assert.equal(guideBody.report.status_summary.overall, 'danger');
  assert.ok(guideBody.report.environment_action.message.length > 0);

  const todayRes = await handler(
    httpEvent('GET', '/guides/today', undefined, { userId: 'user_001', date: '2026-06-01' }),
  );
  assert.equal(todayRes.statusCode, 200);
  assert.equal(JSON.parse(todayRes.body).item.SK, 'GUIDE#2026-06-01');
});

test('notify route generates guide and returns mock Discord delivery for single-user demo', async () => {
  const handler = createHandler({ db: makeMemoryDb() });

  await handler(
    httpEvent('POST', '/measurements/environment', {
      device_id: 'rpi_001',
      timestamp: '2026-06-01T00:00:00Z',
      pm25: 32.4,
      pm10: 55.1,
      co2: 1250,
      voc: 0.58,
      temperature: 25.2,
      humidity: 64,
    }),
  );
  await handler(
    httpEvent('POST', '/biometrics/fitbit', {
      user_id: 'user_001',
      date: '2026-06-01',
      source: 'fitbit_api',
      sleep_minutes: 320,
      sleep_efficiency: 89,
      avg_spo2: 92,
      min_spo2: 90,
      max_spo2: 96,
      respiratory_rate: 23,
      resting_hr: 82,
      hrv: 18,
    }),
  );

  const notifyRes = await handler(httpEvent('POST', '/guides/notify', { date: '2026-06-01' }));

  assert.equal(notifyRes.statusCode, 201);
  const notifyBody = JSON.parse(notifyRes.body);
  assert.equal(notifyBody.ok, true);
  assert.equal(notifyBody.userId, 'user_001');
  assert.equal(notifyBody.deviceId, 'rpi_001');
  assert.equal(notifyBody.delivery.ok, true);
  assert.equal(notifyBody.delivery.mock, true);
  assert.equal(notifyBody.delivery.reason, 'USE_MOCK_DISCORD=true');
  assert.equal(notifyBody.item.SK, 'GUIDE#2026-06-01');
  assert.match(notifyBody.delivery.payload.content, /천식|실내|공기|환기/);
});

test('manual Fitbit notify route stores biometric, combines latest RPi data, and returns Discord delivery', async () => {
  const handler = createHandler({ db: makeMemoryDb() });

  await handler(
    httpEvent('POST', '/measurements/environment', {
      device_id: 'rpi_001',
      timestamp: '2026-06-01T00:00:00Z',
      pm25: 18,
      pm10: 44,
      co2: 920,
      voc: 0.22,
      temperature: 23.5,
      humidity: 45,
    }),
  );

  const res = await handler(
    httpEvent('POST', '/biometrics/fitbit/notify', {
      user_id: 'user_001',
      date: '2026-06-01',
      sleep_minutes: 330,
      avg_spo2: 94,
      respiratory_rate: 20,
      resting_hr: 78,
      hrv: 24,
    }),
  );

  assert.equal(res.statusCode, 201);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.mode, 'manual-fitbit-notify');
  assert.equal(body.biometric.SK, 'BIO#2026-06-01');
  assert.equal(body.item.SK, 'GUIDE#2026-06-01');
  assert.equal(body.delivery.ok, true);
  assert.equal(body.delivery.mock, true);
  assert.equal(body.report.userId, 'user_001');
});

test('Google Health planned route documents future Fitbit sync path without external integration', async () => {
  const handler = createHandler({ db: makeMemoryDb() });

  const res = await handler(httpEvent('POST', '/google-health/fitbit/sync', { user_id: 'user_001', date: '2026-06-01' }));

  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.provider, 'google-health-api');
  assert.equal(body.mode, 'planned-only');
  assert.equal(body.manualFallback, 'POST /biometrics/fitbit/notify');
  assert.ok(body.plannedFlow.includes('Google OAuth consent for health data scopes'));
});

test('Lambda IoT rule event stores environment without HTTP wrapper', async () => {
  const db = makeMemoryDb();
  const handler = createHandler({ db });

  const result = await handler({
    device_id: 'rpi_001',
    timestamp: '2026-06-01T01:02:03Z',
    pm25: 28,
    co2: 1180,
    temperature: 24.8,
    humidity: 61,
  });

  assert.equal(result.ok, true);
  assert.equal(result.source, 'iot-rule');
  assert.equal(result.item.PK, 'DEVICE#rpi_001');
  assert.equal(result.item.SK, 'ENV#2026-06-01T01:02:03Z');
});
