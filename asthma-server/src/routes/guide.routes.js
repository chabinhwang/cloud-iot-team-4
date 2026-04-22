import { Router } from 'express';
import config from '../config/index.js';
import { runGuidePipeline } from '../services/report.service.js';

const router = Router();

router.post('/trigger', async (req, res) => {
  const userId = req.body?.userId || config.defaults.userId;
  const deviceId = req.body?.deviceId || config.defaults.deviceId;
  const scenario = req.body?.scenario;
  const sendToDiscord = req.body?.sendToDiscord !== false;

  try {
    const result = await runGuidePipeline({ userId, deviceId, scenario, sendToDiscord });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

router.get('/preview', async (req, res) => {
  const userId = String(req.query.userId || config.defaults.userId);
  const deviceId = String(req.query.deviceId || config.defaults.deviceId);
  const scenario = req.query.scenario ? String(req.query.scenario) : undefined;

  try {
    const result = await runGuidePipeline({
      userId,
      deviceId,
      scenario,
      sendToDiscord: false,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
