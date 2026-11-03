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

/** Farbvariante (aktuell nur beim Geburtstag: "pink" oder "green") */
export function paletteOf(person) {
  return person.palette === "green" ? "green" : "pink";
}

/** data-Attribute für Anlass + Farbe, z. B. für Kopfbereich oder Karten */
export function themeAttrs(person) {
  return `data-occasion="${occasionOf(person)}" data-palette="${paletteOf(person)}"`;
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

/** Schwebende Deko-Symbole im Kopfbereich, passend zum Anlass */
const DECO = {
  birthday: ["🎈", "🎉", "✨", "🎈", "🧁", "⭐"],
  "birthday-green": ["🎈", "🎉", "⭐", "🎈", "🚀", "✨"],
  christmas: ["❄️", "⭐", "❄️", "🎁", "✨", "❄️"],
  other: ["✨", "💝", "🎀", "✨", "💫", "🎁"],
};
const DECO_POS = [
  [6, 14, "2rem", -12, 5.5], [88, 10, "2.2rem", 10, 6.5], [12, 70, "1.5rem", 8, 7],
  [80, 66, "1.7rem", -10, 6], [30, 6, "1.2rem", 15, 8], [64, 82, "1.3rem", -8, 7.5],
];
export function decoHtml(occasion, palette = "pink") {
  const set = DECO[`${occasion}-${palette}`] || DECO[occasion] || DECO.other;
  const floating = DECO_POS.map(([x, y, s, r, d], i) =>
    `<span style="left:${x}%;top:${y}%;--s:${s};--r:${r}deg;--d:${d}s;--delay:-${i * 0.9}s">${set[i]}</span>`).join("");
  return `<div class="deco" aria-hidden="true">${floating}</div>${occasion === "christmas" ? XMAS_SCENE : ""}`;
}

/** Weihnachtsszene: geschmückter Tannenbaum + kleiner Baum + Schneehügel */
const TREE = (id, star = true) => `
  <svg class="${id}" viewBox="0 0 120 160" aria-hidden="true">
    <rect x="52" y="132" width="16" height="22" rx="3" fill="#8b5a2b"/>
    <path d="M60 18 L104 76 H84 L112 112 H88 L116 142 H4 L32 112 H8 L36 76 H16 Z" fill="#5fbf7f"/>
    <path d="M60 18 L104 76 H84 L112 112 H88 L116 142 H60 Z" fill="#43a463"/>
    <path d="M30 76 Q60 92 92 74 M22 112 Q60 128 100 110" stroke="#fff7d6" stroke-width="3" fill="none" stroke-linecap="round" opacity=".9"/>
    <circle cx="44" cy="92" r="5.5" fill="#ff5a5a"/><circle cx="76" cy="62" r="5" fill="#ffd23f"/>
    <circle cx="70" cy="98" r="5.5" fill="#4cc9f0"/><circle cx="38" cy="128" r="6" fill="#ffd23f"/>
    <circle cx="86" cy="126" r="6" fill="#ff5a5a"/><circle cx="56" cy="118" r="5" fill="#b388ff"/>
    ${star ? `<path class="xmas-star" d="M60 2 l5 11 12 1.5 -9 8 2.5 12 -10.5 -6 -10.5 6 2.5 -12 -9 -8 12 -1.5z" fill="#ffd23f" stroke="#fff3b0" stroke-width="1.5"/>` : ""}
  </svg>`;
const XMAS_SCENE = `
  <div class="xmas-scene" aria-hidden="true">
    ${TREE("xmas-tree")}
    ${TREE("xmas-tree small", false)}
    <svg class="xmas-snow" viewBox="0 0 400 40" preserveAspectRatio="none">
      <path d="M0 22 Q50 6 100 18 T200 16 T300 20 T400 12 V40 H0 Z" fill="#ffffff"/>
    </svg>
  </div>`;

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Konfettikanone: schießt aus beiden unteren Ecken Konfetti im Bogen nach oben,
 * das anschließend flatternd herunterrieselt (Canvas, ~4 Sekunden).
 */
export function confettiCannon() {
  if (reducedMotion()) return;
  const canvas = document.createElement("canvas");
  canvas.className = "confetti-canvas";
  canvas.setAttribute("aria-hidden", "true");
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = window.innerWidth, H = window.innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.scale(dpr, dpr);

  const colors = ["#ff7a59", "#ffd23f", "#4cc9f0", "#f72585", "#7bd389", "#b388ff", "#ffffff"];
  const parts = [];
  const narrow = W < 700;

  function shoot(fromLeft, count) {
    const x0 = fromLeft ? -10 : W + 10;
    for (let i = 0; i < count; i++) {
      // Steigung: auf dem Handy steiler, am Computer flacher Richtung Mitte
      const deg = narrow ? 66 + Math.random() * 18 : 48 + Math.random() * 24;
      const angle = deg * (Math.PI / 180);
      // Gewünschte Steighöhe (55–92 % des Bildschirms) -> nötige Startgeschwindigkeit
      const rise = H * (0.55 + Math.random() * 0.37);
      const vy = Math.sqrt(2 * 0.38 * rise) * 1.06; // 1.06 gleicht den Luftwiderstand aus
      const vx = (vy / Math.tan(angle)) * (fromLeft ? 1 : -1);
      parts.push({
        x: x0, y: H + 10,
        vx, vy: -vy,
        size: 7 + Math.random() * 7,
        color: colors[(Math.random() * colors.length) | 0],
        shape: Math.random() < 0.3 ? "circle" : Math.random() < 0.5 ? "strip" : "rect",
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.4,
        flip: Math.random() * Math.PI * 2,
        vflip: 0.08 + Math.random() * 0.12,
      });
    }
  }
  shoot(true, 90);
  shoot(false, 90);
  setTimeout(() => { shoot(true, 50); shoot(false, 50); }, 280);

  const start = performance.now();
  function frame(now) {
    const t = now - start;
    ctx.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.vy += 0.38;            // Schwerkraft
      p.vx *= 0.985;           // Luftwiderstand
      p.vy *= p.vy > 0 ? 0.94 : 0.99; // beim Fallen langsamer -> rieseln
      p.x += p.vx + Math.sin(p.flip) * 0.6;
      p.y += p.vy;
      p.rot += p.vr;
      p.flip += p.vflip;
      const scaleY = Math.abs(Math.cos(p.flip)); // Flattern
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.scale(1, Math.max(scaleY, 0.15));
      ctx.globalAlpha = t > 3400 ? Math.max(0, 1 - (t - 3400) / 700) : 1;
      ctx.fillStyle = p.color;
      if (p.shape === "circle") {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2.4, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.shape === "strip") {
        ctx.fillRect(-p.size / 5, -p.size, p.size / 2.5, p.size * 2);
      } else {
        ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size / 1.5);
      }
      ctx.restore();
    }
    if (t < 4100) requestAnimationFrame(frame);
    else canvas.remove();
  }
  requestAnimationFrame(frame);
}

