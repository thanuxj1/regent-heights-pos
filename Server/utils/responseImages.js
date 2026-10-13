// utils/responseImages.js
//
// Photos are stored in the database as data URLs (100 KB or more each). Any list
// that carried them grew with every upload until a shop's connection could no
// longer load it in time: the till's "503", "Failed to load products". These
// middlewares keep that from happening again, on every route, without changing
// how anything is stored:
//
//   slimListImages   a photo inside a list (a row of an array) leaves as a short
//                    link to a cached copy; the photo itself is fetched once and
//                    kept by the browser.
//   restoreImageLinks a link sent back (an edit form that loaded its data from a
//                    list) is turned back into the photo before any route sees
//                    it, so what is stored never changes.
//   compressJson     JSON leaves gzipped when the browser accepts it.
//
// Passport and ID scans, and a guest's photo, are never turned into links: they
// stay only where a signed-in screen asked for them.

import crypto from "node:crypto";
import zlib from "node:zlib";
import pool from "../config/database.js";

const MIN_SIZE = 2048;                     // a small icon is not worth a round trip
const PRIVATE_KEYS = new Set(["id_document", "passport_nic", "photo"]);
const DATA_URL = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i;
const LINK = /^https?:\/\/[^/]+\/api\/images\/([0-9a-f]{32})$/;

const known = new Set();                   // hashes already in IMAGE_CACHE
const remember = (hash) => {
  if (known.size > 5000) known.clear();
  known.add(hash);
};

async function store(hash, mime, b64) {
  if (known.has(hash)) return;
  await pool.query(
    `INSERT INTO "IMAGE_CACHE" (hash, mime, bytes) VALUES ($1, $2, $3) ON CONFLICT (hash) DO NOTHING`,
    [hash, mime, Buffer.from(b64, "base64")],
  );
  remember(hash);
}

/** Every [holder, key] whose value is a big data-URL photo inside a list row. */
function collect(node, inRow, out, depth = 0) {
  if (depth > 6 || node == null) return;
  if (Array.isArray(node)) {
    node.forEach((el, i) => {
      if (typeof el === "string") { if (inRow) out.push([node, i]); }
      else collect(el, inRow || (el && typeof el === "object"), out, depth + 1);
    });
    return;
  }
  if (typeof node !== "object") return;
  for (const [k, v] of Object.entries(node)) {
    if (PRIVATE_KEYS.has(k)) continue;
    if (typeof v === "string") { if (inRow) out.push([node, k]); }
    else collect(v, inRow, out, depth + 1);
  }
}

export function slimListImages(req, res, next) {
  if (req.method !== "GET") return next();
  const json = res.json.bind(res);
  res.json = (body) => {
    const spots = [];
    try { collect(body, false, spots); } catch { return json(body); }
    const photos = spots.filter(([h, k]) => {
      const v = h[k];
      return typeof v === "string" && v.length >= MIN_SIZE && v.startsWith("data:image/");
    });
    if (!photos.length) return json(body);
    const base = `${req.protocol}://${req.get("host")}`;
    return Promise.all(photos.map(async ([holder, key]) => {
      const m = DATA_URL.exec(holder[key]);
      if (!m) return;
      const hash = crypto.createHash("md5").update(holder[key]).digest("hex");
      await store(hash, m[1].toLowerCase(), m[2]);
      holder[key] = `${base}/api/images/${hash}`;
    }))
      .then(() => json(body))
      // Never fail a page over this: send it as it was.
      .catch(() => json(body));
  };
  next();
}

/** Links handed back in a request body become the photos they stand for. */
export async function restoreImageLinks(req, res, next) {
  try {
    if (req.method === "GET" || !req.body || typeof req.body !== "object") return next();
    const spots = [];
    const walk = (node, depth = 0) => {
      if (depth > 6 || node == null || typeof node !== "object") return;
      for (const [k, v] of Object.entries(node)) {
        if (typeof v === "string" && LINK.test(v)) spots.push([node, k, LINK.exec(v)[1]]);
        else walk(v, depth + 1);
      }
    };
    walk(req.body);
    if (!spots.length) return next();
    const { rows } = await pool.query(
      `SELECT hash, mime, bytes FROM "IMAGE_CACHE" WHERE hash = ANY($1::text[])`,
      [[...new Set(spots.map((s) => s[2]))]],
    );
    const byHash = new Map(rows.map((r) => [r.hash, `data:${r.mime};base64,${r.bytes.toString("base64")}`]));
    for (const [holder, key, hash] of spots) if (byHash.has(hash)) holder[key] = byHash.get(hash);
    next();
  } catch (err) {
    next(err);
  }
}

/** GET /api/images/:hash — public, like any photo on a page; the hash is its content. */
export async function getCachedImage(req, res, next) {
  try {
    const { hash } = req.params;
    if (!/^[0-9a-f]{32}$/.test(hash)) { res.status(404); throw new Error("Not found"); }
    const { rows } = await pool.query(`SELECT mime, bytes FROM "IMAGE_CACHE" WHERE hash = $1`, [hash]);
    if (!rows.length) { res.status(404); throw new Error("Not found"); }
    res.set({
      "Content-Type": rows[0].mime,
      "Content-Length": rows[0].bytes.length,
      "Cache-Control": "public, max-age=31536000, immutable",
    });
    res.end(rows[0].bytes);
  } catch (err) {
    next(err);
  }
}

/** JSON over 1 KB leaves gzipped when the browser says it can take it. */
export function compressJson(req, res, next) {
  if (!/\bgzip\b/.test(req.headers["accept-encoding"] || "")) return next();
  const json = res.json.bind(res);
  res.json = (body) => {
    if (res.headersSent) return json(body);
    let text;
    try { text = JSON.stringify(body); } catch { return json(body); }
    if (text === undefined || Buffer.byteLength(text) < 1024) return json(body);
    const gz = zlib.gzipSync(text, { level: 6 });
    res.set({
      "Content-Type": "application/json; charset=utf-8",
      "Content-Encoding": "gzip",
      "Content-Length": gz.length,
    });
    res.vary("Accept-Encoding");
    return res.end(gz);
  };
  next();
}
