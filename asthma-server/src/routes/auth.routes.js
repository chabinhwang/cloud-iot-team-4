import { Router } from 'express';
import config from '../config/index.js';
import { buildAuthorizeUrl, exchangeCodeForToken } from '../services/fitbit.service.js';

const router = Router();

/**
 * @openapi
 * /auth/fitbit/login:
 *   get:
 *     tags: [Auth]
 *     summary: Fitbit OAuth 2.0 인가 URL 발급
 *     description: |
 *       Fitbit 로그인 페이지로 보낼 `authorizeUrl`과 CSRF 검증용 `state`를 반환합니다.
 *       클라이언트(브라우저)가 이 URL로 이동 → 사용자가 동의 → Fitbit이 `/auth/fitbit/callback?code=...`로 리다이렉트하는 표준 Authorization Code Flow.
 *
 *       - `FITBIT_CLIENT_ID`가 `.env`에 설정되어 있어야 합니다. 없으면 400 (`FITBIT_CLIENT_ID 미설정`).
 *       - `USE_MOCK_FITBIT=true`인 **기본 상태에서는 이 엔드포인트가 필요 없습니다** — Mock 생체 데이터는 `/api/guide/*`가 즉석 생성.
 *     responses:
 *       200:
 *         description: 인가 URL + state
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 authorizeUrl: { type: string, format: uri, example: 'https://www.fitbit.com/oauth2/authorize?client_id=...' }
 *                 state: { type: string, description: 'CSRF 검증용 랜덤 문자열 (콜백에서 검증하려면 클라이언트가 보관)' }
 *       400:
 *         description: FITBIT_CLIENT_ID 미설정
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/fitbit/login', (req, res) => {
  if (!config.fitbit.clientId) {
    return res
      .status(400)
      .json({ error: 'FITBIT_CLIENT_ID 미설정', hint: '.env를 구성하거나 USE_MOCK_FITBIT=true로 운영' });
  }
  const { url, state } = buildAuthorizeUrl();
  res.json({ authorizeUrl: url, state });
});

/**
 * @openapi
 * /auth/fitbit/callback:
 *   get:
 *     tags: [Auth]
 *     summary: Fitbit OAuth 콜백 (Authorization Code → Access/Refresh 토큰 교환)
 *     description: |
 *       Fitbit이 사용자 동의 후 이 경로로 리다이렉트합니다. 서버는 `code`를 토큰 엔드포인트와 교환해
 *       Access/Refresh 토큰을 `userId` 기준으로 Store에 저장합니다. 이후 `/api/guide/*`가 실제 Fitbit API를 호출할 때 사용됩니다.
 *
 *       - 브라우저를 통한 리다이렉트로 호출되는 엔드포인트이므로, 직접 curl로 테스트할 일은 거의 없습니다.
 *       - Fitbit이 에러(`error`)를 붙여 리다이렉트하면 그대로 400으로 반환.
 *     parameters:
 *       - in: query
 *         name: code
 *         required: true
 *         schema: { type: string }
 *         description: Fitbit이 발급한 Authorization Code
 *       - in: query
 *         name: state
 *         required: false
 *         schema: { type: string }
 *         description: 로그인 시 발급한 CSRF 검증 state (클라이언트가 보관했다면 일치 여부 확인)
 *       - in: query
 *         name: user_id
 *         required: false
 *         schema: { type: string }
 *         description: 토큰을 저장할 내부 사용자 ID (생략 시 DEFAULT_USER_ID)
 *       - in: query
 *         name: error
 *         required: false
 *         schema: { type: string }
 *         description: Fitbit이 동의 실패/거부 등으로 붙여 보내는 에러 코드
 *     responses:
 *       200:
 *         description: 토큰 교환 성공, Store에 저장 완료
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok: { type: boolean, example: true }
 *                 userId: { type: string, example: 'user_001' }
 *                 state: { type: string, nullable: true }
 *                 expiresAt: { type: string, format: 'date-time', description: 'Access token 만료 시각' }
 *                 scope: { type: string, description: '발급된 scope 목록(공백 구분)' }
 *       400:
 *         description: code 누락 또는 Fitbit이 에러로 리다이렉트함
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       500:
 *         description: 토큰 교환 실패 (네트워크/자격증명 오류)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
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
