/**
 * How the connection to the server is doing, for the banner at the bottom of
 * every page: "ok", "weak" (requests failing and being retried) or "offline"
 * (the device has no network). Requests report into it (services/api.js); the
 * banner (components/ConnectionBanner.jsx) listens.
 */
let status = typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "ok";
const listeners = new Set();

const set = (next) => {
  if (next === status) return;
  status = next;
  listeners.forEach((fn) => fn(status));
};

export const getConnectionStatus = () => status;

export function onConnectionChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** A request is being retried because the connection failed it. */
export const reportWeak = () => set(navigator.onLine === false ? "offline" : "weak");

/** A request reached the server: whatever was wrong has passed. */
export const reportOk = () => set(navigator.onLine === false ? "offline" : "ok");

if (typeof window !== "undefined") {
  window.addEventListener("offline", () => set("offline"));
  window.addEventListener("online", () => set("ok"));
}
