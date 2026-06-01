import crypto from 'node:crypto';

const DEFAULT_TABLE_NAME = 'AsthmaGuideData';
const DEFAULT_USER_ID = process.env.DEFAULT_USER_ID || 'user_001';
const DEFAULT_DEVICE_ID = process.env.DEFAULT_DEVICE_ID || 'rpi_001';
const TABLE_NAME = process.env.TABLE_NAME || DEFAULT_TABLE_NAME;
const SERVICE_NAME = 'cloud-iot-team4-asthma-guide';

const FITBIT_AUTHORIZE_URL = 'https://www.fitbit.com/oauth2/authorize';
const FITBIT_TOKEN_URL = 'https://api.fitbit.com/oauth2/token';
const FITBIT_API_BASE = 'https://api.fitbit.com';
const FITBIT_CLIENT_ID = process.env.FITBIT_CLIENT_ID || '';
const FITBIT_CLIENT_SECRET = process.env.FITBIT_CLIENT_SECRET || '';
const FITBIT_REDIRECT_URI = process.env.FITBIT_REDIRECT_URI || '';
const FITBIT_SCOPES = (process.env.FITBIT_SCOPES || 'sleep heartrate oxygen_saturation respiratory_rate profile')
  .split(/[\s,]+/)
  .filter(Boolean);
const FITBIT_STATE_SECRET = process.env.FITBIT_STATE_SECRET || FITBIT_CLIENT_SECRET || 'single-user-demo-state';
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';
const USE_MOCK_DISCORD = String(process.env.USE_MOCK_DISCORD ?? 'true').toLowerCase() !== 'false';

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
    source: input.source || 'fitbit',
    fitbit_user_id: input.fitbit_user_id || input.fitbitUserId,
    sleep_minutes: num(input.sleep_minutes ?? input.sleepMinutes ?? input.sleep_duration_min),
    sleepMinutes: num(input.sleepMinutes ?? input.sleep_minutes ?? input.sleep_duration_min),
    sleep_efficiency: num(input.sleep_efficiency ?? input.sleepEfficiency),
    avg_spo2: num(input.avg_spo2 ?? input.spo2?.avg ?? input.spo2),
    spo2: num(input.spo2?.avg ?? input.spo2 ?? input.avg_spo2),
    min_spo2: num(input.min_spo2 ?? input.spo2?.min ?? input.minSpo2),
    max_spo2: num(input.max_spo2 ?? input.spo2?.max ?? input.maxSpo2),
    respiratory_rate: num(input.respiratory_rate ?? input.respiratoryRate ?? input.avg_respiratory_rate),
    respiratoryRate: num(input.respiratoryRate ?? input.respiratory_rate ?? input.avg_respiratory_rate),
    resting_hr: num(input.resting_hr ?? input.restingHr),
    hrv: num(input.hrv ?? input.heart_rate_variability),
    api_status: input.api_status || input.apiStatus,
    synced_at: input.synced_at || input.syncedAt || new Date().toISOString(),
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
    async saveFitbitToken(token) {
      const userId = token.user_id || DEFAULT_USER_ID;
      return putTypedItem(
        'fitbit_token',
        { PK: `USER#${userId}`, SK: 'FITBIT_TOKEN' },
        { ...token, user_id: userId },
        { user_id: userId, fitbit_user_id: token.fitbit_user_id ?? null },
      );
    },
    async getFitbitToken(userId = DEFAULT_USER_ID) {
      return getItem(`USER#${userId}`, 'FITBIT_TOKEN');
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

function base64Url(value) {
  return Buffer.from(value).toString('base64url');
}

function signFitbitState(encodedPayload) {
  return crypto.createHmac('sha256', FITBIT_STATE_SECRET).update(encodedPayload).digest('base64url');
}

function buildFitbitState(userId = DEFAULT_USER_ID) {
  const payload = base64Url(JSON.stringify({ userId, issuedAt: Date.now() }));
  return `${payload}.${signFitbitState(payload)}`;
}

function parseFitbitState(state) {
  if (!state) return { userId: DEFAULT_USER_ID };
  const [payload, signature] = String(state).split('.');
  if (!payload || !signature) throw new Error('invalid_fitbit_state');

  const expected = signFitbitState(payload);
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== receivedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)) {
    throw new Error('invalid_fitbit_state');
  }

  const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  const issuedAt = Number(parsed.issuedAt || 0);
  const oneHourMs = 60 * 60 * 1000;
  if (!issuedAt || Date.now() - issuedAt > oneHourMs) throw new Error('expired_fitbit_state');
  return { userId: parsed.userId || DEFAULT_USER_ID };
}

