import { runPollingLoop } from "../shared/polling-loop";
import { processLaunchPushes, processRenewalReminders } from "./push-worker";

const WORKER_POLL_DELAY_MS = 30_000;

type WorkerLoopOptions = {
  delayMs?: number;
  logger?: {
    info(message: string): void;
    error(message: string, error: unknown): void;
  };
  runOnce?: () => Promise<void | { notifications: number; reminders: number }>;
  shouldContinue?: () => boolean;
  sleep?: (delayMs: number) => Promise<void>;
};

export async function runWorkersOnce() {
  const notifications = await processLaunchPushes();
  const reminders = await processRenewalReminders();

  return {
    notifications,
    reminders,
  };
}

export async function runWorkerLoop({
  delayMs = WORKER_POLL_DELAY_MS,
  logger,
  runOnce = runWorkersOnce,
  shouldContinue,
  sleep,
}: WorkerLoopOptions = {}) {
  await runPollingLoop({
    delayMs,
    logger,
    onErrorMessage: "worker iteration failed",
    onSuccess: () => {
      (logger ?? console).info("worker cycle complete");
    },
    runOnce,
    shouldContinue,
    sleep,
    startMessage: "worker boot",
  });
}

if (import.meta.main) {
  runWorkerLoop().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
