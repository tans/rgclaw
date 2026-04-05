import { runPollingLoop } from "../shared/polling-loop";
import {
  dispatchPendingNotificationMessages,
  dispatchPendingSystemMessages,
  enqueueKeepaliveReminders,
  processLaunchPushes,
  processRenewalReminders,
} from "./push-worker";
import { scanRecentPaymentTransfers } from "./payment-scanner";

const WORKER_POLL_DELAY_MS = 30_000;
const KEEPALIVE_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

type WorkerRunSummary = {
  notifications: number;
  reminders: number;
  keepalives: number;
  sentNotifications: number;
  sentSystemMessages: number;
  paymentScans: number;
};

type RunWorkersOnceOptions = {
  now?: string;
  runKeepalives?: boolean;
};

type ScheduledWorkerDependencies = {
  processLaunchPushes: typeof processLaunchPushes;
  processRenewalReminders: typeof processRenewalReminders;
  enqueueKeepaliveReminders: typeof enqueueKeepaliveReminders;
  dispatchPendingNotificationMessages: typeof dispatchPendingNotificationMessages;
  dispatchPendingSystemMessages: typeof dispatchPendingSystemMessages;
  now?: () => Date;
};

type WorkerLoopOptions = {
  delayMs?: number;
  logger?: {
    info(message: string): void;
    error(message: string, error: unknown): void;
  };
  runOnce?: () => Promise<void | WorkerRunSummary>;
  shouldContinue?: () => boolean;
  sleep?: (delayMs: number) => Promise<void>;
};

export async function runWorkersOnce({
  now = new Date().toISOString(),
  runKeepalives = true,
}: RunWorkersOnceOptions = {}): Promise<WorkerRunSummary> {
  const notifications = await processLaunchPushes();
  const reminders = await processRenewalReminders();
  const keepalives = runKeepalives ? await enqueueKeepaliveReminders(now) : 0;
  const sentNotifications = await dispatchPendingNotificationMessages();
  const sentSystemMessages = await dispatchPendingSystemMessages();
  const paymentScans = await scanRecentPaymentTransfers();

  return {
    notifications,
    reminders,
    keepalives,
    sentNotifications,
    sentSystemMessages,
    paymentScans,
  };
}

export function createScheduledWorkerRunOnce(
  deps: Partial<ScheduledWorkerDependencies> & { now?: () => Date } = {},
) {
  const {
    processLaunchPushes: runLaunchPushes = processLaunchPushes,
    processRenewalReminders: runRenewalReminders = processRenewalReminders,
    enqueueKeepaliveReminders: runKeepaliveReminders = enqueueKeepaliveReminders,
    dispatchPendingNotificationMessages: runPendingNotificationMessages = dispatchPendingNotificationMessages,
    dispatchPendingSystemMessages: runPendingSystemMessages = dispatchPendingSystemMessages,
  } = deps;

  const now = deps.now ?? (() => new Date());

  let lastKeepaliveSweepAt: number | null = null;

  return async (): Promise<WorkerRunSummary> => {
    const currentTime = now();
    const currentTimeMs = currentTime.getTime();
    const shouldRunKeepalives =
      lastKeepaliveSweepAt === null || currentTimeMs - lastKeepaliveSweepAt >= KEEPALIVE_SWEEP_INTERVAL_MS;

    const notifications = await runLaunchPushes();
    const reminders = await runRenewalReminders();
    const keepalives = shouldRunKeepalives ? await runKeepaliveReminders(currentTime.toISOString()) : 0;
    const sentNotifications = await runPendingNotificationMessages();
    const sentSystemMessages = await runPendingSystemMessages();
    const paymentScans = await scanRecentPaymentTransfers();

    if (shouldRunKeepalives) {
      lastKeepaliveSweepAt = currentTimeMs;
    }

    return {
      notifications,
      reminders,
      keepalives,
      sentNotifications,
      sentSystemMessages,
      paymentScans,
    };
  };
}

export async function runWorkerLoop({
  delayMs = WORKER_POLL_DELAY_MS,
  logger,
  runOnce,
  shouldContinue,
  sleep,
}: WorkerLoopOptions = {}) {
  const scheduledRunOnce =
    runOnce ??
    createScheduledWorkerRunOnce({
      processLaunchPushes,
      processRenewalReminders,
      enqueueKeepaliveReminders,
      dispatchPendingNotificationMessages,
      dispatchPendingSystemMessages,
    });

  await runPollingLoop({
    delayMs,
    logger,
    onErrorMessage: "worker iteration failed",
    onSuccess: () => {
      (logger ?? console).info("worker cycle complete");
    },
    runOnce: scheduledRunOnce as () => Promise<void>,
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
