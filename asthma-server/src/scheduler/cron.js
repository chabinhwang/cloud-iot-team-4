import cron from 'node-cron';
import config from '../config/index.js';
import { runGuidePipeline } from '../services/report.service.js';

let task = null;

export function startScheduler() {
  if (!config.scheduler.enabled) {
    console.log('[scheduler] disabled');
    return null;
  }
  if (!cron.validate(config.scheduler.morningCron)) {
    console.error(`[scheduler] invalid cron: ${config.scheduler.morningCron}`);
    return null;
  }

  task = cron.schedule(
    config.scheduler.morningCron,
    async () => {
      console.log(`[scheduler] 기상 트리거 실행: ${new Date().toISOString()}`);
      try {
        const res = await runGuidePipeline({});
        console.log(`[scheduler] 파이프라인 결과: ok=${res.ok} skipped=${res.skipped ?? false}`);
      } catch (err) {
        console.error('[scheduler] 파이프라인 오류:', err.message);
      }
    },
    { timezone: config.scheduler.timezone },
  );
  console.log(
    `[scheduler] cron='${config.scheduler.morningCron}' tz=${config.scheduler.timezone}`,
  );
  return task;
}

export function stopScheduler() {
  if (task) {
    task.stop();
    task = null;
  }
}
