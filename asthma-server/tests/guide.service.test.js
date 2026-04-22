import test from 'node:test';
import assert from 'node:assert/strict';
import { computeHealthWeight, generateGuide } from '../src/services/guide.service.js';

test('computeHealthWeight: 건강한 상태 → 0', () => {
  const { weight, reasons } = computeHealthWeight({
    avg_spo2: 98,
    avg_respiratory_rate: 15,
    sleep_duration_min: 420,
    hrv: 45,
  });
  assert.equal(weight, 0);
  assert.deepEqual(reasons, []);
});

test('computeHealthWeight: 심각한 저산소 + 빠른 호흡 → 높은 weight', () => {
  const { weight, reasons } = computeHealthWeight({
    avg_spo2: 90,
    avg_respiratory_rate: 24,
    sleep_duration_min: 300,
    hrv: 15,
  });
  assert.ok(weight >= 0.5, `weight=${weight}`);
  assert.ok(reasons.length >= 3);
});

test('computeHealthWeight: 데이터 없으면 weight=0, no_biometric_data 사유', () => {
  const { weight, reasons } = computeHealthWeight(null);
  assert.equal(weight, 0);
  assert.deepEqual(reasons, ['no_biometric_data']);
});

test('generateGuide: 실내 좋음 → maintain', () => {
  const report = generateGuide({
    biometric: { avg_spo2: 98, avg_respiratory_rate: 15, sleep_duration_min: 450 },
    environment: { pm25: 8, pm10: 15, co2: 600, voc: 0.1, temperature: 22, humidity: 50 },
    outdoor: { pm25: 10, pm10: 20 },
    userId: 'u1',
  });
  assert.equal(report.status_summary.overall, 'good');
  assert.equal(report.environment_action.primary, 'maintain');
});

test('generateGuide: 실내 CO2 높고 실외 좋음 → ventilate', () => {
  const report = generateGuide({
    biometric: { avg_spo2: 97, avg_respiratory_rate: 16, sleep_duration_min: 420 },
    environment: { pm25: 10, pm10: 20, co2: 1300, voc: 0.1, temperature: 22, humidity: 50 },
    outdoor: { pm25: 10, pm10: 20 },
  });
  assert.equal(report.environment_action.primary, 'ventilate');
});

test('generateGuide: 실내 CO2 높고 실외 나쁨 → air_purifier', () => {
  const report = generateGuide({
    biometric: { avg_spo2: 97, avg_respiratory_rate: 16, sleep_duration_min: 420 },
    environment: { pm25: 10, pm10: 20, co2: 1300, voc: 0.1, temperature: 22, humidity: 50 },
    outdoor: { pm25: 60, pm10: 120 },
  });
  assert.equal(report.environment_action.primary, 'air_purifier');
});

test('generateGuide: 실내 미세먼지 나쁨 + 실외 나쁨 → air_purifier (창문 X)', () => {
  const report = generateGuide({
    biometric: { avg_spo2: 97, avg_respiratory_rate: 16, sleep_duration_min: 420 },
    environment: { pm25: 45, pm10: 90, co2: 700, voc: 0.2, temperature: 22, humidity: 50 },
    outdoor: { pm25: 60, pm10: 120 },
  });
  assert.equal(report.environment_action.primary, 'air_purifier');
  assert.ok(report.environment_action.suggestions.some((s) => s.includes('공기청정기')));
});

test('generateGuide: 민감한 사용자는 임계치가 엄격해진다', () => {
  const sensitive = generateGuide({
    biometric: { avg_spo2: 88, avg_respiratory_rate: 25, sleep_duration_min: 300 },
    environment: { pm25: 22, pm10: 40, co2: 900, voc: 0.2, temperature: 22, humidity: 50 },
    outdoor: { pm25: 10, pm10: 20 },
  });
  const normal = generateGuide({
    biometric: { avg_spo2: 98, avg_respiratory_rate: 15, sleep_duration_min: 450 },
    environment: { pm25: 22, pm10: 40, co2: 900, voc: 0.2, temperature: 22, humidity: 50 },
    outdoor: { pm25: 10, pm10: 20 },
  });
  // 동일 환경에서 민감 사용자의 overall이 최소 같거나 더 나쁨
  const severity = { good: 0, warning: 1, danger: 2 };
  assert.ok(
    severity[sensitive.status_summary.overall] >= severity[normal.status_summary.overall],
    `sensitive=${sensitive.status_summary.overall}, normal=${normal.status_summary.overall}`,
  );
  assert.ok(sensitive.health_analysis.weight > normal.health_analysis.weight);
});