function getMissingFitbitConfig({ requireSecret = true } = {}) {
  return [
    ['FITBIT_CLIENT_ID', FITBIT_CLIENT_ID],
    ['FITBIT_REDIRECT_URI', FITBIT_REDIRECT_URI],
    ...(requireSecret ? [['FITBIT_CLIENT_SECRET', FITBIT_CLIENT_SECRET]] : []),
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key);
}

function buildFitbitAuthorizeUrl({ userId = DEFAULT_USER_ID } = {}) {
  const missing = getMissingFitbitConfig({ requireSecret: false });
  if (missing.length) throw new Error(`missing_fitbit_config:${missing.join(',')}`);

  const state = buildFitbitState(userId);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: FITBIT_CLIENT_ID,
    redirect_uri: FITBIT_REDIRECT_URI,
    scope: FITBIT_SCOPES.join(' '),
    state,
  });
  return {
    authorizeUrl: `${FITBIT_AUTHORIZE_URL}?${params.toString()}`,
    state,
  };
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function fitbitTokenRequest(params) {
  const missing = getMissingFitbitConfig({ requireSecret: true });
  if (missing.length) throw new Error(`missing_fitbit_config:${missing.join(',')}`);

  const basic = Buffer.from(`${FITBIT_CLIENT_ID}:${FITBIT_CLIENT_SECRET}`).toString('base64');
  const response = await fetch(FITBIT_TOKEN_URL, {
    method: 'POST',
    headers: {
      authorization: `Basic ${basic}`,
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: new URLSearchParams(params).toString(),
  });
  const data = await readJsonResponse(response);
  if (!response.ok) throw new Error(`fitbit_token_request_failed:${response.status}:${JSON.stringify(data)}`);
  return data;
}

function tokenRecordFromFitbit(data, userId, previous = {}) {
  const expiresIn = Number(data.expires_in || previous.expires_in || 28_800);
  const expiresAt = new Date(Date.now() + Math.max(60, expiresIn - 60) * 1000).toISOString();
  return {
    user_id: userId || DEFAULT_USER_ID,
    fitbit_user_id: data.user_id || data.encoded_user_id || previous.fitbit_user_id,
    access_token: data.access_token || previous.access_token,
    refresh_token: data.refresh_token || previous.refresh_token,
    token_type: data.token_type || previous.token_type || 'Bearer',
    scope: data.scope || previous.scope || FITBIT_SCOPES.join(' '),
    expires_in: expiresIn,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  };
}

async function exchangeFitbitCodeForToken(db, { code, state }) {
  if (!code) throw new Error('missing_fitbit_code');
  const { userId } = parseFitbitState(state);
  const data = await fitbitTokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: FITBIT_REDIRECT_URI,
  });
  const token = tokenRecordFromFitbit(data, userId);
  await db.saveFitbitToken(token);
  return {
    userId,
    fitbitUserId: token.fitbit_user_id || null,
    expiresAt: token.expires_at,
    scope: token.scope,
  };
}

async function getUsableFitbitToken(db, userId = DEFAULT_USER_ID) {
  const record = await db.getFitbitToken(userId);
  const current = record?.data;
  if (!current?.access_token) throw new Error('fitbit_not_connected');

  const expiresAt = Date.parse(current.expires_at || 0);
  const shouldRefresh = !expiresAt || expiresAt <= Date.now() + 5 * 60 * 1000;
  if (!shouldRefresh) return current;
  if (!current.refresh_token) throw new Error('fitbit_refresh_token_missing');

  const data = await fitbitTokenRequest({
    grant_type: 'refresh_token',
    refresh_token: current.refresh_token,
  });
  const refreshed = tokenRecordFromFitbit(data, userId, current);
  await db.saveFitbitToken(refreshed);
  return refreshed;
}

