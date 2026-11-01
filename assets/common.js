// Gemeinsame Helfer für Admin- und Teilen-Ansicht

const cfg = { ...(window.WISHLIST_CONFIG || {}) };
// Toleriert versehentlich mitkopierte Pfade wie ".../rest/v1/" und Leerzeichen
cfg.supabaseUrl = String(cfg.supabaseUrl || "").trim().replace(/\/(rest|auth|storage)\/v1\/?.*$/, "").replace(/\/+$/, "");
cfg.supabaseAnonKey = String(cfg.supabaseAnonKey || "").trim();

export const isConfigured = Boolean(
  cfg.supabaseUrl &&
    cfg.supabaseAnonKey &&
    !cfg.supabaseUrl.includes("DEIN-PROJEKT") &&
    !cfg.supabaseAnonKey.includes("DEIN-ANON-KEY")
);

export const sb = isConfigured
  ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey)
  : null;

export const BUCKET = "wishlist-images";
export const PRICE_FUNCTION = "product-info";

// ---------------------------------------------------------------------
//  Text & Zahlen
// ---------------------------------------------------------------------

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
}

const priceFmt = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
export function formatPrice(price) {
  if (price === null || price === undefined || price === "") return "";
  return priceFmt.format(Number(price));
}

/** Akzeptiert "12,99", "12.99", "1.299,00", "1299", "12,99 €" */
export function parsePrice(input) {
  let s = String(input ?? "").replace(/[\s€]/g, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
  return Number(s);
}

/** "Stand 01.11." bzw. "Stand heute" */
export function priceStamp(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Preis von heute";
  return `Preis vom ${d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })}.`;
}

/** Nur http(s)-Links zulassen, sonst null */
export function safeUrl(url) {
  try {
    const u = new URL(String(url).trim());
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function imageUrl(path) {
  if (!path) return null;
  return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/**
 * Ruft die Edge Function "product-info" auf.
 * Fehler bekommen .missing = true, wenn die Funktion (noch) nicht eingerichtet ist.
 */
export async function callPriceFunction(body) {
  const { data, error } = await sb.functions.invoke(PRICE_FUNCTION, { body });
  if (!error) return data;
  const status = error.context?.status;
  let code = "";
  try { code = (await error.context.json()).error || ""; } catch { /* keine JSON-Antwort */ }
  const err = new Error(code || error.message);
  err.code = code;
  err.missing = (status === 404 && !code) || error.name === "FunctionsFetchError" || error.name === "FunctionsRelayError";
  throw err;
}

// ---------------------------------------------------------------------
//  Anlässe & Countdown
// ---------------------------------------------------------------------

export const OCCASIONS = {
  birthday: { label: "Geburtstag", emoji: "🎂" },
  christmas: { label: "Weihnachten", emoji: "🎄" },
  other: { label: "Sonstiger Anlass", emoji: "🎁" },
};

export function occasionOf(person) {
  return OCCASIONS[person.theme] ? person.theme : "other";
}

function parseDate(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return y && m && d ? new Date(y, m - 1, d) : null;
}

const DAY = 24 * 60 * 60 * 1000;
const startOfToday = () => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; };

/** Nächster Termin: Weihnachten = 24.12., Geburtstag = jährlich wiederkehrend */
export function nextEvent(person) {
  const today = startOfToday();
  const theme = occasionOf(person);
  if (theme === "christmas") {
    let d = new Date(today.getFullYear(), 11, 24);
    if (d < today) d = new Date(today.getFullYear() + 1, 11, 24);
    return { date: d };
  }
  const base = parseDate(person.event_date);
  if (!base) return null;
  if (theme === "birthday") {
    let d = new Date(today.getFullYear(), base.getMonth(), base.getDate());
    if (d < today) d = new Date(today.getFullYear() + 1, base.getMonth(), base.getDate());
    // Jahr in der Vergangenheit = Geburtsdatum → Alter anzeigen
    const age = base.getFullYear() < today.getFullYear() ? d.getFullYear() - base.getFullYear() : null;
    return { date: d, age: age > 0 && age < 130 ? age : null };
  }
  return base >= today ? { date: base } : null;
}

export function countdownText(person) {
  const ev = nextEvent(person);
  if (!ev) return null;
  const days = Math.round((ev.date - startOfToday()) / DAY);
  if (days === 0) return "Heute ist der große Tag! 🎉";
  if (days === 1) return "Morgen ist es so weit!";
  return `Noch ${days} Tage`;
}

export function ageText(person) {
  const ev = nextEvent(person);
  return ev?.age ? `${person.name} wird ${ev.age}` : null;
}

export function eventDateText(person) {
  const ev = nextEvent(person);
  return ev ? ev.date.toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "long" }) : null;
}

// ---------------------------------------------------------------------
//  Bilder
// ---------------------------------------------------------------------

/** Verkleinert Bilder auf max. 1200 px und speichert sie als JPEG (spart Speicher & Ladezeit) */
export async function compressImage(fileOrBlob, maxSize = 1200, quality = 0.85) {
  const src = URL.createObjectURL(fileOrBlob);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = src;
    });
    const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob) throw new Error("Bild konnte nicht umgewandelt werden");
    return blob;
  } finally {
    URL.revokeObjectURL(src);
  }
}

export async function dataUrlToBlob(dataUrl) {
  return (await fetch(dataUrl)).blob();
}

// ---------------------------------------------------------------------
//  Oberfläche
// ---------------------------------------------------------------------

let toastTimer;
export function toast(message, type = "info") {
  const box = document.getElementById("toast");
  if (!box) return alert(message);
  box.textContent = message;
  box.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (box.className = "toast"), 4200);
}

export function placeholder(person) {
  return `<span class="ph" aria-hidden="true">${person ? OCCASIONS[occasionOf(person)].emoji : "🎁"}</span>`;
}

export function renderNotConfigured(container) {
  container.innerHTML = `
    <section class="card narrow">
      <h1>Fast geschafft 🎁</h1>
      <p>Die App ist noch nicht mit Supabase verbunden.</p>
      <p>Trage in <code>assets/config.js</code> deine <strong>Project URL</strong> und den
      <strong>anon / publishable Key</strong> ein. Die vollständige Anleitung steht in der
      <code>README.md</code>.</p>
    </section>`;
}
