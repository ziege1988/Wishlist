// @ts-nocheck – bewusst einfaches JavaScript, damit Copy & Paste im Dashboard ohne Typfehler läuft
// =====================================================================
//  Supabase Edge Function "product-info"
//
//  1) { url }            → liest Titel, Preis und Bild aus einer Shopseite
//                          (nur für den angemeldeten Admin)
//  2) { token }          → aktualisiert die Preise aller Wünsche einer Liste,
//                          höchstens alle 12 Stunden je Wunsch (für alle mit Link)
//  3) { token, force }   → wie 2), aber sofort (nur für den angemeldeten Admin)
//
//  Einrichtung: siehe README → "Preise automatisch aus dem Link".
//  WICHTIG: In den Function-Einstellungen "Verify JWT" AUSSCHALTEN –
//  die Anmeldung wird hier im Code selbst geprüft.
// =====================================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  (() => {
    try { return Object.values(JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"))[0] ?? ""; }
    catch { return ""; }
  })();
const ALLOW_LOCAL = Deno.env.get("WISHLIST_ALLOW_LOCAL") === "1"; // nur für Tests

const REFRESH_AFTER_MS = 12 * 60 * 60 * 1000;
const MAX_ITEMS_PER_RUN = 25;
const FETCH_TIMEOUT_MS = 10000;
const MAX_HTML_BYTES = 3_000_000;
const MAX_IMAGE_BYTES = 4_000_000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

class HttpError extends Error {
  status;
  constructor(status, message) { super(message); this.status = status; }
}

// ---------------------------------------------------------------------
//  Einstieg
// ---------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body.url === "string") {
      await requireAdmin(req);
      return json(await getProductInfo(body.url, { withImage: true }));
    }
    if (typeof body.token === "string") {
      if (body.force) await requireAdmin(req);
      return json(await refreshList(body.token, Boolean(body.force)));
    }
    return json({ error: "bad_request" }, 400);
  } catch (e) {
    return json({ error: e.message || "error" }, e.status || 500);
  }
});

/** Prüft über Supabase Auth, ob ein angemeldeter Benutzer anfragt */
async function requireAdmin(req) {
  const auth = req.headers.get("authorization") ?? "";
  const apikey = req.headers.get("apikey") ?? "";
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { authorization: auth, apikey },
  });
  if (!res.ok) throw new HttpError(401, "not_authenticated");
}

// ---------------------------------------------------------------------
//  Datenbank (REST mit Service-Schlüssel, nur serverseitig)
// ---------------------------------------------------------------------

function dbHeaders(extra = {}) {
  const h = { apikey: SERVICE_KEY, "Content-Type": "application/json", ...extra };
  if (SERVICE_KEY.startsWith("eyJ")) h.Authorization = `Bearer ${SERVICE_KEY}`;
  return h;
}