async function fitbitGet(path, accessToken) {
  const response = await fetch(`${FITBIT_API_BASE}${path}`, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: 'application/json',
    },
  });
  const data = await readJsonResponse(response);
  return response.ok
    ? { ok: true, status: response.status, data }
    : { ok: false, status: response.status, error: data };
}

function firstNumber(...values) {
  for (const value of values) {
    const parsed = num(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function buildFitbitBiometric({ userId = DEFAULT_USER_ID, date = kstDate(), token, responses }) {
  const sleepData = responses.sleep?.data || {};
  const sleepItems = Array.isArray(sleepData.sleep) ? sleepData.sleep : [];
  const mainSleep = sleepItems.find((item) => item.isMainSleep) || sleepItems[0] || {};
  const spo2Value = responses.spo2?.data?.value || responses.spo2?.data?.[0]?.value || {};
  const brEntry = responses.respiratory?.data?.br?.[0] || responses.respiratory?.data?.breathingRate?.[0] || {};
  const heartEntry = responses.heart?.data?.['activities-heart']?.[0] || {};

  return normalizeFitbitInput({
    user_id: userId,
    date,
    source: 'fitbit_api',
    fitbit_user_id: token.fitbit_user_id,
    sleep_minutes: firstNumber(sleepData.summary?.totalMinutesAsleep, mainSleep.minutesAsleep),
    sleep_efficiency: firstNumber(mainSleep.efficiency),
    avg_spo2: firstNumber(spo2Value.avg, spo2Value.average, responses.spo2?.data?.avg),
    min_spo2: firstNumber(spo2Value.min, responses.spo2?.data?.min),
    max_spo2: firstNumber(spo2Value.max, responses.spo2?.data?.max),
    respiratory_rate: firstNumber(brEntry.value?.breathingRate, brEntry.value, responses.respiratory?.data?.breathingRate),
    resting_hr: firstNumber(heartEntry.value?.restingHeartRate),
    api_status: Object.fromEntries(Object.entries(responses).map(([key, value]) => [key, value.status])),
    synced_at: new Date().toISOString(),
  });
}

async function syncFitbitBiometric(db, { userId = DEFAULT_USER_ID, date = kstDate() } = {}) {
  const token = await getUsableFitbitToken(db, userId);
  const responses = {
    sleep: await fitbitGet(`/1.2/user/-/sleep/date/${date}.json`, token.access_token),
    spo2: await fitbitGet(`/1/user/-/spo2/date/${date}.json`, token.access_token),
    respiratory: await fitbitGet(`/1/user/-/br/date/${date}.json`, token.access_token),
    heart: await fitbitGet(`/1/user/-/activities/heart/date/${date}/1d.json`, token.access_token),
  };
  const authError = Object.entries(responses).find(([, response]) => [401, 403].includes(response.status));
  if (authError) throw new Error(`fitbit_api_authorization_failed:${authError[0]}:${authError[1].status}`);

  const biometric = buildFitbitBiometric({ userId, date, token, responses });
  const item = await db.saveBiometric(biometric);
  return { item, biometric, apiStatus: biometric.api_status };
}

function statusEmoji(status) {
  if (status === 'danger') return '🔴';
  if (status === 'warning') return '🟡';
  return '🟢';
}

function formatEnvironmentForDiscord(report) {
  const metrics = report.status_summary?.perMetric || {};
  const entries = Object.entries(metrics).map(([key, metric]) => {
    const value = metric.value === undefined ? '-' : `${metric.value}${metric.unit || ''}`;
    return `${statusEmoji(metric.status)} ${key}: ${value}`;
  });
  return entries.length ? entries.join('\n') : '환경 데이터 없음';
}

function formatBiometricForDiscord(report) {
  const biometric = report.health_analysis?.biometric || {};
  const lines = [];
  if (Number.isFinite(biometric.sleep_minutes)) lines.push(`수면 ${biometric.sleep_minutes}분`);
  if (Number.isFinite(biometric.avg_spo2)) lines.push(`SpO₂ ${biometric.avg_spo2}%`);
  if (Number.isFinite(biometric.respiratory_rate)) lines.push(`호흡수 ${biometric.respiratory_rate}/분`);
  if (Number.isFinite(biometric.resting_hr)) lines.push(`안정시 심박 ${biometric.resting_hr}bpm`);
  return lines.length ? lines.join('\n') : 'Fitbit 데이터 없음';
}

function buildDiscordPayload(report) {
  const overall = report.status_summary?.overall || 'good';
  const color = overall === 'danger' ? 0xff4d4f : overall === 'warning' ? 0xfaad14 : 0x52c41a;
  return {
    content: `${statusEmoji(overall)} ${report.environment_action?.message || '천식 공간 가이드가 생성되었습니다.'}`,
    embeds: [
      {
        title: `천식 공간 가이드 - ${overall.toUpperCase()}`,
        description: report.environment_action?.suggestions?.map((item) => `• ${item}`).join('\n') || '',
        color,
        fields: [
          { name: '환경 상태', value: formatEnvironmentForDiscord(report), inline: true },
          { name: 'Fitbit 상태', value: formatBiometricForDiscord(report), inline: true },
          { name: '건강 가중치', value: `${report.health_analysis?.level || 'low'} (${report.health_analysis?.weight ?? 0})`, inline: false },
        ],
        timestamp: report.generatedAt,
      },
    ],
  };
}

async function sendDiscordReport(report) {
  const payload = buildDiscordPayload(report);
  if (USE_MOCK_DISCORD || !DISCORD_WEBHOOK_URL) {
    return {
      ok: true,
      mock: true,
      reason: USE_MOCK_DISCORD ? 'USE_MOCK_DISCORD=true' : 'DISCORD_WEBHOOK_URL is empty',
      payload,
    };
  }

  const response = await fetch(DISCORD_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`discord_webhook_failed:${response.status}:${text.slice(0, 160)}`);
  return { ok: true, mock: false, status: response.status };
}

async function createGuideFromStoredData(db, { userId = DEFAULT_USER_ID, deviceId = DEFAULT_DEVICE_ID, date = kstDate(), outdoor = null } = {}) {
  const environmentRecord = await db.getLatestEnvironment(deviceId);
  const biometricRecord = await db.getLatestBiometric(userId);
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
  return { report, item };
}

function statusForError(err) {
  const message = err?.message || '';
  if (
    message.startsWith('missing_fitbit_config') ||
    ['missing_fitbit_code', 'invalid_fitbit_state', 'expired_fitbit_state'].includes(message)
  ) {
    return 400;
  }
  if (message === 'fitbit_not_connected' || message === 'fitbit_refresh_token_missing') return 409;
  if (message.startsWith('fitbit_') || message.startsWith('discord_webhook_failed')) return 502;
  return 500;
}

function buildGoogleHealthPlannedResponse({ userId = DEFAULT_USER_ID, date = kstDate() } = {}) {
  return {
    ok: true,
    provider: 'google-health-api',
    mode: 'planned-only',
    userId,
    date,
    message:
      'Google Health API is the future Fitbit data path. This demo endpoint documents the route; it does not call Google Cloud yet.',
    plannedFlow: [
      'Google Cloud project + Google Health API enablement',
      'Google OAuth consent for health data scopes',
      'Lambda stores refresh token securely',
      'Lambda reads Google Health/Fitbit data and saves BIO item',
      'Guide generation combines BIO item with latest Raspberry Pi ENV item',
    ],
    manualFallback: 'POST /biometrics/fitbit/notify',
  };
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
      fitbit: {
        manualNotifyRoute: 'POST /biometrics/fitbit/notify',
        legacyConnectedRoute: '/auth/fitbit/login',
        googleHealthPlannedRoute: 'POST /google-health/fitbit/sync',
        scopes: FITBIT_SCOPES,
        callbackUrl: FITBIT_REDIRECT_URI || null,
      },
      timestamp: new Date().toISOString(),
    });
  }

  if (method === 'GET' && path === '/auth/fitbit/login') {
    const params = event.queryStringParameters || {};
    const userId = params.userId || params.user_id || DEFAULT_USER_ID;
    const { authorizeUrl, state } = buildFitbitAuthorizeUrl({ userId });
    const body = { ok: true, userId, authorizeUrl, state, callbackUrl: FITBIT_REDIRECT_URI, scopes: FITBIT_SCOPES };
    if (params.format === 'json' || params.json === '1') return httpResponse(200, body);
    return {
      statusCode: 302,
      headers: { ...corsHeaders, location: authorizeUrl },
      body: '',
    };
  }

  if (method === 'GET' && path === '/auth/fitbit/callback') {
    const params = event.queryStringParameters || {};
    if (params.error) {
      return httpResponse(400, { error: 'fitbit_authorization_failed', details: params.error_description || params.error });
    }
    const linked = await exchangeFitbitCodeForToken(db, { code: params.code, state: params.state });
    return httpResponse(200, {
      ok: true,
      message: 'Fitbit 계정 연결 완료. 이제 POST /fitbit/sync 또는 POST /guides/notify를 호출할 수 있습니다.',
      linked,
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

  if (method === 'POST' && path === '/biometrics/fitbit/notify') {
    const body = parseJsonBody(event);
    const biometric = await db.saveBiometric({ ...body, source: body.source || 'manual_fitbit_api' });
    const userId = biometric.user_id || biometric.data?.user_id || body.user_id || body.userId || DEFAULT_USER_ID;
    const deviceId = body.device_id || body.deviceId || DEFAULT_DEVICE_ID;
    const date = biometric.date || biometric.data?.date || body.date || kstDate();
    const { report, item } = await createGuideFromStoredData(db, {
      userId,
      deviceId,
      date,
      outdoor: body.outdoor || null,
    });
    const delivery = await sendDiscordReport(report);
    return httpResponse(201, {
      ok: true,
      mode: 'manual-fitbit-notify',
      userId,
      deviceId,
      date,
      biometric,
      report,
      item,
      delivery,
    });
  }

  if (method === 'POST' && path === '/google-health/fitbit/sync') {
    const body = parseJsonBody(event);
    const userId = body.user_id || body.userId || DEFAULT_USER_ID;
    const date = body.date || kstDate();
    return httpResponse(200, buildGoogleHealthPlannedResponse({ userId, date }));
  }

  if (method === 'POST' && path === '/fitbit/sync') {
    const body = parseJsonBody(event);
    const userId = body.user_id || body.userId || DEFAULT_USER_ID;
    const date = body.date || kstDate();
    const result = await syncFitbitBiometric(db, { userId, date });
    return httpResponse(201, { ok: true, userId, date, ...result });
  }

  if (method === 'POST' && path === '/guides/generate') {
    const body = parseJsonBody(event);
    const userId = body.user_id || body.userId || DEFAULT_USER_ID;
    const deviceId = body.device_id || body.deviceId || DEFAULT_DEVICE_ID;
    const date = body.date || kstDate();
    const { report, item } = await createGuideFromStoredData(db, { userId, deviceId, date, outdoor: body.outdoor || null });
    return httpResponse(201, { ok: true, report, item });
  }

  if (method === 'POST' && path === '/guides/notify') {
    const body = parseJsonBody(event);
    const userId = body.user_id || body.userId || DEFAULT_USER_ID;
    const deviceId = body.device_id || body.deviceId || DEFAULT_DEVICE_ID;
    const date = body.date || kstDate();
    let fitbitSync = null;
    if (body.sync_fitbit || body.syncFitbit) {
      fitbitSync = await syncFitbitBiometric(db, { userId, date });
    }
    const { report, item } = await createGuideFromStoredData(db, { userId, deviceId, date, outdoor: body.outdoor || null });
    const delivery = await sendDiscordReport(report);
    return httpResponse(201, { ok: true, userId, deviceId, date, report, item, delivery, fitbitSync });
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
      if (isHttpEvent(event)) return httpResponse(statusForError(err), { error: err.message || 'internal_error' });
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
