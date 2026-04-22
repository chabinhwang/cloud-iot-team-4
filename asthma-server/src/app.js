import express from 'express';
import config from './config/index.js';
import authRoutes from './routes/auth.routes.js';
import dataRoutes from './routes/data.routes.js';
import guideRoutes from './routes/guide.routes.js';

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '512kb' }));

  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      uptime_s: Math.round(process.uptime()),
      mqtt: config.mqtt.url,
      mocks: config.mock,
      timestamp: new Date().toISOString(),
    });
  });

  app.use('/auth', authRoutes);
  app.use('/api/data', dataRoutes);
  app.use('/api/guide', guideRoutes);

  // 404
  app.use((req, res) => res.status(404).json({ error: 'not_found', path: req.path }));

  // 에러 핸들러
  app.use((err, _req, res, _next) => {
    console.error('[express] error:', err);
    res.status(err.status || 500).json({ error: err.message || 'internal_error' });
  });

  return app;
}
