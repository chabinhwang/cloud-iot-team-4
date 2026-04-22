import { Router } from 'express';
import store from '../store/memory.js';
import config from '../config/index.js';

const router = Router();

/**
 * @openapi
 * /api/data/environment/{deviceId}:
 *   get:
 *     tags: [Data]
 *     summary: 특정 디바이스의 최신 실내 환경 측정값
 *     description: |
 *       MQTT Subscriber가 `health/sensor/{deviceId}/environment` 토픽에서 수신해
 *       In-Memory Store에 저장한 **가장 최근 한 건**을 반환합니다.
 *
 *       - `USE_MOCK_SENSOR=true` (기본)면 Mock Publisher가 `MOCK_SENSOR_INTERVAL_MS`(기본 5000ms)마다 publish 중이므로
 *         서버 기동 직후 몇 초만 기다리면 데이터가 존재합니다.
 *       - 실제 RPi 연동 시 디바이스가 한 번도 publish하지 않았다면 404.
 *     parameters:
 *       - $ref: '#/components/parameters/DeviceIdPath'
 *     responses:
 *       200:
 *         description: 최신 환경 데이터 (타임스탬프 + 6개 지표)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/EnvironmentRecord' }
 *       404:
 *         description: 해당 deviceId로 수신된 데이터가 아직 없음
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/environment/:deviceId?', (req, res) => {
  const deviceId = req.params.deviceId || config.defaults.deviceId;
  const rec = store.getLatestEnvironment(deviceId);
  if (!rec) return res.status(404).json({ error: 'not_found', deviceId });
  res.json({ deviceId, ...rec });
});

/**
 * @openapi
 * /api/data/environments:
 *   get:
 *     tags: [Data]
 *     summary: 등록된 모든 디바이스의 최신 환경 측정값 목록
 *     description: |
 *       Store가 보유한 **디바이스별 최신 한 건씩**을 배열로 반환합니다.
 *       여러 RPi가 동시에 publish하는 시연에서 한눈에 현황을 보거나, 대시보드/모니터링 화면에 붙일 때 사용.
 *       publish 받은 적 없는 디바이스는 포함되지 않으며, 빈 `items`도 정상 응답입니다.
 *     responses:
 *       200:
 *         description: 디바이스별 최신 데이터 배열
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/EnvironmentList' }
 */
router.get('/environments', (_req, res) => {
  res.json({ items: store.listEnvironments() });
});

/**
 * @openapi
 * /api/data/biometric/{userId}:
 *   get:
 *     tags: [Data]
 *     summary: 특정 사용자의 최신 야간 생체 집계 (Store)
 *     description: |
 *       MQTT 토픽 `health/fitbit/{userId}/biometric`으로 수신된 **Store의 최신 한 건**을 반환합니다.
 *
 *       ⚠️ **주의**: 기본 Mock 설정에서는 Fitbit 전용 MQTT publisher가 붙어있지 않으므로 Store가 비어 있어 **404가 정상**입니다.
 *       Mock 파이프라인에서의 생체 데이터는 `/api/guide/trigger` 또는 `/api/guide/preview` 호출 **시점에만 즉석 생성**되어
 *       리포트에 포함될 뿐, 이 엔드포인트로는 노출되지 않습니다.
 *       이 엔드포인트는 실제 Fitbit 연동 이후, 또는 향후 Fitbit→MQTT 브리지가 추가된 시점에 의미가 있습니다.
 *     parameters:
 *       - $ref: '#/components/parameters/UserIdPath'
 *     responses:
 *       200:
 *         description: 최신 생체 집계
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/BiometricRecord' }
 *       404:
 *         description: 해당 userId로 수신된 데이터가 없음 (기본 Mock 환경에서 정상)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/biometric/:userId?', (req, res) => {
  const userId = req.params.userId || config.defaults.userId;
  const rec = store.getLatestBiometric(userId);
  if (!rec) return res.status(404).json({ error: 'not_found', userId });
  res.json({ userId, ...rec });
});

/**
 * @openapi
 * /api/data/biometrics:
 *   get:
 *     tags: [Data]
 *     summary: 등록된 모든 사용자의 최신 생체 집계 목록
 *     description: |
 *       Store가 보유한 **사용자별 최신 한 건씩**을 배열로 반환합니다.
 *       기본 Mock 설정에서는 Fitbit→MQTT 경로가 없어 `items`가 비어있는 것이 정상이며,
 *       실제 Fitbit 연동 또는 외부 publisher가 붙은 후에 채워집니다.
 *     responses:
 *       200:
 *         description: 사용자별 최신 생체 데이터 배열 (비어있을 수 있음)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/BiometricList' }
 */
router.get('/biometrics', (_req, res) => {
  res.json({ items: store.listBiometrics() });
});

export default router;
