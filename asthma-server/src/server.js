import config from './config/index.js';
import { createApp } from './app.js';
import { startBroker, stopBroker } from './mqtt/broker.js';
import { startSubscriber, stopSubscriber } from './mqtt/client.js';
import { startMockSensorPublisher, stopMockSensorPublisher } from './mocks/sensor-publisher.js';
import { startScheduler, stopScheduler } from './scheduler/cron.js';

async function main() {
  // 1) MQTT 브로커 (임베디드)
  await startBroker();

  // 2) 서버 자신의 MQTT Subscriber
  startSubscriber();

  // 3) Mock Sensor Publisher (개발용)
  startMockSensorPublisher();

  // 4) Scheduler (기상 시각 트리거)
  startScheduler();

  // 5) HTTP 서버
  const app = createApp();
  const httpServer = app.listen(config.port, () => {
    console.log(`[http] listening on :${config.port}`);
    console.log(`[config] mocks: ${JSON.stringify(config.mock)}`);
  });

  const shutdown = async (signal) => {
    console.log(`\n[shutdown] ${signal} 수신 → graceful shutdown`);
    stopScheduler();
    await stopMockSensorPublisher();
    await stopSubscriber();
    await stopBroker();
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[fatal] startup failed:', err);
  process.exit(1);
});
