import crypto from 'node:crypto';
import axios from 'axios';
import config from '../config/index.js';
import store from '../store/memory.js';
import { mockNightlyBiometric } from '../mocks/fitbit.mock.js';

const http = axios.create({
  baseURL: config.fitbit.apiBase,
  timeout: 8000,
});

http.interceptors.request.use((req) => {
  const userId = req.headers['x-user-id'] || config.defaults.userId;
  const tok = store.getFitbitToken(userId);
  if (tok?.accessToken) req.headers.Authorization = `Bearer ${tok.accessToken}`;
  delete req.headers['x-user-id'];
  return req;
});

// --- OAuth 2.0 Authorization Code Flow (껍데기만, 실제 호출은 키가 있어야 동작) ---

export function buildAuthorizeUrl(state = crypto.randomBytes(8).toString('hex')) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.fitbit.clientId,
    redirect_uri: config.fitbit.redirectUri,
    scope: config.fitbit.scopes.join(' '),
    state,
  });
  return { url: `${config.fitbit.authorizeUrl}?${params}`, state };
}

export async function exchangeCodeForToken(code, userId = config.defaults.userId) {
  if (!config.fitbit.clientId || !config.fitbit.clientSecret) {
    throw new Error('Fitbit client credentials 미설정 (.env 확인)');
  }
  const basic = Buffer.from(
    `${config.fitbit.clientId}:${config.fitbit.clientSecret}`,
  ).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.fitbit.redirectUri,
  });
  const { data } = await axios.post(config.fitbit.tokenUrl, body, {
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 8000,
  });
  const token = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in ?? 28800) * 1000,
    scope: data.scope,
  };
  store.saveFitbitToken(userId, token);
  return token;
}

async function refreshIfNeeded(userId) {
  const tok = store.getFitbitToken(userId);
  if (!tok || !tok.refreshToken) return tok;
  if (tok.expiresAt && tok.expiresAt - Date.now() > 60_000) return tok;
  const basic = Buffer.from(
    `${config.fitbit.clientId}:${config.fitbit.clientSecret}`,
  ).toString('base64');
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tok.refreshToken });
  const { data } = await axios.post(config.fitbit.tokenUrl, body, {
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 8000,
  });
  const next = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? tok.refreshToken,
    expiresAt: Date.now() + (data.expires_in ?? 28800) * 1000,
    scope: data.scope ?? tok.scope,
  };
  store.saveFitbitToken(userId, next);
  return next;
}

// --- 야간 집계 조회 (실제 Fitbit API는 여러 엔드포인트 호출을 집계해야 하므로
//     현재는 Mock 경로가 주 경로. 실제 연동 시 이 함수 내부만 교체) ---

/**
 * 지정 사용자의 야간 생체 집계를 반환.
 * USE_MOCK_FITBIT=true → mock 반환.
 * false → Fitbit Web API 호출 (토큰 필요).
 */
export async function fetchNightlyBiometric({ userId = config.defaults.userId, scenario = 'random' } = {}) {
  if (config.mock.fitbit) {
    const mock = mockNightlyBiometric({ userId, scenario });
    store.saveBiometric(userId, mock);
    return mock;
  }

  await refreshIfNeeded(userId);
  const today = new Date().toISOString().slice(0, 10);
  // 실제 구현 시: /1.2/user/-/sleep/date/{date}.json,
  //              /1/user/-/spo2/date/{date}.json,
  //              /1/user/-/br/date/{date}.json 등을 병렬 호출 후 집계.
  const [sleep, spo2, br] = await Promise.all([
    http.get(`/1.2/user/-/sleep/date/${today}.json`, { headers: { 'x-user-id': userId } }).then((r) => r.data).catch(() => null),
    http.get(`/1/user/-/spo2/date/${today}.json`, { headers: { 'x-user-id': userId } }).then((r) => r.data).catch(() => null),
    http.get(`/1/user/-/br/date/${today}.json`, { headers: { 'x-user-id': userId } }).then((r) => r.data).catch(() => null),
  ]);

  const aggregated = {
    user_id: userId,
    timestamp: new Date().toISOString(),
    source: 'fitbit',
    sleep_duration_min: sleep?.summary?.totalMinutesAsleep,
    avg_spo2: spo2?.value?.avg,
    min_spo2: spo2?.value?.min,
    avg_respiratory_rate: br?.br?.[0]?.value?.breathingRate,
    raw: { sleep, spo2, br },
  };
  store.saveBiometric(userId, aggregated);
  return aggregated;
}
