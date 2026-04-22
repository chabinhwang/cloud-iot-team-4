import { createServer } from 'node:net';
import Aedes from 'aedes';
import config from '../config/index.js';

let aedesInstance = null;
let tcpServer = null;

export function startBroker() {
  if (!config.mqtt.embedded) {
    console.log('[broker] EMBEDDED_BROKER=false → 외부 브로커 사용, 임베디드 브로커 미기동');
    return null;
  }

  aedesInstance = new Aedes();
  tcpServer = createServer(aedesInstance.handle);

  aedesInstance.on('client', (c) => console.log(`[broker] client connected: ${c?.id}`));
  aedesInstance.on('clientDisconnect', (c) =>
    console.log(`[broker] client disconnected: ${c?.id}`),
  );
  aedesInstance.on('publish', (packet, client) => {
    if (client && packet?.topic && !packet.topic.startsWith('$')) {
      console.log(
        `[broker] ${client.id} → ${packet.topic} (${packet.payload?.length ?? 0}B)`,
      );
    }
  });

  return new Promise((resolve, reject) => {
    tcpServer.once('error', reject);
    tcpServer.listen(config.mqtt.brokerPort, () => {
      console.log(`[broker] aedes listening on tcp://0.0.0.0:${config.mqtt.brokerPort}`);
      resolve(aedesInstance);
    });
  });
}

export async function stopBroker() {
  if (tcpServer) {
    await new Promise((res) => tcpServer.close(() => res()));
    tcpServer = null;
  }
  if (aedesInstance) {
    await new Promise((res) => aedesInstance.close(() => res()));
    aedesInstance = null;
  }
}
