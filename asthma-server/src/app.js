import express from 'express';
import swaggerUi from 'swagger-ui-express';
import config from './config/index.js';
import openapiSpec from './docs/openapi.js';
import authRoutes from './routes/auth.routes.js';
import dataRoutes from './routes/data.routes.js';
import guideRoutes from './routes/guide.routes.js';

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '512kb' }));

  /**
   * @openapi
   * /health:
   *   get:
   *     tags: [Health]
   *     summary: 서버 헬스체크 및 Mock 토글 상태 확인
   *     description: |
   *       서버가 살아있는지, MQTT 브로커 URL은 무엇인지, 각 외부 의존성(sensor/fitbit/weather/discord)이
   *       현재 Mock으로 동작 중인지 실제 연동 중인지 한 번에 확인합니다.
   *       로컬 개발/시연 시작 전 가장 먼저 호출해 기동 여부와 환경 설정을 빠르게 검증하는 용도입니다.
   *     responses:
   *       200:
   *         description: 서버 기동 정상
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/HealthResponse' }
   */
  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      uptime_s: Math.round(process.uptime()),
      mqtt: config.mqtt.url,
      mocks: config.mock,
      timestamp: new Date().toISOString(),
    });
  });

  // Swagger UI (브라우저용) + 원본 OpenAPI JSON (클라이언트 생성/검증 파이프라인용)
  app.get('/openapi.json', (_req, res) => res.json(openapiSpec));
  app.use(
    '/docs',
    swaggerUi.serve,
    swaggerUi.setup(openapiSpec, {
      customSiteTitle: '천식 가이드 API Docs',
      swaggerOptions: { persistAuthorization: true, docExpansion: 'list' },
    }),
  );

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
