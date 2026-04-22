import store from '../store/memory.js';

// 토픽: health/{category}/{id}/{kind}
// 예: health/sensor/rpi_001/environment
//     health/fitbit/user_001/biometric
function parseTopic(topic) {
  const parts = topic.split('/');
  if (parts.length !== 4 || parts[0] !== 'health') return null;
  return { category: parts[1], id: parts[2], kind: parts[3] };
}

export function handleMessage(topic, payloadBuf) {
  const parsed = parseTopic(topic);
  if (!parsed) {
    console.warn(`[mqtt-handler] 토픽 스키마 위반: ${topic}`);
    return;
  }

  let payload;
  try {
    payload = JSON.parse(payloadBuf.toString('utf8'));
  } catch (err) {
    console.warn(`[mqtt-handler] JSON 파싱 실패 (${topic}):`, err.message);
    return;
  }

  const { category, id, kind } = parsed;

  if (category === 'sensor' && kind === 'environment') {
    store.saveEnvironment(id, payload);
    return;
  }

  if (category === 'fitbit' && kind === 'biometric') {
    const userId = payload.user_id || id;
    store.saveBiometric(userId, payload);
    return;
  }

  // system/status 등은 현재 로그만
  console.log(`[mqtt-handler] 미처리 토픽 수신: ${topic}`);
}
