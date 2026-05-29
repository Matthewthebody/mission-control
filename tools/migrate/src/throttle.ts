export function createThrottle(limit: number, windowMs: number) {
  const timestamps: number[] = [];
  return async function throttle() {
    const now = Date.now();
    while (timestamps.length && now - timestamps[0] > windowMs) {
      timestamps.shift();
    }
    if (timestamps.length >= limit) {
      const waitFor = windowMs - (now - timestamps[0]);
      await new Promise((resolve) => setTimeout(resolve, waitFor));
      return throttle();
    }
    timestamps.push(Date.now());
  };
}
