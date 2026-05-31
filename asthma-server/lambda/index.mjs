const DEFAULT_TABLE_NAME = 'AsthmaGuideData';
const DEFAULT_USER_ID = process.env.DEFAULT_USER_ID || 'user_001';
const DEFAULT_DEVICE_ID = process.env.DEFAULT_DEVICE_ID || 'rpi_001';
const TABLE_NAME = process.env.TABLE_NAME || DEFAULT_TABLE_NAME;
const SERVICE_NAME = 'cloud-iot-team4-asthma-guide';

const thresholds = {
  pm25: { good: 15, warning: 25, danger: 35, unit: 'µg/m³' },
  pm10: { good: 30, warning: 50, danger: 80, unit: 'µg/m³' },
  co2: { good: 800, warning: 1000, danger: 1500, unit: 'ppm' },
  voc: { good: 0.3, warning: 0.5, danger: 1.0, unit: 'mg/m³' },
  temperature: { lowGood: 20, lowWarn: 18, highGood: 24, highWarn: 26, unit: '°C' },
  humidity: { lowGood: 40, lowWarn: 30, highGood: 60, highWarn: 70, unit: '%' },
  outdoorPm25Bad: 35,
  outdoorPm10Bad: 80,
};

const biometricRisk = {
  spo2: { severe: 92, mild: 95 },
  respiratoryRate: { severe: 22, mild: 18 },
  sleepMinutes: { low: 360 },
};

const WORST = { good: 0, warning: 1, danger: 2 };
const LABEL = ['good', 'warning', 'danger'];

const corsHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
};

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function worst(a, b) {
  return WORST[a] >= WORST[b] ? a : b;
}

function tightenThreshold(value, weight) {
  return value * (1 - 0.25 * weight);
}

function classifyEnv(value, threshold, weight) {
  const good = tightenThreshold(threshold.good, weight);
  const warning = tightenThreshold(threshold.warning, weight);
  return value <= good ? 'good' : value <= warning ? 'warning' : 'danger';
}

function classifyRange(value, threshold) {
  if (value >= threshold.lowGood && value <= threshold.highGood) return 'good';
  if (value >= threshold.lowWarn && value <= threshold.highWarn) return 'warning';
  return 'danger';
}

function normalizeBiometric(b = {}) {
  return {
    spo2: num(b.avg_spo2 ?? b.spo2?.avg ?? b.spo2),
    respiratoryRate: num(
      b.avg_respiratory_rate ?? b.respiratory_rate?.avg ?? b.respiratory_rate ?? b.respiratoryRate,
    ),
    sleepMinutes: num(b.sleep_duration_min ?? b.sleep_minutes ?? b.sleep?.durationMin ?? b.sleepMinutes),
    hrv: num(b.hrv ?? b.heart_rate_variability),
  };
}

function computeHealthWeight(biometric) {
  const reasons = [];
  let weight = 0;

  if (!biometric) return { weight: 0, reasons: ['no_biometric_data'] };

  const { spo2, respiratoryRate, sleepMinutes, hrv } = normalizeBiometric(biometric);
  const risk = biometricRisk;

  if (Number.isFinite(spo2)) {
    if (spo2 < risk.spo2.severe) {
      weight += 0.35;
      reasons.push(`SpO2 ${spo2}% (심각: <${risk.spo2.severe})`);
    } else if (spo2 < risk.spo2.mild) {
      weight += 0.15;
      reasons.push(`SpO2 ${spo2}% (주의: <${risk.spo2.mild})`);
    }
  }

  if (Number.isFinite(respiratoryRate)) {
    if (respiratoryRate > risk.respiratoryRate.severe) {
      weight += 0.25;
      reasons.push(`호흡수 ${respiratoryRate}회/분 (심각: >${risk.respiratoryRate.severe})`);
    } else if (respiratoryRate > risk.respiratoryRate.mild) {
      weight += 0.1;
      reasons.push(`호흡수 ${respiratoryRate}회/분 (주의: >${risk.respiratoryRate.mild})`);
    }
  }

  if (Number.isFinite(sleepMinutes) && sleepMinutes < risk.sleepMinutes.low) {
    weight += 0.15;
    reasons.push(`수면 ${sleepMinutes}분 (<${risk.sleepMinutes.low})`);
  }

  if (Number.isFinite(hrv) && hrv < 20) {
    weight += 0.05;
    reasons.push(`HRV ${hrv}ms (낮음)`);
  }

  return { weight: Math.min(1, Number(weight.toFixed(2))), reasons };
}

function weightLevel(weight) {
  if (weight >= 0.6) return 'high';
  if (weight >= 0.25) return 'medium';
  return 'low';
}