async function db(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: dbHeaders(init.headers),
  });
  if (!res.ok) throw new HttpError(500, `db_error ${res.status}: ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function refreshList(token, force) {
  if (!/^[0-9a-f-]{36}$/i.test(token)) throw new HttpError(400, "bad_token");
  if (!SERVICE_KEY) throw new HttpError(500, "service_key_missing");

  const persons = await db(`persons?select=id&share_token=eq.${token}`);
  if (!persons.length) throw new HttpError(404, "not_found");

  const items = await db(
    `items?select=id,url,price,price_checked_at&person_id=eq.${persons[0].id}&auto_price=eq.true`,
  );
  const now = Date.now();
  const due = items
    .filter((i) => i.url)
    .filter((i) => force || !i.price_checked_at || now - Date.parse(i.price_checked_at) > REFRESH_AFTER_MS)
    .slice(0, MAX_ITEMS_PER_RUN);

  let changed = 0;
  let failed = 0;
  // in kleinen Gruppen parallel, um Shops nicht zu überlasten
  for (let i = 0; i < due.length; i += 4) {
    await Promise.all(due.slice(i, i + 4).map(async (item) => {
      const stamp = new Date().toISOString();
      let info = null;
      try { info = await getProductInfo(item.url, { withImage: false }); } catch { /* Shop nicht erreichbar */ }
      const patch = { price_checked_at: stamp };
      if (info?.price != null && (!info.currency || info.currency === "EUR")) {
        patch.price_updated_at = stamp;
        if (Number(item.price) !== info.price) {
          patch.price = info.price;
          changed++;
        }
      } else {
        failed++;
      }
      await db(`items?id=eq.${item.id}`, { method: "PATCH", body: JSON.stringify(patch) });
    }));
  }
  return { checked: due.length, changed, failed };
}

// ---------------------------------------------------------------------
//  Shopseite laden & auswerten
// ---------------------------------------------------------------------

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "de-DE,de;q=0.9,en;q=0.6",
};

function checkUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new HttpError(400, "bad_url"); }
  if (!/^https?:$/.test(u.protocol)) throw new HttpError(400, "bad_url");
  const host = u.hostname.toLowerCase();
  const local =
    host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") ||
    /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/.test(host) ||
    host === "[::1]" || host.startsWith("[fc") || host.startsWith("[fd");
  if (local && !ALLOW_LOCAL) throw new HttpError(400, "bad_url");
  return u;
}

async function readLimited(res, limit) {
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) { await reader.cancel(); break; }
    chunks.push(value);
  }
  const out = new Uint8Array(Math.min(size, limit));
  let off = 0;
  for (const c of chunks) { out.set(c.subarray(0, out.length - off), off); off += c.length; if (off >= out.length) break; }
  return out;
}

export async function getProductInfo(rawUrl, { withImage }) {
  const url = checkUrl(rawUrl);
  const res = await fetch(url, {
    headers: BROWSER_HEADERS,
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new HttpError(502, `shop_status_${res.status}`);
  const html = new TextDecoder().decode(await readLimited(res, MAX_HTML_BYTES));
  const info = extractProduct(html, res.url || url.href);

  if (withImage && info.image) {
    try { info.imageData = await fetchImageAsDataUrl(info.image); } catch { /* ohne Bild weiter */ }
  }
  return info;
}

async function fetchImageAsDataUrl(src) {
  const url = checkUrl(src);
  const res = await fetch(url, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  const type = (res.headers.get("content-type") || "").split(";")[0].trim();
  if (!res.ok || !type.startsWith("image/")) return null;
  const bytes = await readLimited(res, MAX_IMAGE_BYTES + 1);
  if (bytes.length > MAX_IMAGE_BYTES) return null;
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(bin)}`;
}

// ---------------------------------------------------------------------
//  HTML-Auswertung (ohne externe Bibliotheken)
// ---------------------------------------------------------------------

