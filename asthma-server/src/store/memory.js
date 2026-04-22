// In-Memory 저장소. 동일 인터페이스를 유지하며 추후 SQLite/Redis로 교체 가능.

const environments = new Map(); // deviceId -> { data, receivedAt }
const biometrics = new Map(); // userId -> { data, receivedAt }
const fitbitTokens = new Map(); // userId -> { accessToken, refreshToken, expiresAt, scope }

export const store = {
  saveEnvironment(deviceId, data) {
    environments.set(deviceId, { data, receivedAt: new Date().toISOString() });
  },

  getLatestEnvironment(deviceId) {
    return environments.get(deviceId) ?? null;
  },

  listEnvironments() {
    return Array.from(environments.entries()).map(([deviceId, v]) => ({ deviceId, ...v }));
  },

  saveBiometric(userId, data) {
    biometrics.set(userId, { data, receivedAt: new Date().toISOString() });
  },

  getLatestBiometric(userId) {
    return biometrics.get(userId) ?? null;
  },

  listBiometrics() {
    return Array.from(biometrics.entries()).map(([userId, v]) => ({ userId, ...v }));
  },

  saveFitbitToken(userId, token) {
    fitbitTokens.set(userId, token);
  },

  getFitbitToken(userId) {
    return fitbitTokens.get(userId) ?? null;
  },

  clear() {
    environments.clear();
    biometrics.clear();
    fitbitTokens.clear();
  },
};

export default store;
