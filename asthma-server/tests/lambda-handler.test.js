import assert from 'node:assert/strict';
import test from 'node:test';
import { createHandler, normalizeFitbitInput } from '../lambda/index.mjs';

function makeMemoryDb() {
  const envs = new Map();
  const bios = new Map();
  const guides = new Map();
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
