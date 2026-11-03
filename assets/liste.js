// Teilen-Ansicht für Schenkende (ohne Anmeldung)
import {
  sb, isConfigured, esc, formatPrice, priceStamp, safeUrl, hostOf, imageUrl,
  toast, placeholder, renderNotConfigured, callPriceFunction,
  OCCASIONS, occasionOf, countdownText, ageText, eventDateText, decoHtml, celebrate, paletteOf,
} from "./common.js";

const app = document.getElementById("app");
const token = new URLSearchParams(location.search).get("t") || "";
const REFRESH_MS = 20000;

const STORE_CLAIMS = "wishlist.myClaims";   // itemId -> Geheimnis zum Aufheben
const STORE_NAME = "wishlist.myName";
const STORE_HIDE = "wishlist.hideClaimed";

let list = null;
let hideClaimed = readStore(STORE_HIDE, false);
let claimingItem = null;
let refreshTimer = null;
let pricesChecked = false;

// localStorage kann (z. B. im privaten Modus) fehlen – dann eben ohne Merken
function readStore(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}
function writeStore(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* ignorieren */ }
}
const myClaims = () => readStore(STORE_CLAIMS, {});

function renderMissing() {
  document.title = "Wunschliste nicht gefunden";
  app.innerHTML = `
    <section class="card narrow" style="text-align:center">
      <p style="font-size:2.6rem;margin:0">🤔</p>
      <h1>Liste nicht gefunden</h1>
      <p class="muted">Der Link ist unvollständig oder nicht mehr gültig.
        Bitte frag nach dem aktuellen Link.</p>
    </section>`;
}

async function load({ quiet = false } = {}) {
  const { data, error } = await sb.rpc("get_shared_list", { p_token: token });
  if (error) {
    if (!quiet) app.innerHTML = `<p class="loading">Die Liste konnte nicht geladen werden. Bitte später erneut versuchen.</p>`;
    return;
  }
  if (!data) return renderMissing();
  list = data;
  cleanupMyClaims();
  render();
  if (!pricesChecked) checkPrices();
}

/** Einmal pro Aufruf: veraltete Preise im Hintergrund aktualisieren lassen */
async function checkPrices() {
  pricesChecked = true;
  if (!list.items.some((i) => i.url && !i.claimed)) return;
  try {
    const r = await callPriceFunction({ token });
    if (r?.changed > 0) load({ quiet: true });
  } catch { /* Funktion nicht eingerichtet oder Shop nicht erreichbar */ }
}

/** Lokal gemerkte Reservierungen entfernen, die es nicht mehr gibt */
function cleanupMyClaims() {
  const mine = myClaims();
  const claimedIds = new Set(list.items.filter((i) => i.claimed).map((i) => i.id));
  const listIds = new Set(list.items.map((i) => i.id));
  let changed = false;
  for (const id of Object.keys(mine)) {
    if (listIds.has(id) && !claimedIds.has(id)) {
      delete mine[id];
      changed = true;
    }
  }
  if (changed) writeStore(STORE_CLAIMS, mine);
}

