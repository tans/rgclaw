type PollingLogger = {
  info(message: string): void;
  error(message: string, error: unknown): void;
};

type RunPollingLoopOptions = {
  delayMs: number;
  logger?: PollingLogger;
  onSuccess?: () => void | Promise<void>;
  onErrorMessage?: string;
  runOnce: () => Promise<void>;
  shouldContinue?: () => boolean;
  sleep?: (delayMs: number) => Promise<void>;
  startMessage: string;
};

const defaultLogger: PollingLogger = {
  info(message) {
    console.log(message);
  },
  error(message, error) {
    console.error(message, error);
  },
};

function sleep(delayMs: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

export async function runPollingLoop({
  delayMs,
  logger = defaultLogger,
  onSuccess,
  onErrorMessage = "polling iteration failed",
  runOnce,
  shouldContinue = () => true,
  sleep: sleepImpl = sleep,
  startMessage,
}: RunPollingLoopOptions) {
  logger.info(startMessage);

  while (shouldContinue()) {
    try {
      await runOnce();
      await onSuccess?.();
    } catch (error) {
      logger.error(onErrorMessage, error);
    }

    if (!shouldContinue()) {
      break;
    }

    await sleepImpl(delayMs);
  }
}