const CELEBRATE_LINES = {
  birthday: ["Das wird ein Geburtstag zum Strahlen! 🎂", "Da wird beim Auspacken gejubelt! 🎈"],
  christmas: ["Das wird ein wunderschönes Fest! 🎄", "Da leuchten unterm Baum die Augen! ✨"],
  other: ["Das wird ein Moment zum Strahlen! ✨", "Da wird beim Auspacken gejubelt! 🎉"],
};

/** Feier-Karte + Konfettikanone nach erfolgreichem "Besorge ich" */
export function celebrate({ recipient, title, occasion = "other", palette = "pink", preview = false }) {
  document.querySelector(".celebrate")?.remove();
  const lines = CELEBRATE_LINES[occasion] || CELEBRATE_LINES.other;
  const extra = lines[(Math.random() * lines.length) | 0];
  const emoji = OCCASIONS[occasion]?.emoji || "🎁";

  const overlay = document.createElement("div");
  overlay.className = "celebrate";
  overlay.dataset.occasion = occasion;
  overlay.dataset.palette = palette;
  overlay.setAttribute("role", "alertdialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "celebrate-title");
  overlay.innerHTML = `
    <div class="celebrate-card">
      <div class="celebrate-emoji" aria-hidden="true">${emoji}</div>
      <p class="celebrate-hi">Herzlichen Dank! 💛</p>
      <h2 id="celebrate-title">Du wirst große Freude bereiten!</h2>
      <p class="celebrate-text">${esc(recipient)} wird sich riesig über <strong>„${esc(title)}“</strong> freuen.</p>
      <p class="celebrate-extra">${esc(extra)}</p>
      <button type="button" class="btn primary big block" data-close-celebrate><span class="emo">🥳</span> Juhu!</button>
      <p class="celebrate-note">${preview
        ? "🧪 Nur Vorschau – es wurde nichts reserviert."
        : "Der Wunsch ist jetzt für dich reserviert – niemand sonst kann ihn mehr auswählen."}</p>
    </div>`;
  document.body.appendChild(overlay);

  const prevFocus = document.activeElement;
  const close = () => {
    overlay.classList.add("closing");
    document.removeEventListener("keydown", onKey);
    setTimeout(() => overlay.remove(), 220);
    prevFocus?.focus?.();
  };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay || e.target.closest("[data-close-celebrate]")) close();
  });
  document.addEventListener("keydown", onKey);
  overlay.querySelector("[data-close-celebrate]").focus({ preventScroll: true });

  navigator.vibrate?.([30, 40, 60]); // kleines "Plopp" auf Android
  confettiCannon();
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
