// 주기적으로 가짜 RPi 환경 센서 데이터를 MQTT publish.
// 실제 RPi 연결 시에는 USE_MOCK_SENSOR=false로 끄면 됨 (코드 변경 불필요).

import mqtt from 'mqtt';
import config from '../config/index.js';

let client = null;
let timer = null;

function jitter(base, spread) {
  return Math.round((base + (Math.random() - 0.5) * spread) * 100) / 100;
}

function randomEnvironment() {
  // 20% 확률로 "나쁜" 상태 생성 → 전체 파이프라인 분기 검증 용이
  const bad = Math.random() < 0.2;
  return {
    device_id: config.defaults.deviceId,
    timestamp: new Date().toISOString(),
    pm25: bad ? jitter(45, 10) : jitter(12, 6),
    pm10: bad ? jitter(85, 15) : jitter(25, 8),
    co2: bad ? jitter(1300, 200) : jitter(700, 150),
    voc: bad ? jitter(0.6, 0.2) : jitter(0.15, 0.1),
    temperature: jitter(22, 2),
    humidity: jitter(50, 10),
  };
}

export function startMockSensorPublisher() {
  if (!config.mock.sensor) {
    console.log('[mock-sensor] USE_MOCK_SENSOR=false → Mock Publisher 비활성');
    return null;
  }

  client = mqtt.connect(config.mqtt.url, {
    clientId: `mock-sensor-${Math.random().toString(16).slice(2, 8)}`,
    reconnectPeriod: 2000,
  });

  client.on('connect', () => {
    console.log(`[mock-sensor] connected → ${config.mqtt.url}`);
    const topic = config.mqtt.topics.environment(config.defaults.deviceId);
    console.log(
      `[mock-sensor] publishing every ${config.mock.sensorIntervalMs}ms → ${topic}`,
    );

    const tick = () => {
      const payload = randomEnvironment();
      client.publish(topic, JSON.stringify(payload), { qos: 0 });
    };
    tick();
    timer = setInterval(tick, config.mock.sensorIntervalMs);
  });

  client.on('error', (err) => console.error('[mock-sensor] error:', err.message));

  return client;
}

export async function stopMockSensorPublisher() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (client) {
    await new Promise((res) => client.end(false, {}, () => res()));
    client = null;
  }
}
