/**
 * Retry a request that failed because it never reached the server.
 *
 * A dev-server restart, a dropped wifi frame at the counter, a laptop waking
 * up — all of these look identical to axios: no `response`, just a network
 * error. Retrying those is safe and usually succeeds within a second.
 *
 * A reply with a status code is NOT retried. A 401, 403 or 500 is the server
 * answering, and asking again three times only delays showing the real problem.
 */
export function isTransient(err) {
  if (!err) return false;
  if (err.response) return false;              // the server answered
  return (
    err.code === "ERR_NETWORK" ||
    err.code === "ECONNABORTED" ||
    err.message === "Network Error" ||
    !!err.request                              // sent, nothing came back
  );
}

export async function withRetry(fn, { tries = 3, delayMs = 600 } = {}) {
  let lastError;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isTransient(err) || attempt === tries - 1) throw err;
      // Back off a little each time; the server is usually up by the second go.
      await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)));
    }
  }
  throw lastError;
}
