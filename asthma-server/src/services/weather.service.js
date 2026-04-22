import axios from 'axios';
import config from '../config/index.js';

// 에어코리아: 실시간 측정정보 조회 (시도별 대기질)
const AIRKOREA_BASE = 'https://apis.data.go.kr/B552584/ArpltnInforInqireSvc';
// 기상청: 초단기실황(Ultra-short-term current)
const KMA_BASE = 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0';

/**
 * 실외 공기질 조회. Mock 모드면 가짜 데이터 반환.
 */
export async function fetchOutdoorAirQuality({ sidoName = '서울' } = {}) {
  if (config.mock.weather || !config.weather.airkoreaKey) {
    // 30% 확률로 나쁨
    const bad = Math.random() < 0.3;
    return {
      source: 'mock',
      sidoName,
      pm25: bad ? 50 : 12,
      pm10: bad ? 110 : 25,
      observedAt: new Date().toISOString(),
    };
  }

  const { data } = await axios.get(`${AIRKOREA_BASE}/getCtprvnRltmMesureDnsty`, {
    params: {
      serviceKey: config.weather.airkoreaKey,
      returnType: 'json',
      numOfRows: 10,
      pageNo: 1,
      sidoName,
      ver: '1.0',
    },
    timeout: 8000,
  });

  const items = data?.response?.body?.items ?? [];
  const first = items[0];
  return {
    source: 'airkorea',
    sidoName,
    pm25: Number(first?.pm25Value) || null,
    pm10: Number(first?.pm10Value) || null,
    observedAt: first?.dataTime || new Date().toISOString(),
  };
}

/**
 * 기온/습도 등 실외 기상. Mock 경로 우선.
 */
export async function fetchOutdoorWeather({ nx = 60, ny = 127 } = {}) {
  if (config.mock.weather || !config.weather.kmaKey) {
    return {
      source: 'mock',
      nx,
      ny,
      temperature: Math.round((15 + Math.random() * 10) * 10) / 10,
      humidity: Math.round(40 + Math.random() * 40),
      observedAt: new Date().toISOString(),
    };
  }

  const now = new Date();
  const yyyymmdd = now.toISOString().slice(0, 10).replace(/-/g, '');
  const hh = String(now.getHours()).padStart(2, '0');
  const { data } = await axios.get(`${KMA_BASE}/getUltraSrtNcst`, {
    params: {
      serviceKey: config.weather.kmaKey,
      dataType: 'JSON',
      base_date: yyyymmdd,
      base_time: `${hh}00`,
      nx,
      ny,
      numOfRows: 10,
      pageNo: 1,
    },
    timeout: 8000,
  });
  const items = data?.response?.body?.items?.item ?? [];
  const pick = (code) => Number(items.find((x) => x.category === code)?.obsrValue);
  return {
    source: 'kma',
    nx,
    ny,
    temperature: pick('T1H'),
    humidity: pick('REH'),
    observedAt: new Date().toISOString(),
  };
}
