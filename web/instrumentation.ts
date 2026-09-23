export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Checks every minute that the worker's heartbeat is fresh; alerts directly if not.
  const { startWorkerWatchdog } = await import("./lib/watchdog");
  startWorkerWatchdog();
}
