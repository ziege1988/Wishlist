// Gemeinsame Helfer für Admin- und Teilen-Ansicht

const cfg = window.WISHLIST_CONFIG || {};

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

let toastTimer;
export function toast(message, type = "info") {
  const box = document.getElementById("toast");
  if (!box) return alert(message);
  box.textContent = message;
  box.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (box.className = "toast"), 3800);
}

export function placeholderSvg() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20 7h-2.2A3 3 0 0 0 12 3.8 3 3 0 0 0 6.2 7H4a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8h1a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1Zm-5-2a1 1 0 1 1 0 2h-2a1 1 0 0 1 2-2Zm-6 0a1 1 0 0 1 1 1v1H9a1 1 0 0 1 0-2Zm2 15H7v-8h4v8Zm0-10H5V9h6v1Zm6 10h-4v-8h4v8Zm2-10h-6V9h6v1Z"/></svg>`;
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
