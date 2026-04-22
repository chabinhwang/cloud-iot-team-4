// Fitbit 야간 집계 Mock. 천식 이상 케이스 포함 (낮은 SpO2, 높은 호흡수).

export function mockNightlyBiometric({ userId = 'user_001', scenario = 'random' } = {}) {
  const scenarios = {
    healthy: {
      avg_spo2: 97,
      min_spo2: 95,
      avg_respiratory_rate: 15,
      max_respiratory_rate: 17,
      sleep_duration_min: 430,
      resting_hr: 68,
      hrv: 45,
    },
    mild: {
      avg_spo2: 94,
      min_spo2: 92,
      avg_respiratory_rate: 19,
      max_respiratory_rate: 22,
      sleep_duration_min: 380,
      resting_hr: 74,
      hrv: 28,
    },
    severe: {
      avg_spo2: 90,
      min_spo2: 86,
      avg_respiratory_rate: 24,
      max_respiratory_rate: 28,
      sleep_duration_min: 290,
      resting_hr: 82,
      hrv: 15,
    },
  };

  let pick = scenario;
  if (scenario === 'random') {
    const keys = Object.keys(scenarios);
    pick = keys[Math.floor(Math.random() * keys.length)];
  }
  const base = scenarios[pick] || scenarios.healthy;

  return {
    user_id: userId,
    timestamp: new Date().toISOString(),
    source: 'mock',
    scenario: pick,
    ...base,
  };
}
