import mqtt from 'mqtt';
import config from '../config/index.js';
import { handleMessage } from './handlers.js';

let client = null;

export function startSubscriber() {
  client = mqtt.connect(config.mqtt.url, {
    clientId: `asthma-server-sub-${Math.random().toString(16).slice(2, 8)}`,
    reconnectPeriod: 2000,
  });

  client.on('connect', () => {
    console.log(`[subscriber] connected → ${config.mqtt.url}`);
    client.subscribe(config.mqtt.topics.subscribeAll, { qos: 0 }, (err) => {
      if (err) console.error('[subscriber] subscribe error:', err);
      else console.log(`[subscriber] subscribed → ${config.mqtt.topics.subscribeAll}`);
    });
  });

  client.on('message', (topic, payload) => handleMessage(topic, payload));

  client.on('error', (err) => console.error('[subscriber] error:', err.message));
  client.on('reconnect', () => console.log('[subscriber] reconnecting...'));
  client.on('close', () => console.log('[subscriber] connection closed'));

  return client;
}

export function getClient() {
  return client;
}

export async function stopSubscriber() {
  if (client) {
    await new Promise((res) => client.end(false, {}, () => res()));
    client = null;
  }
}
