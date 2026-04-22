import { Router } from 'express';
import config from '../config/index.js';
import { buildAuthorizeUrl, exchangeCodeForToken } from '../services/fitbit.service.js';

const router = Router();

router.get('/fitbit/login', (req, res) => {
  if (!config.fitbit.clientId) {
    return res
      .status(400)
      .json({ error: 'FITBIT_CLIENT_ID 미설정', hint: '.env를 구성하거나 USE_MOCK_FITBIT=true로 운영' });
  }
  const { url, state } = buildAuthorizeUrl();
  res.json({ authorizeUrl: url, state });
});

router.get('/fitbit/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.status(400).json({ error: String(error) });
  if (!code) return res.status(400).json({ error: 'missing code' });
  try {
    const userId = (req.query.user_id || config.defaults.userId).toString();
    const token = await exchangeCodeForToken(String(code), userId);
    res.json({
      ok: true,
      userId,
      state,
      expiresAt: token.expiresAt,
      scope: token.scope,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
