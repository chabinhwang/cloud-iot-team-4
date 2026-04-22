import { Router } from 'express';
import config from '../config/index.js';
import { runGuidePipeline } from '../services/report.service.js';

const router = Router();

/**
 * @openapi
 * /api/guide/trigger:
 *   post:
 *     tags: [Guide]
 *     summary: 가이드 파이프라인 실행 (+ 옵션 Discord 발송)
 *     description: |
 *       전체 파이프라인을 **지금 즉시** 실행합니다.
 *
 *       내부 동작 순서:
 *       1. **실내 환경 조회** — `store.getLatestEnvironment(deviceId)`로 MQTT Subscriber가 쌓은 최신 센서값 읽기.
 *          (Mock 센서 Publisher가 5초 간격으로 publish 중이면 바로 존재)
 *       2. **야간 생체 조회** — `fitbit.service.fetchNightlyBiometric({ userId, scenario })`.
 *          `USE_MOCK_FITBIT=true`면 `scenario` 값에 따른 Mock 집계를 즉석 생성, 실제 모드면 OAuth 토큰으로 Fitbit Web API 호출.
 *       3. **실외 공기질 조회** — 에어코리아/기상청 (또는 Mock).
 *       4. **가이드 산출** — `guide.service`의 순수함수가 `health_weight`, 항목별 상태, primary action 결정.
 *       5. **Discord 전송** — `sendToDiscord=true`일 때만. `USE_MOCK_DISCORD=true`면 실제 webhook 대신 서버 콘솔에 Embed JSON 출력.
 *
 *       `cron` 스케줄러(`MORNING_CRON`, 기본 매일 07:00)가 같은 파이프라인을 자동 호출하며,
 *       이 엔드포인트는 그것을 임의 시점에 수동 실행하는 용도입니다.
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/GuideTriggerRequest' }
 *           examples:
 *             severeMockNoSend:
 *               summary: 심각 시나리오 + Discord 미발송 (프리뷰 용도)
 *               value: { scenario: 'severe', sendToDiscord: false }
 *             severeMockWithDiscord:
 *               summary: 심각 시나리오 + Mock Discord (콘솔 출력)
 *               value: { scenario: 'severe', sendToDiscord: true }
 *             healthyDefault:
 *               summary: 건강 시나리오 (기본 userId/deviceId)
 *               value: { scenario: 'healthy', sendToDiscord: false }
 *             explicitIds:
 *               summary: userId/deviceId 명시
 *               value:
 *                 userId: 'user_001'
 *                 deviceId: 'rpi_001'
 *                 scenario: 'mild'
 *                 sendToDiscord: false
 *     responses:
 *       200:
 *         description: 파이프라인 실행 성공 (skipped=true면 입력 데이터 부족으로 가이드 생략)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/GuidePipelineResult' }
 *       500:
 *         description: 내부 오류 (외부 API 실패, Fitbit 토큰 만료 등)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
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

/**
 * @openapi
 * /api/guide/preview:
 *   get:
 *     tags: [Guide]
 *     summary: 가이드 프리뷰 (Discord 절대 미발송)
 *     description: |
 *       `/api/guide/trigger`와 **완전히 동일한 파이프라인**을 실행하지만 `sendToDiscord`를 강제로 `false`로 고정합니다.
 *       리포트 JSON만 받아 보고 싶을 때, 혹은 Mock Fitbit 시나리오별 결과 차이를 브라우저/컬에서 빠르게 비교할 때 사용합니다.
 *
 *       - 내부 동작: `runGuidePipeline({ userId, deviceId, scenario, sendToDiscord: false })`.
 *       - 부작용 없음 — Discord 콘솔 출력조차 찍히지 않고, Store 상태도 바꾸지 않습니다.
 *     parameters:
 *       - in: query
 *         name: userId
 *         schema: { type: string }
 *         required: false
 *         description: 대상 사용자 ID (생략 시 DEFAULT_USER_ID=user_001)
 *         example: user_001
 *       - in: query
 *         name: deviceId
 *         schema: { type: string }
 *         required: false
 *         description: 대상 디바이스 ID (생략 시 DEFAULT_DEVICE_ID=rpi_001)
 *         example: rpi_001
 *       - $ref: '#/components/parameters/ScenarioQuery'
 *     responses:
 *       200:
 *         description: 리포트 JSON
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/GuidePipelineResult' }
 *             examples:
 *               severe:
 *                 summary: severe 시나리오 응답 예시
 *                 value:
 *                   ok: true
 *                   report:
 *                     status_summary: { overall: 'danger', overall_emoji: '🔴' }
 *                     health_analysis:
 *                       weight: 0.8
 *                       level: 'high'
 *                       reasons: ['SpO2 90% (심각: <92)', '호흡수 24회/분 (심각: >22)']
 *                     environment_action:
 *                       primary: 'ventilate'
 *                       message: '창문을 열고 10~15분 환기하세요 (CO₂ 배출).'
 *       500:
 *         description: 내부 오류
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
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