export function extractProduct(html, pageUrl) {
  const out = { title: null, price: null, currency: null, image: null };

  // 1) Strukturierte Daten (JSON-LD, von den meisten Shops für Google bereitgestellt)
  for (const m of html.matchAll(/<script[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data;
    try { data = JSON.parse(m[1].trim()); } catch { continue; }
    const product = findProduct(data);
    if (!product) continue;
    out.title ??= clean(product.name);
    out.image ??= firstImage(product.image);
    const offer = firstOffer(product.offers);
    if (offer && out.price == null) {
      out.price = machinePrice(offer.price ?? offer.lowPrice ?? offer.priceSpecification?.price);
      out.currency = offer.priceCurrency ?? offer.priceSpecification?.priceCurrency ?? null;
    }
  }

  // 2) Meta-Tags (Open Graph, Produkt-Tags, Microdata)
  if (out.price == null) {
    const p = meta(html, "product:price:amount") ?? meta(html, "og:price:amount") ?? itemprop(html, "price");
    out.price = machinePrice(p);
    out.currency ??= meta(html, "product:price:currency") ?? meta(html, "og:price:currency") ?? itemprop(html, "priceCurrency");
  }

  // 3) Amazon (liefert keine strukturierten Preisdaten)
  if (out.price == null && /amazon\./i.test(pageUrl)) {
    const start = html.search(/id=["'](corePrice_feature_div|corePriceDisplay_desktop_feature_div|apex_desktop)["']/);
    const region = start >= 0 ? html.slice(start, start + 20000) : html;
    const m = region.match(/class=["']a-offscreen["'][^>]*>\s*([^<]+)</);
    if (m) {
      out.price = humanPrice(m[1]);
      if (out.price != null) out.currency ??= /€|EUR/.test(m[1]) ? "EUR" : null;
    }
    out.image ??= html.match(/"hiRes":"(https:[^"]+)"/)?.[1] ?? html.match(/id=["']landingImage["'][^>]*data-old-hires=["']([^"']+)/)?.[1] ?? null;
    out.title ??= clean(html.match(/id=["']productTitle["'][^>]*>([\s\S]*?)</)?.[1]);
  }

  out.title ??= clean(meta(html, "og:title")) ?? clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  out.image ??= meta(html, "og:image") ?? meta(html, "og:image:url") ?? meta(html, "twitter:image");
  if (out.image) {
    try { out.image = new URL(decodeEntities(out.image), pageUrl).href; } catch { out.image = null; }
  }
  if (out.title && out.title.length > 200) out.title = out.title.slice(0, 197) + "…";
  if (out.currency) out.currency = String(out.currency).toUpperCase().replace("€", "EUR");
  return out;
}

function findProduct(node, depth = 0) {
  if (!node || typeof node !== "object" || depth > 6) return null;
  if (Array.isArray(node)) {
    for (const n of node) { const p = findProduct(n, depth + 1); if (p) return p; }
    return null;
  }
  const type = [].concat(node["@type"] ?? []).map(String);
  if (type.includes("Product")) return node;
  if (type.includes("ProductGroup") && node.hasVariant) {
    const v = findProduct(node.hasVariant, depth + 1);
    if (v) return { ...v, name: node.name ?? v.name, image: v.image ?? node.image };
  }
  for (const key of ["@graph", "mainEntity", "itemListElement", "item"]) {
    const p = findProduct(node[key], depth + 1);
    if (p) return p;
  }
  return null;
}

function firstOffer(offers) {
  if (!offers) return null;
  if (Array.isArray(offers)) return offers.map(firstOffer).find((o) => o) ?? null;
  if (offers.offers) return firstOffer(offers.offers) ?? offers;
  return offers;
}

function firstImage(img) {
  if (!img) return null;
  if (typeof img === "string") return img;
  if (Array.isArray(img)) return firstImage(img[0]);
  return img.url ?? img.contentUrl ?? null;
}

function attrRegex(attr, value) {
  const v = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [
    new RegExp(`<meta[^>]*${attr}=["']${v}["'][^>]*content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*${attr}=["']${v}["']`, "i"),
  ];
}

function meta(html, name) {
  for (const attr of ["property", "name"]) {
    for (const re of attrRegex(attr, name)) {
      const m = html.match(re);
      if (m && m[1].trim()) return decodeEntities(m[1].trim());
    }
  }
  return null;
}

function itemprop(html, name) {
  for (const re of attrRegex("itemprop", name)) {
    const m = html.match(re);
    if (m && m[1].trim()) return decodeEntities(m[1].trim());
  }
  const m = html.match(new RegExp(`itemprop=["']${name}["'][^>]*content=["']([^"']+)["']`, "i"));
  return m ? decodeEntities(m[1]) : null;
}

/** Preis in Maschinenformat, z. B. "1299.00" oder 1299 */
function machinePrice(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v >= 0 ? Math.round(v * 100) / 100 : null;
  const s = String(v).trim();
  // manche Shops liefern trotzdem "1.299,00"
  if (/,\d{1,2}$/.test(s)) return humanPrice(s);
  const n = Number(s.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n >= 0 && s.replace(/[^\d]/g, "") !== "" ? Math.round(n * 100) / 100 : null;
}

/** Preis im deutschen Anzeigeformat, z. B. "1.299,00 €" oder "49,99€" */
function humanPrice(v) {
  let s = String(v).replace(/[^\d.,]/g, "");
  if (!s) return null;
  const lastComma = s.lastIndexOf(","), lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function decodeEntities(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}

function clean(s) {
  if (!s) return null;
  const t = decodeEntities(String(s)).replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  return t || null;
}