function render() {
  const mine = myClaims();
  const items = list.items;
  const occ = occasionOf(list);
  const open = items.filter((i) => !i.claimed);
  const taken = items.filter((i) => i.claimed);
  const mineCount = taken.filter((i) => mine[i.id]).length;
  const pct = items.length ? Math.round((taken.length / items.length) * 100) : 0;
  const countdown = countdownText(list);
  const age = ageText(list);
  const dateText = eventDateText(list);

  document.title = `Wunschliste für ${list.name}`;
  document.body.dataset.occasion = occ;
  document.body.dataset.palette = paletteOf(list);

  app.innerHTML = `
    <section class="hero center">
      ${decoHtml(occ, paletteOf(list))}
      <div class="hero-emoji">${OCCASIONS[occ].emoji}</div>
      <div class="kicker">${esc(list.occasion || OCCASIONS[occ].label)}</div>
      <h1>Wunschliste für ${esc(list.name)}</h1>
      ${countdown || age || dateText ? `
        <div class="chips">
          ${countdown ? `<span class="chip">⏳ ${esc(countdown)}</span>` : ""}
          ${dateText ? `<span class="chip">📅 ${esc(dateText)}</span>` : ""}
          ${age ? `<span class="chip">🎈 ${esc(age)}</span>` : ""}
        </div>` : ""}
      ${items.length
        ? `<div class="progress" aria-hidden="true"><div style="width:${pct}%"></div></div>
           <p class="progress-text">
             ${taken.length} von ${items.length} ${items.length === 1 ? "Wunsch ist" : "Wünschen sind"} schon vergeben
             ${mineCount ? ` · davon ${mineCount} von dir` : ""}
           </p>`
        : ""}
    </section>

    ${items.length === 0
      ? `<div class="card empty"><p class="big">${OCCASIONS[occ].emoji}</p>Hier stehen noch keine Wünsche. Schau später nochmal vorbei!</div>`
      : `
        <div class="toolbar share">
          <p class="tip"><span class="emo">💡</span><span>Tippe auf <strong>„Besorge ich“</strong>, damit nichts doppelt geschenkt wird.</span></p>
          ${taken.length ? `
            <label class="check small">
              <input type="checkbox" id="hide-claimed" ${hideClaimed ? "checked" : ""}> Vergebene ausblenden
            </label>` : ""}
        </div>
        ${open.length
          ? `<div class="item-grid">${open.map((i) => itemCard(i, mine)).join("")}</div>`
          : `<div class="card empty"><p class="big">🎉</p>Alle Wünsche sind schon vergeben!</div>`}
        ${taken.length && !hideClaimed
          ? `<h2 class="section-title">Schon vergeben</h2>
             <div class="item-grid">${taken.map((i) => itemCard(i, mine)).join("")}</div>`
          : ""}`}

    <p class="muted small footer-note">
      Die Liste aktualisiert sich automatisch. Eine Reservierung kannst du nur auf diesem Gerät wieder aufheben.
    </p>`;
}

function itemCard(item, mine) {
  const img = imageUrl(item.image_path);
  const url = safeUrl(item.url);
  const isMine = item.claimed && mine[item.id];

  let claimArea;
  if (isMine) {
    claimArea = `
      <span class="claim-badge mine">✓ Du besorgst das</span>
      <div class="actions"><button class="btn sm" data-action="unclaim" data-id="${item.id}"><span class="emo">↩️</span> Doch nicht</button></div>`;
  } else if (item.claimed) {
    claimArea = `<span class="claim-badge">🎁 Besorgt ${esc(item.claimer_name)}</span>`;
  } else {
    claimArea = `<div class="actions"><button class="btn primary block big" data-action="claim" data-id="${item.id}"><span class="emo">🎁</span> Besorge ich</button></div>`;
  }

  return `
    <article class="item ${item.claimed ? "claimed" : ""} ${isMine ? "mine" : ""}">
      ${item.favorite ? `<span class="fav-badge">❤️ Herzenswunsch</span>` : ""}
      <div class="img">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : placeholder(list)}${item.claimed ? `<span class="sold-overlay ${isMine ? "mine" : ""}">${isMine ? "Besorgst du" : "Gekauft"}</span>` : ""}</div>
      <div class="body">
        <h3>${esc(item.title)}</h3>
        ${item.price !== null ? `<div class="price-row"><span class="price">${formatPrice(item.price)}</span>
          ${item.price_updated_at ? `<span class="stamp">${esc(priceStamp(item.price_updated_at))}</span>` : ""}</div>` : ""}
        ${url ? `<a class="shop" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Zum Produkt bei ${esc(hostOf(url))} ↗</a>` : ""}
        ${item.note ? `<div class="note">${esc(item.note)}</div>` : ""}
        ${claimArea}
      </div>
    </article>`;
}