function decideAction({ overall, perMetric, outdoorBad }) {
  const badDust = ['warning', 'danger'].includes(perMetric.pm25?.status) || ['warning', 'danger'].includes(perMetric.pm10?.status);
  const badCo2 = ['warning', 'danger'].includes(perMetric.co2?.status);
  const badHumidity = ['warning', 'danger'].includes(perMetric.humidity?.status);

  if (overall === 'good') {
    return {
      primary: 'maintain',
      message: '현재 실내환경은 안정적입니다. 현재 상태를 유지하세요.',
      suggestions: ['공기청정기 자동 모드 유지', '습도 40~60% 유지'],
    };
  }

  if (badDust && outdoorBad) {
    return {
      primary: 'air_purifier',
      message: '실내 미세먼지가 높고 실외 공기도 나쁩니다. 창문 환기보다 공기청정기 강풍 운전을 우선 권장합니다.',
      suggestions: ['공기청정기 강풍 30분', '창문 닫기', '청소/분무 등 입자 발생 행동 피하기'],
    };
  }

  if (badCo2 && !outdoorBad) {
    return {
      primary: 'ventilate',
      message: '실내 CO₂가 높습니다. 창문을 열고 10~15분 환기하세요.',
      suggestions: ['맞통풍 10~15분', '환기 후 공기청정기 자동 모드'],
    };
  }

  if (badHumidity) {
    return {
      primary: 'humidity_control',
      message: '습도가 천식 관리 권장 범위를 벗어났습니다. 40~60% 범위로 조절하세요.',
      suggestions: ['가습/제습으로 40~60% 유지', '침구류 습기 관리'],
    };
  }

  return {
    primary: outdoorBad ? 'air_purifier' : 'ventilate',
    message: outdoorBad ? '실외 공기가 좋지 않아 공기청정기 사용을 권장합니다.' : '짧은 환기로 실내 공기를 교체하세요.',
    suggestions: outdoorBad ? ['공기청정기 20~30분', '창문 닫기'] : ['10분 환기', '환기 후 문 닫기'],
  };
}

function generateGuide({ biometric, environment, outdoor, userId, timestamp }) {
  const now = timestamp || new Date().toISOString();
  const { weight, reasons } = computeHealthWeight(biometric);
  const env = environment?.data ?? environment ?? {};

  const perMetric = {};
  let overall = 'good';
  const addMetric = (key, status, value, unit) => {
    perMetric[key] = { status, value, unit };
    overall = worst(overall, status);
  };

  if (Number.isFinite(env.pm25)) addMetric('pm25', classifyEnv(env.pm25, thresholds.pm25, weight), env.pm25, thresholds.pm25.unit);
  if (Number.isFinite(env.pm10)) addMetric('pm10', classifyEnv(env.pm10, thresholds.pm10, weight), env.pm10, thresholds.pm10.unit);
  if (Number.isFinite(env.co2)) addMetric('co2', classifyEnv(env.co2, thresholds.co2, weight), env.co2, thresholds.co2.unit);
  if (Number.isFinite(env.voc)) addMetric('voc', classifyEnv(env.voc, thresholds.voc, weight), env.voc, thresholds.voc.unit);
  if (Number.isFinite(env.temperature)) {
    addMetric('temperature', classifyRange(env.temperature, thresholds.temperature), env.temperature, thresholds.temperature.unit);
  }
  if (Number.isFinite(env.humidity)) {
    addMetric('humidity', classifyRange(env.humidity, thresholds.humidity), env.humidity, thresholds.humidity.unit);
  }

  const outdoorBad =
    (Number.isFinite(outdoor?.pm25) && outdoor.pm25 >= thresholds.outdoorPm25Bad) ||
    (Number.isFinite(outdoor?.pm10) && outdoor.pm10 >= thresholds.outdoorPm10Bad);

  return {
    userId: userId || 'unknown',
    generatedAt: now,
    status_summary: {
      overall,
      overall_emoji: overall === 'good' ? '🟢' : overall === 'warning' ? '🟡' : '🔴',
      perMetric,
    },
    health_analysis: {
      weight,
      level: weightLevel(weight),
      reasons,
      biometric: biometric ?? null,
    },
    environment_action: decideAction({ overall, perMetric, outdoorBad, weight }),
    outdoor: outdoor ?? null,
  };
}

