/**
 * Where the server is, for a build that has to run somewhere other than this
 * laptop.
 *
 * `VITE_API_URL` decides it. Without that variable a build fell back to
 * `http://localhost:5000/api` — which is this machine, so a till on the
 * counter, or a phone on the hotel's wifi, called a server that only exists on
 * the developer's computer and showed "cannot reach the server" with nothing in
 * any log to explain it.
 *
 * So the fallback now depends on where the page itself came from: localhost
 * during development, and the same origin the page was served from anywhere
 * else. A deployment that serves the app and the API together works with no
 * configuration at all, and one that splits them sets VITE_API_URL.
 */
const servedLocally =
  typeof window !== "undefined" &&
  /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(window.location.hostname);

const trimSlash = (u) => String(u || "").replace(/\/+$/, "");

export const API_URL =
  trimSlash(import.meta.env.VITE_API_URL) ||
  (servedLocally ? "http://localhost:5000/api" : "/api");

/** Socket.IO connects to the server's root, not to /api. */
export const SOCKET_URL =
  trimSlash(import.meta.env.VITE_SOCKET_URL) ||
  trimSlash(import.meta.env.VITE_API_URL).replace(/\/api$/, "") ||
  (servedLocally
    ? "http://localhost:5000"
    : (typeof window !== "undefined" ? window.location.origin : ""));

/** Images the server serves from its own root. */
export const IMAGE_BASE_URL = API_URL.replace(/\/api$/, "");
