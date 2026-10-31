// How long server actions and page loads take, written to the server log (Vercel > Logs)
// as one line: "[timing] saveItinerary 412ms". Search the logs for "[timing]" to find
// the slow ones. Anything over SLOW_MS is marked "slow".
const SLOW_MS = 1_500;

export function logTiming(label: string, ms: number) {
  console.log(`[timing] ${label} ${Math.round(ms)}ms${ms > SLOW_MS ? " slow" : ""}`);
}

export async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try {
    return await fn();
  } finally {
    logTiming(label, performance.now() - started);
  }
}
