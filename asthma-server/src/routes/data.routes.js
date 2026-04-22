import { Router } from 'express';
import store from '../store/memory.js';
import config from '../config/index.js';

const router = Router();

router.get('/environment/:deviceId?', (req, res) => {
  const deviceId = req.params.deviceId || config.defaults.deviceId;
  const rec = store.getLatestEnvironment(deviceId);
  if (!rec) return res.status(404).json({ error: 'not_found', deviceId });
  res.json({ deviceId, ...rec });
});

router.get('/environments', (_req, res) => {
  res.json({ items: store.listEnvironments() });
});

router.get('/biometric/:userId?', (req, res) => {
  const userId = req.params.userId || config.defaults.userId;
  const rec = store.getLatestBiometric(userId);
  if (!rec) return res.status(404).json({ error: 'not_found', userId });
  res.json({ userId, ...rec });
});

router.get('/biometrics', (_req, res) => {
  res.json({ items: store.listBiometrics() });
});

export default router;
