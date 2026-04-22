// 가이드 파이프라인 오케스트레이션 (fitbit + store env + outdoor → guide → discord).
// 여러 진입점(스케줄러, 수동 API)에서 공용 사용. 중복 실행 방지를 위한 간단한 락 포함.

import config from '../config/index.js';
import store from '../store/memory.js';
import { generateGuide } from './guide.service.js';
import { fetchNightlyBiometric } from './fitbit.service.js';
import { fetchOutdoorAirQuality } from './weather.service.js';
import { sendReport } from './discord.service.js';

const inflight = new Set();

export async function runGuidePipeline({
  userId = config.defaults.userId,
  deviceId = config.defaults.deviceId,
  scenario,
  sendToDiscord = true,
} = {}) {
  const key = `${userId}:${deviceId}`;
  if (inflight.has(key)) {
    return { ok: false, skipped: true, reason: 'already_in_flight', key };
  }
  inflight.add(key);
  try {
    const biometric = await fetchNightlyBiometric({ userId, scenario });
    const envRecord = store.getLatestEnvironment(deviceId);
    const outdoor = await fetchOutdoorAirQuality();

    const report = generateGuide({
      userId,
      biometric,
      environment: envRecord?.data ?? null,
      outdoor,
      timestamp: new Date().toISOString(),
    });

    let delivery = null;
    if (sendToDiscord) delivery = await sendReport(report);

    return { ok: true, report, delivery, envSourceReceivedAt: envRecord?.receivedAt ?? null };
  } finally {
    inflight.delete(key);
  }
}