function kstDate(date = new Date()) {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function normalizeEnvironment(input = {}) {
  const timestamp = input.timestamp || new Date().toISOString();
  return {
    device_id: input.device_id || input.deviceId || DEFAULT_DEVICE_ID,
    timestamp,
    pm25: num(input.pm25),
    pm10: num(input.pm10),
    co2: num(input.co2),
    voc: num(input.voc ?? input.tvoc),
    temperature: num(input.temperature),
    humidity: num(input.humidity),
  };
}

function normalizeFitbitInput(input = {}) {
  return {
    user_id: input.user_id || input.userId || DEFAULT_USER_ID,
    date: input.date || kstDate(),
    sleep_minutes: num(input.sleep_minutes ?? input.sleepMinutes ?? input.sleep_duration_min),
    sleepMinutes: num(input.sleepMinutes ?? input.sleep_minutes ?? input.sleep_duration_min),
    avg_spo2: num(input.avg_spo2 ?? input.spo2),
    spo2: num(input.spo2 ?? input.avg_spo2),
    respiratory_rate: num(input.respiratory_rate ?? input.respiratoryRate ?? input.avg_respiratory_rate),
    respiratoryRate: num(input.respiratoryRate ?? input.respiratory_rate ?? input.avg_respiratory_rate),
    resting_hr: num(input.resting_hr ?? input.restingHr),
    hrv: num(input.hrv ?? input.heart_rate_variability),
  };
}

function marshallValue(value) {
  if (value === undefined) return undefined;
  if (value === null) return { NULL: true };
  if (typeof value === 'string') return { S: value };
  if (typeof value === 'number') return { N: String(value) };
  if (typeof value === 'boolean') return { BOOL: value };
  if (Array.isArray(value)) return { L: value.map(marshallValue).filter(Boolean) };
  if (typeof value === 'object') {
    const mapped = Object.fromEntries(
      Object.entries(value)
        .map(([key, item]) => [key, marshallValue(item)])
        .filter(([, item]) => item !== undefined),
    );
    return { M: mapped };
  }
  return { S: String(value) };
}

function marshallItem(item) {
  return Object.fromEntries(
    Object.entries(item)
      .map(([key, value]) => [key, marshallValue(value)])
      .filter(([, value]) => value !== undefined),
  );
}

function unmarshallValue(value) {
  if ('S' in value) return value.S;
  if ('N' in value) return Number(value.N);
  if ('BOOL' in value) return value.BOOL;
  if ('NULL' in value) return null;
  if ('L' in value) return value.L.map(unmarshallValue);
  if ('M' in value) return Object.fromEntries(Object.entries(value.M).map(([key, item]) => [key, unmarshallValue(item)]));
  return undefined;
}

function unmarshallItem(item) {
  if (!item) return null;
  return Object.fromEntries(Object.entries(item).map(([key, value]) => [key, unmarshallValue(value)]));
}

function createDynamoStore({ tableName = TABLE_NAME } = {}) {
  let sdk;
  async function loadSdk() {
    if (!sdk) {
      const mod = await import('@aws-sdk/client-dynamodb');
      const client = new mod.DynamoDBClient({});
      sdk = { ...mod, client };
    }
    return sdk;
  }

  async function send(Command, input) {
    const loaded = await loadSdk();
    return loaded.client.send(new Command(input));
  }

  async function putTypedItem(type, key, data, extra = {}) {
    const now = new Date().toISOString();
    const item = { ...key, type, data, created_at: now, ...extra };
    const { PutItemCommand } = await loadSdk();
    await send(PutItemCommand, { TableName: tableName, Item: marshallItem(item) });
    return item;
  }

  async function queryLatest(pk, skPrefix) {
    const { QueryCommand } = await loadSdk();
    const result = await send(QueryCommand, {
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: marshallItem({ ':pk': pk, ':sk': skPrefix }),
      ScanIndexForward: false,
      Limit: 1,
    });
    return unmarshallItem(result.Items?.[0]);
  }

  async function getItem(pk, sk) {
    const { GetItemCommand } = await loadSdk();
    const result = await send(GetItemCommand, { TableName: tableName, Key: marshallItem({ PK: pk, SK: sk }) });
    return unmarshallItem(result.Item);
  }

  return {
    tableName,
    async saveEnvironment(environment) {
      const env = normalizeEnvironment(environment);
      return putTypedItem(
        'environment',
        { PK: `DEVICE#${env.device_id}`, SK: `ENV#${env.timestamp}` },
        env,
        { device_id: env.device_id, timestamp: env.timestamp },
      );
    },
    async saveBiometric(biometric) {
      const bio = normalizeFitbitInput(biometric);
      return putTypedItem(
        'biometric',
        { PK: `USER#${bio.user_id}`, SK: `BIO#${bio.date}` },
        bio,
        { user_id: bio.user_id, date: bio.date },
      );
    },
    async getLatestEnvironment(deviceId = DEFAULT_DEVICE_ID) {
      return queryLatest(`DEVICE#${deviceId}`, 'ENV#');
    },
    async getLatestBiometric(userId = DEFAULT_USER_ID) {
      return queryLatest(`USER#${userId}`, 'BIO#');
    },
    async saveGuide({ userId, date, report, sources }) {
      return putTypedItem(
        'guide',
        { PK: `USER#${userId}`, SK: `GUIDE#${date}` },
        report,
        { user_id: userId, date, sources },
      );
    },
    async getGuide(userId = DEFAULT_USER_ID, date = kstDate()) {
      return getItem(`USER#${userId}`, `GUIDE#${date}`);
    },
  };
}

function httpResponse(statusCode, body) {
  return {
    statusCode,
    headers: corsHeaders,
    body: JSON.stringify(body),
  };
}

function parseJsonBody(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  return JSON.parse(raw);
}

function getHttpRoute(event) {
  const method = event.requestContext?.http?.method || event.httpMethod;
  const path = event.rawPath || event.path || '/';
  return { method: String(method || '').toUpperCase(), path };
}

function isHttpEvent(event) {
  return Boolean(event?.requestContext?.http || event?.httpMethod || event?.rawPath);
}

function isLikelyEnvironmentEvent(event) {
  return Boolean(event && typeof event === 'object' && !isHttpEvent(event) && (event.device_id || event.deviceId || event.pm25 || event.co2));
}

async function handleHttp(event, db) {
  const { method, path } = getHttpRoute(event);
  if (method === 'OPTIONS') return httpResponse(204, {});

  if (method === 'GET' && path === '/health') {
    return httpResponse(200, {
      ok: true,
      service: SERVICE_NAME,
      tableName: db.tableName,
      defaults: { userId: DEFAULT_USER_ID, deviceId: DEFAULT_DEVICE_ID },
      timestamp: new Date().toISOString(),
    });
  }

  if (method === 'POST' && path === '/measurements/environment') {
    const body = parseJsonBody(event);
    const item = await db.saveEnvironment(body);
    return httpResponse(201, { ok: true, item });
  }

  if (method === 'POST' && path === '/biometrics/fitbit') {
    const body = parseJsonBody(event);
    const item = await db.saveBiometric(body);
    return httpResponse(201, { ok: true, item });
  }

  if (method === 'POST' && path === '/guides/generate') {
    const body = parseJsonBody(event);
    const userId = body.user_id || body.userId || DEFAULT_USER_ID;
    const deviceId = body.device_id || body.deviceId || DEFAULT_DEVICE_ID;
    const date = body.date || kstDate();
    const environmentRecord = await db.getLatestEnvironment(deviceId);
    const biometricRecord = await db.getLatestBiometric(userId);
    const outdoor = body.outdoor || null;
    const report = generateGuide({
      userId,
      biometric: biometricRecord?.data ?? null,
      environment: environmentRecord?.data ?? null,
      outdoor,
      timestamp: new Date().toISOString(),
    });
    const item = await db.saveGuide({
      userId,
      date,
      report,
      sources: {
        device_id: deviceId,
        environment_sk: environmentRecord?.SK ?? null,
        biometric_sk: biometricRecord?.SK ?? null,
      },
    });
    return httpResponse(201, { ok: true, report, item });
  }

  if (method === 'GET' && path === '/guides/today') {
    const params = event.queryStringParameters || {};
    const userId = params.userId || params.user_id || DEFAULT_USER_ID;
    const date = params.date || kstDate();
    const item = await db.getGuide(userId, date);
    if (!item) return httpResponse(404, { error: 'not_found', userId, date });
    return httpResponse(200, { ok: true, item });
  }

  return httpResponse(404, { error: 'not_found', method, path });
}

function createHandler({ db = createDynamoStore() } = {}) {
  return async function handler(event) {
    try {
      if (isHttpEvent(event)) return await handleHttp(event, db);
      if (isLikelyEnvironmentEvent(event)) {
        const item = await db.saveEnvironment(event);
        console.log('iot_environment_saved', JSON.stringify({ PK: item.PK, SK: item.SK, device_id: item.device_id }));
        return { ok: true, source: 'iot-rule', item };
      }
      console.warn('unsupported_event', JSON.stringify(event));
      return { ok: false, error: 'unsupported_event' };
    } catch (err) {
      console.error('handler_error', err);
      if (isHttpEvent(event)) return httpResponse(500, { error: err.message || 'internal_error' });
      throw err;
    }
  };
}

export {
  computeHealthWeight,
  createDynamoStore,
  createHandler,
  generateGuide,
  kstDate,
  marshallItem,
  normalizeBiometric,
  normalizeEnvironment,
  normalizeFitbitInput,
  unmarshallItem,
};

export const handler = createHandler();
