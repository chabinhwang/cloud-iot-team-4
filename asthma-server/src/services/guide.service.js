// Guide Service — 순수 함수.
// 입력(야간 생체, 아침 환경, 실외 공기질) → health_weight 산출 → 동적 임계치 → 가이드 결정.
// MQTT/HTTP 의존 없음. 단위 테스트와 추후 Lambda 이식을 위해 격리.

import config from '../config/index.js';

/**
 * 야간 Fitbit 데이터를 기반으로 사용자의 건강 민감도(0~1) 산출.
 * 값이 클수록 "오늘 컨디션이 더 민감하다" → 임계치를 더 엄격하게 적용.
 *
 * @param {object} biometric fitbit 야간 집계
 * @returns {{ weight: number, reasons: string[] }}
 */
export function computeHealthWeight(biometric) {
  const reasons = [];
  let w = 0;

  if (!biometric) {
    return { weight: 0, reasons: ['no_biometric_data'] };
  }

  const { spo2, respiratoryRate, sleepMinutes, hrv } = normalizeBiometric(biometric);
  const rc = config.biometricRisk;

  if (Number.isFinite(spo2)) {
    if (spo2 < rc.spo2.severe) {
      w += 0.35;
      reasons.push(`SpO2 ${spo2}% (심각: <${rc.spo2.severe})`);
    } else if (spo2 < rc.spo2.mild) {
      w += 0.15;
      reasons.push(`SpO2 ${spo2}% (주의: <${rc.spo2.mild})`);
    }
  }

  if (Number.isFinite(respiratoryRate)) {
    if (respiratoryRate > rc.respiratoryRate.severe) {
      w += 0.25;
      reasons.push(`호흡수 ${respiratoryRate}회/분 (심각: >${rc.respiratoryRate.severe})`);
    } else if (respiratoryRate > rc.respiratoryRate.mild) {
      w += 0.1;
      reasons.push(`호흡수 ${respiratoryRate}회/분 (주의: >${rc.respiratoryRate.mild})`);
    }
  }

  if (Number.isFinite(sleepMinutes) && sleepMinutes < rc.sleepMinutes.low) {
    w += 0.1;
    reasons.push(`수면 ${sleepMinutes}분 (<${rc.sleepMinutes.low})`);
  }

  if (Number.isFinite(hrv) && hrv < 20) {
    w += 0.1;
    reasons.push(`HRV ${hrv}ms (낮음)`);
  }

  return { weight: Math.min(1, Number(w.toFixed(3))), reasons };
}

function normalizeBiometric(b) {
  return {
    spo2: num(b.avg_spo2 ?? b.spo2?.avg ?? b.spo2),
    respiratoryRate: num(
      b.avg_respiratory_rate ?? b.respiratory_rate?.avg ?? b.respiratoryRate,
    ),
    sleepMinutes: num(b.sleep_duration_min ?? b.sleep?.durationMin ?? b.sleepMinutes),
    hrv: num(b.hrv ?? b.heart_rate_variability),
  };
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * 민감도 가중치로 임계치를 조정. 높은 weight일수록 더 엄격한 임계치.
 * scaleFactor: weight=1일 때 임계치를 최대 50% 더 타이트하게.
 */
function tightenThreshold(base, weight, scaleFactor = 0.5) {
  const scale = 1 - weight * scaleFactor;
  return Math.round(base * scale * 100) / 100;
}

/**
 * 환경 항목별 상태 평가.
 * @returns 'good' | 'warning' | 'danger'
 */
function classifyEnv(value, { good, warning, danger }, weight) {
  const tGood = tightenThreshold(good, weight);
  const tWarn = tightenThreshold(warning, weight);
  const tDanger = tightenThreshold(danger, weight);
  if (value <= tGood) return 'good';
  if (value <= tWarn) return 'warning';
  if (value <= tDanger) return 'danger';
  return 'danger';
}

function classifyRange(value, { lowGood, lowWarn, highGood, highWarn }) {
  if (value >= lowGood && value <= highGood) return 'good';
  if (value >= lowWarn && value <= highWarn) return 'warning';
  return 'danger';
}

const WORST = { good: 0, warning: 1, danger: 2 };
const LABEL = ['good', 'warning', 'danger'];
function worst(a, b) {
  return LABEL[Math.max(WORST[a] ?? 0, WORST[b] ?? 0)];
}

/**
 * 전체 리포트 생성.
 *
 * @param {object} args
 * @param {object} args.biometric - 야간 Fitbit 집계
 * @param {object} args.environment - 아침 실내 환경
 * @param {object} [args.outdoor] - 실외 공기질 (pm25, pm10)
 * @param {string} [args.userId]
 * @param {string} [args.timestamp]
 */
export function generateGuide({ biometric, environment, outdoor, userId, timestamp }) {
  const now = timestamp || new Date().toISOString();
  const { weight, reasons } = computeHealthWeight(biometric);
  const t = config.thresholds;
  const env = environment?.data ?? environment ?? {};

  const perMetric = {};
  let overall = 'good';

  const addMetric = (key, status, value, unit) => {
    perMetric[key] = { status, value, unit };
    overall = worst(overall, status);
  };

  if (Number.isFinite(env.pm25)) {
    addMetric('pm25', classifyEnv(env.pm25, t.pm25, weight), env.pm25, t.pm25.unit);
  }
  if (Number.isFinite(env.pm10)) {
    addMetric('pm10', classifyEnv(env.pm10, t.pm10, weight), env.pm10, t.pm10.unit);
  }
  if (Number.isFinite(env.co2)) {
    addMetric('co2', classifyEnv(env.co2, t.co2, weight), env.co2, t.co2.unit);
  }
  if (Number.isFinite(env.voc)) {
    addMetric('voc', classifyEnv(env.voc, t.voc, weight), env.voc, t.voc.unit);
  }
  if (Number.isFinite(env.temperature)) {
    addMetric(
      'temperature',
      classifyRange(env.temperature, t.temperature),
      env.temperature,
      t.temperature.unit,
    );
  }
  if (Number.isFinite(env.humidity)) {
    addMetric('humidity', classifyRange(env.humidity, t.humidity), env.humidity, t.humidity.unit);
  }

  const outdoorBad =
    (Number.isFinite(outdoor?.pm25) && outdoor.pm25 >= t.outdoorPm25Bad) ||
    (Number.isFinite(outdoor?.pm10) && outdoor.pm10 >= t.outdoorPm10Bad);

  const action = decideAction({ overall, perMetric, outdoorBad, weight });

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
    environment_action: action,
    outdoor: outdoor ?? null,
  };
}