// ---------------------------------------------------------------------
//  Reservieren / Aufheben
// ---------------------------------------------------------------------

const claimDialog = document.getElementById("claim-dialog");
const claimForm = document.getElementById("claim-form");
const claimSubmit = document.getElementById("claim-submit");

function setup() {
  app.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const item = list?.items.find((i) => i.id === el.dataset.id);
    if (!item) return;
    if (el.dataset.action === "claim") openClaim(item);
    if (el.dataset.action === "unclaim") unclaim(item, el);
  });

  app.addEventListener("change", (e) => {
    if (e.target.id === "hide-claimed") {
      hideClaimed = e.target.checked;
      writeStore(STORE_HIDE, hideClaimed);
      render();
    }
  });

  claimDialog.querySelector("[data-close]").addEventListener("click", () => claimDialog.close());
  claimForm.addEventListener("submit", submitClaim);

  // Regelmäßig aktualisieren – nur wenn die Seite sichtbar ist
  const schedule = () => {
    clearInterval(refreshTimer);
    if (document.visibilityState === "visible") {
      refreshTimer = setInterval(() => {
        if (!claimDialog.open) load({ quiet: true });
      }, REFRESH_MS);
    }
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") load({ quiet: true });
    schedule();
  });
  schedule();
}

function openClaim(item) {
  claimingItem = item;
  document.getElementById("claim-item-title").textContent =
    item.title + (item.price !== null ? ` · ${formatPrice(item.price)}` : "");
  claimForm.elements.claimer.value = readStore(STORE_NAME, "");
  claimDialog.showModal();
  claimForm.elements.claimer.focus();
}

async function submitClaim(e) {
  e.preventDefault();
  const name = claimForm.elements.claimer.value.trim();
  if (!name) return toast("Bitte gib deinen Namen ein.", "error");

  claimSubmit.disabled = true;
  const { data: secret, error } = await sb.rpc("claim_item", {
    p_token: token,
    p_item_id: claimingItem.id,
    p_name: name,
  });
  claimSubmit.disabled = false;
  claimDialog.close();
  writeStore(STORE_NAME, name);

  if (error) {
    if (/already_claimed/.test(error.message)) {
      toast("Zu spät – das besorgt gerade schon jemand anderes.", "error");
    } else if (/not_found/.test(error.message)) {
      toast("Diesen Wunsch gibt es nicht mehr.", "error");
    } else {
      toast("Das hat nicht geklappt. Bitte nochmal versuchen.", "error");
    }
    return load({ quiet: true });
  }

  const mine = myClaims();
  mine[claimingItem.id] = secret;
  writeStore(STORE_CLAIMS, mine);
  celebrate({ recipient: list.name, title: claimingItem.title, occasion: occasionOf(list), palette: paletteOf(list) });
  load({ quiet: true });
}

async function unclaim(item, button) {
  const secret = myClaims()[item.id];
  if (!secret) return;
  if (!confirm(`Reservierung für „${item.title}“ aufheben?\nDer Wunsch ist dann wieder für alle verfügbar.`)) return;

  button.disabled = true;
  const { data: ok, error } = await sb.rpc("unclaim_item", {
    p_token: token,
    p_item_id: item.id,
    p_secret: secret,
  });
  if (error || !ok) {
    button.disabled = false;
    toast("Die Reservierung konnte nicht aufgehoben werden.", "error");
    return load({ quiet: true });
  }
  const mine = myClaims();
  delete mine[item.id];
  writeStore(STORE_CLAIMS, mine);
  toast("Reservierung aufgehoben.", "success");
  load({ quiet: true });
}

// ---------------------------------------------------------------------
//  Start (am Ende, damit alle Konstanten initialisiert sind)
// ---------------------------------------------------------------------

if (!isConfigured) {
  renderNotConfigured(app);
} else if (!/^[0-9a-f-]{36}$/i.test(token)) {
  renderMissing();
} else {
  setup();
  load();
}
