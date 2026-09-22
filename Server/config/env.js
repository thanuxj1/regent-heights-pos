/**
 * Configuration, checked once at boot.
 *
 * The runtime guards elsewhere in this server deliberately keep serving when
 * something goes wrong mid-shift: one failed request is better than a till that
 * goes dark. A missing DATABASE_URL or JWT_SECRET is not that. Nobody can sign
 * in, every authenticated request answers 500, and the property finds out from
 * a cashier rather than from the deploy. So this one refuses to start, at the
 * moment somebody is watching the deploy and can fix it.
 */

const REQUIRED = {
  DATABASE_URL: "the Postgres connection string — nothing can be read or written without it",
  JWT_SECRET: "what signs session tokens — nobody can sign in without it",
};

export function checkConfig() {
  const missing = Object.keys(REQUIRED).filter((k) => !String(process.env[k] || "").trim());
  if (missing.length) {
    console.error("\n  The server cannot start. These are not set:\n");
    for (const k of missing) console.error(`    ${k}  —  ${REQUIRED[k]}`);
    console.error("\n  They belong in Server/.env. See Server/.env.example.\n");
    process.exit(1);
  }

  if (inProduction && !corsOrigins.length) {
    console.warn(
      "  [config] CLIENT_URL is not set, so this API answers only pages served from its own\n"
      + "           address. Set it if the app is hosted somewhere else.",
    );
  }
}

const inProduction = process.env.NODE_ENV === "production";

/** CLIENT_URL, which may name more than one site. */
const corsOrigins = String(process.env.CLIENT_URL || "")
  .split(",")
  .map((s) => s.trim().replace(/\/+$/, ""))
  .filter(Boolean);

/**
 * Who may call this API from a browser.
 *
 * The sites named in CLIENT_URL. With none named: in development the caller's
 * own origin is reflected back, which is what lets Vite on :3000 talk to the
 * API on :5000; in production nothing cross-origin is allowed, so the API
 * answers only pages served from its own address.
 *
 * It used to fall back to "*" — every site on the internet, including one
 * running in the same browser as an open till.
 */
export const corsOrigin = corsOrigins.length ? corsOrigins : !inProduction;

/** For the line the server prints at boot. */
export const describeCorsOrigin = () =>
  (corsOrigins.length
    ? corsOrigins.join(", ")
    : inProduction
      ? "same origin only (CLIENT_URL not set)"
      : "any origin (development)");