function weightLevel(w) {
  if (w >= 0.5) return 'high';
  if (w >= 0.25) return 'moderate';
  return 'low';
}

function decideAction({ overall, perMetric, outdoorBad, weight }) {
  const suggestions = [];
  let primary = 'none';

  if (overall === 'good') {
    return {
      primary: 'maintain',
      message: '실내 공기 상태 양호. 평소대로 유지하세요.',
      suggestions: [],
    };
  }

  const badAir = ['pm25', 'pm10', 'voc'].some(
    (k) => perMetric[k]?.status === 'warning' || perMetric[k]?.status === 'danger',
  );
  const highCo2 = perMetric.co2?.status === 'warning' || perMetric.co2?.status === 'danger';

  if (highCo2 && !outdoorBad) {
    primary = 'ventilate';
    suggestions.push('창문을 열고 10~15분 환기하세요 (CO₂ 배출).');
  } else if (highCo2 && outdoorBad) {
    primary = 'air_purifier';
    suggestions.push('실외 공기질이 나쁘니 창문은 닫고 공기청정기를 강으로 가동하세요.');
    suggestions.push('환기가 꼭 필요하면 짧게(5분 이내)만 하고 공기청정기로 복구하세요.');
  } else if (badAir && outdoorBad) {
    primary = 'air_purifier';
    suggestions.push('공기청정기를 강으로 가동하고 창문은 닫아주세요.');
  } else if (badAir && !outdoorBad) {
    primary = 'ventilate_and_purify';
    suggestions.push('창문을 열어 환기하며 공기청정기도 함께 가동하세요.');
  }

  if (perMetric.humidity?.status !== 'good') {
    if (perMetric.humidity?.value < config.thresholds.humidity.lowGood) {
      suggestions.push('가습기를 가동해 습도를 40~60%로 맞춰주세요.');
    } else {
      suggestions.push('제습기 가동 또는 환기를 통해 습도를 60% 이하로 낮춰주세요.');
    }
  }

  if (perMetric.temperature?.status !== 'good') {
    suggestions.push('실내 온도를 20~24°C로 조절해주세요.');
  }

  if (weight >= 0.5) {
    suggestions.push('오늘은 생체지표가 민감하므로 외출 시 마스크 착용을 권장합니다.');
  }

  if (primary === 'none' && suggestions.length > 0) {
    primary = 'adjust_environment';
  }

  return {
    primary,
    message: suggestions[0] || '환경 점검이 필요합니다.',
    suggestions,
  };
}

export default { computeHealthWeight, generateGuide };
