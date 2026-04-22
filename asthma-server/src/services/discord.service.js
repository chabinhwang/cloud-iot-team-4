import axios from 'axios';
import config from '../config/index.js';

const COLORS = {
  good: 0x2ecc71,
  warning: 0xf1c40f,
  danger: 0xe74c3c,
};

function buildEmbed(report) {
  const s = report.status_summary;
  const action = report.environment_action;
  const color = COLORS[s.overall] ?? 0x95a5a6;

  const fields = [];
  for (const [k, v] of Object.entries(s.perMetric)) {
    fields.push({
      name: `${emojiFor(v.status)} ${labelFor(k)}`,
      value: `${v.value}${v.unit ? ' ' + v.unit : ''}`,
      inline: true,
    });
  }

  if (report.health_analysis?.reasons?.length) {
    fields.push({
      name: '🩺 건강 분석',
      value: report.health_analysis.reasons.join('\n') || '-',
      inline: false,
    });
  }

  if (action?.suggestions?.length) {
    fields.push({
      name: '🧭 권장 조치',
      value: action.suggestions.map((s, i) => `${i + 1}. ${s}`).join('\n'),
      inline: false,
    });
  }

  return {
    title: `${s.overall_emoji} 오늘의 실내 공기 가이드`,
    description: action?.message || '',
    color,
    fields,
    footer: {
      text: `사용자: ${report.userId} · weight=${report.health_analysis?.weight ?? 0} (${report.health_analysis?.level ?? '-'})`,
    },
    timestamp: report.generatedAt,
  };
}

function emojiFor(status) {
  return status === 'good' ? '🟢' : status === 'warning' ? '🟡' : '🔴';
}

function labelFor(key) {
  return (
    {
      pm25: 'PM2.5',
      pm10: 'PM10',
      co2: 'CO₂',
      voc: 'VOC',
      temperature: '온도',
      humidity: '습도',
    }[key] ?? key
  );
}

export async function sendReport(report) {
  const embed = buildEmbed(report);

  if (config.mock.discord || !config.discord.webhookUrl) {
    console.log('[discord:mock] ↓ 리포트 발송 대체 (webhook 미설정)');
    console.log(JSON.stringify({ embeds: [embed] }, null, 2));
    return { ok: true, mock: true };
  }

  const { status } = await axios.post(
    config.discord.webhookUrl,
    { embeds: [embed] },
    { timeout: 8000 },
  );
  return { ok: status >= 200 && status < 300, status };
}
