import { processLaunchPushes, processRenewalReminders } from "./push-worker";

export async function runWorkersOnce() {
  const notifications = await processLaunchPushes();
  const reminders = await processRenewalReminders();

  return {
    notifications,
    reminders,
  };
}

async function main() {
  console.log("worker boot");
  await runWorkersOnce();
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
