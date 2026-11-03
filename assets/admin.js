// Admin-Bereich: Personen und Wünsche verwalten
import {
  sb, isConfigured, esc, formatPrice, parsePrice, priceStamp, safeUrl, hostOf, imageUrl,
  toast, placeholder, renderNotConfigured, compressImage, dataUrlToBlob, callPriceFunction,
  OCCASIONS, occasionOf, countdownText, ageText, eventDateText, decoHtml, paletteOf, themeAttrs, BUCKET,
} from "./common.js";

const app = document.getElementById("app");
const userbox = document.getElementById("userbox");

let session = null;
let recoveryMode = false;
let routeSeq = 0;
const state = { person: null, items: [], claims: {} };
const autoRefreshed = new Set(); // Preise je Liste nur einmal pro Sitzung automatisch prüfen

const NOT_SET_UP = "Das automatische Laden ist noch nicht eingerichtet (siehe Anleitung „Preise automatisch“).";

// ---------------------------------------------------------------------
//  Start & Routing
// ---------------------------------------------------------------------

async function init() {
  const { data } = await sb.auth.getSession();
  session = data.session;

  sb.auth.onAuthStateChange((event, newSession) => {
    const userChanged = newSession?.user?.id !== session?.user?.id;
    session = newSession;
    if (event === "PASSWORD_RECOVERY") recoveryMode = true;
    // Supabase empfiehlt, im Callback keine weiteren Supabase-Aufrufe direkt auszuführen
    if (userChanged || event === "PASSWORD_RECOVERY") setTimeout(route, 0);
  });

  window.addEventListener("hashchange", route);
  app.addEventListener("click", onAppClick);
  app.addEventListener("change", onAppChange);
  app.addEventListener("submit", onAppSubmit);
  app.addEventListener("focusin", (e) => {
    if (e.target.matches("[data-select-on-focus]")) e.target.select();
  });
  setupDialogs();
  route();
}

function route() {
  renderUserbox();
  if (recoveryMode) return renderRecovery();
  if (!session) return renderLogin();
  const match = location.hash.match(/^#\/p\/([0-9a-f-]{36})$/i);
  if (match) showPerson(match[1]);
  else showOverview();
}

function renderUserbox() {
  userbox.innerHTML = session && !recoveryMode
    ? `<span class="email">${esc(session.user.email)}</span>
       <button class="btn sm" data-action="logout">Abmelden</button>`
    : "";
  userbox.querySelector("[data-action=logout]")?.addEventListener("click", async () => {
    await sb.auth.signOut();
    location.hash = "#/";
  });
}

function loading() {
  app.innerHTML = `<p class="loading">Lädt …</p>`;
}

function friendlyError(error) {
  const msg = error?.message || String(error);
  if (/invalid login credentials/i.test(msg)) return "E-Mail oder Passwort ist falsch.";
  if (/email not confirmed/i.test(msg)) return "Die E-Mail-Adresse ist noch nicht bestätigt.";
  if (/password should be at least/i.test(msg)) return "Das Passwort ist zu kurz.";
  if (/failed to fetch|network/i.test(msg)) return "Keine Verbindung zum Server.";
  if (/column .* does not exist|could not find the .* column/i.test(msg)) {
    return "Die Datenbank ist noch nicht auf dem neuesten Stand – bitte supabase/schema.sql erneut im SQL Editor ausführen.";
  }
  return msg;
}

// ---------------------------------------------------------------------
//  Login & Passwort zurücksetzen
// ---------------------------------------------------------------------

function renderLogin() {
  app.innerHTML = `
    <section class="card narrow">
      <form class="stack" data-form="login">
        <div style="text-align:center">
          <img src="assets/icons/icon-192.png" alt="" width="72" height="72" style="border-radius:20px;box-shadow:var(--shadow)">
          <h1 style="margin-top:12px">Willkommen</h1>
          <p class="muted" style="margin:0">Melde dich an, um deine Wunschlisten zu verwalten.</p>
        </div>
        <label class="field">E-Mail
          <input type="email" name="email" required autocomplete="username">
        </label>
        <label class="field">Passwort
          <input type="password" name="password" required autocomplete="current-password">
        </label>
        <button class="btn primary block big" type="submit"><span class="emo">🔑</span> Anmelden</button>
        <button class="btn ghost sm block" type="button" data-action="forgot">Passwort vergessen?</button>
      </form>
    </section>`;
}

function renderRecovery() {
  app.innerHTML = `
    <section class="card narrow">
      <form class="stack" data-form="recovery">
        <h1>Neues Passwort</h1>
        <label class="field">Neues Passwort
          <input type="password" name="password" required minlength="8" autocomplete="new-password">
        </label>
        <button class="btn primary block" type="submit">Passwort speichern</button>
      </form>
    </section>`;
}

async function doLogin(form) {
  const fd = new FormData(form);
  const btn = form.querySelector("[type=submit]");
  btn.disabled = true;
  const { error } = await sb.auth.signInWithPassword({
    email: String(fd.get("email")).trim(),
    password: String(fd.get("password")),
  });
  btn.disabled = false;
  if (error) toast(friendlyError(error), "error");
}

async function doForgot() {
  const email = app.querySelector("input[name=email]")?.value.trim();
  if (!email) return toast("Bitte zuerst die E-Mail-Adresse eintragen.", "error");
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: location.origin + location.pathname,
  });
  if (error) return toast(friendlyError(error), "error");
  toast("Falls ein Konto existiert, ist eine E-Mail unterwegs.", "success");
}

async function doRecovery(form) {
  const password = String(new FormData(form).get("password"));
  const { error } = await sb.auth.updateUser({ password });
  if (error) return toast(friendlyError(error), "error");
  recoveryMode = false;
  history.replaceState(null, "", location.pathname + "#/");
  toast("Passwort gespeichert.", "success");
  route();
}

// ---------------------------------------------------------------------
//  Übersicht: alle Personen
// ---------------------------------------------------------------------

async function showOverview() {
  const seq = ++routeSeq;
  loading();
  const [personsRes, itemsRes] = await Promise.all([
    sb.from("persons").select("*").order("created_at", { ascending: true }),
    sb.from("items").select("id, person_id"),
  ]);
  if (seq !== routeSeq) return;
  if (personsRes.error || itemsRes.error) {
    app.innerHTML = `<p class="loading">Fehler beim Laden: ${esc(friendlyError(personsRes.error || itemsRes.error))}</p>`;
    return;
  }

  const counts = {};
  for (const it of itemsRes.data) counts[it.person_id] = (counts[it.person_id] || 0) + 1;
  const persons = personsRes.data;

  app.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Deine Wunschlisten</h1>
        <p class="muted">Jede Person hat ihre eigene Liste, die du per Link teilen kannst.</p>
      </div>
      <button class="btn primary big" data-action="new-person"><span class="emo">✨</span> Neue Wunschliste</button>
    </div>
    ${persons.length === 0
      ? `<div class="card empty">
           <p class="big">🎁</p>
           <p>Noch keine Wunschliste angelegt.<br>Leg los mit der ersten!</p>
           <button class="btn primary big" data-action="new-person"><span class="emo">✨</span> Neue Wunschliste</button>
         </div>`
      : `<div class="person-grid">
           ${persons.map((p) => personCard(p, counts[p.id] || 0)).join("")}
           <button class="add-card" data-action="new-person"><span class="plus">+</span>Neue Wunschliste</button>
         </div>`}`;
}

function personCard(p, count) {
  const occ = occasionOf(p);
  const countdown = countdownText(p);
  return `
    <a class="person-card" href="#/p/${p.id}" ${themeAttrs(p)}>
      <div class="banner"><div class="avatar">${OCCASIONS[occ].emoji}</div></div>
      <div class="content">
        <h3>${esc(p.name)}</h3>
        <div class="meta">${esc(p.occasion || OCCASIONS[occ].label)}</div>
        <div class="foot">
          <span class="muted">${wishCount(count)}</span>
          ${countdown ? `<span class="pill">⏳ ${esc(countdown)}</span>` : ""}
        </div>
      </div>
    </a>`;
}

function wishCount(n) {
  return n === 1 ? "1 Wunsch" : `${n} Wünsche`;
}

// ---------------------------------------------------------------------
//  Detail: eine Person / Liste
// ---------------------------------------------------------------------

async function showPerson(id, { silent = false } = {}) {
  const seq = ++routeSeq;
  if (!silent) loading();

  const { data: person, error } = await sb.from("persons").select("*").eq("id", id).maybeSingle();
  if (seq !== routeSeq) return;
  if (error || !person) {
    app.innerHTML = `
      <a class="back" href="#/">← Alle Wunschlisten</a>
      <p class="loading">${error ? esc(friendlyError(error)) : "Diese Liste gibt es nicht (mehr)."}</p>`;
    return;
  }

  const { data: items, error: itemsError } = await sb
    .from("items")
    .select("*")
    .eq("person_id", id)
    .order("favorite", { ascending: false })
    .order("created_at", { ascending: true });
  if (seq !== routeSeq) return;
  if (itemsError) return toast(friendlyError(itemsError), "error");

  // Reservierungen sind per Datenbank-Regel nur sichtbar, wenn der Überraschungsmodus aus ist
  const claims = {};
  if (!person.surprise_mode && items.length) {
    const { data } = await sb
      .from("claims")
      .select("item_id, claimer_name, created_at")
      .in("item_id", items.map((i) => i.id));
    if (seq !== routeSeq) return;
    for (const c of data || []) claims[c.item_id] = c;
  }

  Object.assign(state, { person, items, claims });
  renderPerson();
  backgroundPriceRefresh(person);
}

/** Prüft beim Öffnen einmal still, ob sich Preise geändert haben */
async function backgroundPriceRefresh(person) {
  if (autoRefreshed.has(person.id)) return;
  autoRefreshed.add(person.id);
  if (!state.items.some((i) => i.url && i.auto_price)) return;
  try {
    const r = await callPriceFunction({ token: person.share_token });
    if (r?.changed > 0 && state.person?.id === person.id) {
      toast(r.changed === 1 ? "1 Preis wurde aktualisiert." : `${r.changed} Preise wurden aktualisiert.`, "success");
      showPerson(person.id, { silent: true });
    }
  } catch { /* Funktion noch nicht eingerichtet – kein Problem */ }
}

/** Vorschau-Link: gleiche Seite wie für Schenkende, aber nur Anzeige + Simulation */
function listPreviewUrl(person) {
  const u = new URL(`liste.html?t=${person.share_token}&vorschau=1&p=${person.id}`, location.href);
  if (person.surprise_mode) u.searchParams.set("s", "1");
  return u.href;
}

function shareUrl(person) {
  return new URL(`liste.html?t=${person.share_token}`, location.href).href;
}

function renderPerson() {
  const { person, items, claims } = state;
  const occ = occasionOf(person);
  const link = shareUrl(person);
  const total = items.reduce((sum, i) => sum + (i.price ? Number(i.price) : 0), 0);
  const claimedCount = Object.keys(claims).length;
  const countdown = countdownText(person);
  const age = ageText(person);
  const dateText = eventDateText(person);
  const hasLinks = items.some((i) => i.url);
  const waText = `${OCCASIONS[occ].emoji} Hier ist die Wunschliste für ${person.name}${person.occasion ? ` (${person.occasion})` : ""}: ${link}`;

  app.innerHTML = `
    <div ${themeAttrs(person)}>
      <a class="back" href="#/">← Alle Wunschlisten</a>
      <section class="hero">
        ${decoHtml(occ, paletteOf(person))}
        <div class="hero-head">
          <div>
            <div class="hero-emoji">${OCCASIONS[occ].emoji}</div>
            <div class="kicker">${esc(person.occasion || OCCASIONS[occ].label)}</div>
            <h1>${esc(person.name)}</h1>
            <div class="chips">
              ${countdown ? `<span class="chip">⏳ ${esc(countdown)}</span>` : ""}
              ${dateText ? `<span class="chip">📅 ${esc(dateText)}</span>` : ""}
              ${age ? `<span class="chip">🎈 ${esc(age)}</span>` : ""}
            </div>
          </div>
          <div class="hero-actions">
            <button class="btn sm light" data-action="edit-person"><span class="emo">✏️</span> Bearbeiten</button>
            <button class="btn icon light" data-action="delete-person" title="Liste löschen" aria-label="Liste löschen">🗑️</button>
          </div>
        </div>
      </section>

      <div class="panel-grid">
        <section class="card stack">
          <h3>🔗 Liste teilen</h3>
          <p class="muted small" style="margin-top:4px">Schick diesen Link an alle, die etwas schenken möchten.
            Sie brauchen kein Konto und können Wünsche direkt reservieren.</p>
          <div class="share-link">
            <input type="text" readonly value="${esc(link)}" aria-label="Teilen-Link" data-select-on-focus>
            <button class="btn primary" data-action="copy-link"><span class="emo">📋</span> Kopieren</button>
          </div>
          <div class="share-buttons">
            <a class="btn sm" href="https://wa.me/?text=${encodeURIComponent(waText)}" target="_blank" rel="noopener"><span class="emo">💬</span> WhatsApp</a>
            ${navigator.share ? `<button class="btn sm" data-action="native-share"><span class="emo">📤</span> Teilen</button>` : ""}
            <a class="btn sm" href="${esc(listPreviewUrl(person))}"><span class="emo">👀</span> Vorschau</a>
          </div>
          <button class="btn sm ghost" data-action="regen-link" title="Der alte Link funktioniert danach nicht mehr"><span class="emo">🔁</span> Neuen Link erzeugen</button>
        </section>

        <section class="card stack">
          <h3>🤫 Überraschungsmodus</h3>
          <label class="switch">
            <input type="checkbox" data-action="toggle-surprise" ${person.surprise_mode ? "checked" : ""}>
            <span class="track"></span>
            <span>
              <strong>${person.surprise_mode ? "An" : "Aus"}</strong><br>
              <span class="muted small">${person.surprise_mode
                ? "Du siehst hier nicht, was schon gekauft wird. Schenkende sehen es natürlich trotzdem."
                : "Du siehst, welche Wünsche gekauft werden und von wem."}</span>
            </span>
          </label>
        </section>
      </div>

      <div class="toolbar">
        <div class="stats">
          <span class="stat"><strong>${items.length}</strong> ${items.length === 1 ? "Wunsch" : "Wünsche"}</span>
          ${total > 0 ? `<span class="stat">Summe <strong>${formatPrice(total)}</strong></span>` : ""}
          ${!person.surprise_mode ? `<span class="stat"><strong>${claimedCount}</strong> gekauft</span>` : ""}
        </div>
        <div class="row">
          ${hasLinks ? `<button class="btn" data-action="refresh-prices"><span class="emo">🔄</span> Preise aktualisieren</button>` : ""}
          <button class="btn primary big" data-action="new-item"><span class="emo">➕</span> Wunsch hinzufügen</button>
        </div>
      </div>

      ${items.length === 0
        ? `<div class="card empty"><p class="big">${OCCASIONS[occ].emoji}</p><p>Noch keine Wünsche auf dieser Liste.</p>
             <button class="btn primary big" data-action="new-item"><span class="emo">➕</span> Ersten Wunsch hinzufügen</button></div>`
        : `<div class="item-grid">${items.map((i) => adminItemCard(i, claims[i.id])).join("")}</div>`}
    </div>`;
}

function adminItemCard(item, claim) {
  const img = imageUrl(item.image_path);
  const url = safeUrl(item.url);
  return `
    <article class="item ${claim ? "claimed" : ""}">
      ${item.favorite ? `<span class="fav-badge">❤️ Herzenswunsch</span>` : ""}
      <div class="img">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : placeholder(state.person)}${claim ? `<span class="sold-overlay">Gekauft</span>` : ""}</div>
      <div class="body">
        <h3>${esc(item.title)}</h3>
        ${item.price !== null ? `<div class="price-row"><span class="price">${formatPrice(item.price)}</span>
          ${item.url && item.auto_price && item.price_updated_at ? `<span class="stamp">🔄 ${esc(priceStamp(item.price_updated_at))}</span>` : ""}</div>` : ""}
        ${url ? `<a class="shop" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(hostOf(url))} ↗</a>` : ""}
        ${item.note ? `<div class="note">${esc(item.note)}</div>` : ""}
        ${claim ? `<span class="claim-badge">🎁 Besorgt ${esc(claim.claimer_name)}</span>` : ""}
        <div class="actions">
          <button class="btn sm" data-action="edit-item" data-id="${item.id}"><span class="emo">✏️</span> Bearbeiten</button>
          ${claim ? `<button class="btn sm" data-action="release-claim" data-id="${item.id}"><span class="emo">🔓</span> Freigeben</button>` : ""}
          <span class="spacer"></span>
          <button class="btn icon" data-action="delete-item" data-id="${item.id}" title="Wunsch löschen" aria-label="Wunsch löschen">🗑️</button>
        </div>
      </div>
    </article>`;
}

// ---------------------------------------------------------------------
//  Event-Handling (Delegation)
// ---------------------------------------------------------------------

async function onAppClick(e) {
  const el = e.target.closest("[data-action]");
  if (!el || el.tagName === "INPUT") return;
  const id = el.dataset.id;
  switch (el.dataset.action) {
    case "forgot": return doForgot();
    case "new-person": return openPersonDialog();
    case "edit-person": return openPersonDialog(state.person);
    case "delete-person": return deletePerson();
    case "copy-link": return copyLink();
    case "native-share": return nativeShare();
    case "regen-link": return regenerateLink();
    case "refresh-prices": return refreshPrices(el);
    case "new-item": return openItemDialog();
    case "edit-item": return openItemDialog(state.items.find((i) => i.id === id));
    case "delete-item": return deleteItem(id);
    case "release-claim": return releaseClaim(id);
  }
}

function onAppChange(e) {
  if (e.target.matches("[data-action=toggle-surprise]")) toggleSurprise(e.target);
}

function onAppSubmit(e) {
  const form = e.target.closest("[data-form]");
  if (!form) return;
  e.preventDefault();
  if (form.dataset.form === "login") doLogin(form);
  if (form.dataset.form === "recovery") doRecovery(form);
}

function setBusy(btn, busy, label) {
  btn.disabled = busy;
  if (busy) {
    btn.dataset.label = btn.innerHTML;
    btn.innerHTML = `<span class="spin"></span> ${label}`;
  } else if (btn.dataset.label) {
    btn.innerHTML = btn.dataset.label;
  }
}

// ---------------------------------------------------------------------
//  Aktionen: Person
// ---------------------------------------------------------------------

const personDialog = document.getElementById("person-dialog");
const personForm = document.getElementById("person-form");
let editingPerson = null;

function updateEventDateField() {
  const theme = personForm.elements.theme.value;
  document.getElementById("palette-field").hidden = theme !== "birthday";
  personDialog.dataset.occasion = theme;
  personDialog.dataset.palette = personForm.elements.palette.value;
  document.getElementById("event-date-field").hidden = theme === "christmas";
  document.getElementById("event-date-label").textContent = theme === "birthday" ? "Geburtstag" : "Datum";
  document.getElementById("event-date-hint").textContent = theme === "birthday"
    ? "(optional – mit Geburtsjahr zeigen wir auch das Alter)"
    : "(optional – für den Countdown)";
}

function openPersonDialog(person = null) {
  editingPerson = person;
  personForm.reset();
  document.getElementById("person-dialog-title").textContent = person ? "Wunschliste bearbeiten" : "Neue Wunschliste";
  personForm.elements.name.value = person?.name || "";
  personForm.elements.occasion.value = person?.occasion || "";
  personForm.elements.theme.value = person ? occasionOf(person) : "birthday";
  personForm.elements.event_date.value = person?.event_date || "";
  personForm.elements.palette.value = person ? paletteOf(person) : "pink";
  updateEventDateField();
  personDialog.showModal();
  personForm.elements.name.focus();
}

async function savePerson(e) {
  e.preventDefault();
  const name = personForm.elements.name.value.trim();
  const occasion = personForm.elements.occasion.value.trim() || null;
  const theme = personForm.elements.theme.value;
  const event_date = theme === "christmas" ? null : personForm.elements.event_date.value || null;
  const palette = personForm.elements.palette.value === "green" ? "green" : "pink";
  if (!name) return toast("Bitte einen Namen eingeben.", "error");

  const btn = personForm.querySelector("[type=submit]");
  btn.disabled = true;
  const payload = { name, occasion, theme, event_date, palette };
  const res = editingPerson
    ? await sb.from("persons").update(payload).eq("id", editingPerson.id)
    : await sb.from("persons").insert(payload).select("id").single();
  btn.disabled = false;
  if (res.error) return toast(friendlyError(res.error), "error");

  personDialog.close();
  if (editingPerson) {
    toast("Gespeichert.", "success");
    showPerson(editingPerson.id, { silent: true });
  } else {
    location.hash = `#/p/${res.data.id}`;
  }
}

async function deletePerson() {
  const { person, items } = state;
  if (!confirm(`Liste von „${person.name}“ mit allen ${items.length} Wünschen wirklich löschen?\nDas kann nicht rückgängig gemacht werden.`)) return;
  const { error } = await sb.from("persons").delete().eq("id", person.id);
  if (error) return toast(friendlyError(error), "error");
  const paths = items.map((i) => i.image_path).filter(Boolean);
  if (paths.length) await sb.storage.from(BUCKET).remove(paths);
  toast("Liste gelöscht.", "success");
  location.hash = "#/";
}

async function copyLink() {
  const link = shareUrl(state.person);
  try {
    await navigator.clipboard.writeText(link);
    toast("Link kopiert – jetzt einfach verschicken.", "success");
  } catch {
    app.querySelector("[data-select-on-focus]")?.select();
    toast("Bitte den markierten Link manuell kopieren.");
  }
}

async function nativeShare() {
  const { person } = state;
  try {
    await navigator.share({ title: `Wunschliste für ${person.name}`, url: shareUrl(person) });
  } catch { /* abgebrochen */ }
}

async function regenerateLink() {
  if (!confirm("Neuen Link erzeugen?\n\nDer bisherige Link funktioniert danach nicht mehr – sinnvoll, wenn er an die falsche Person geraten ist. Bestehende Reservierungen bleiben erhalten.")) return;
  const { error } = await sb.from("persons").update({ share_token: crypto.randomUUID() }).eq("id", state.person.id);
  if (error) return toast(friendlyError(error), "error");
  toast("Neuer Link erzeugt.", "success");
  showPerson(state.person.id, { silent: true });
}

async function toggleSurprise(input) {
  const surprise = input.checked;
  if (!surprise && !confirm("Überraschungsmodus ausschalten?\n\nDu siehst dann, welche Wünsche schon gekauft werden.")) {
    input.checked = true;
    return;
  }
  const { error } = await sb.from("persons").update({ surprise_mode: surprise }).eq("id", state.person.id);
  if (error) {
    input.checked = !surprise;
    return toast(friendlyError(error), "error");
  }
  showPerson(state.person.id, { silent: true });
}

async function refreshPrices(btn) {
  setBusy(btn, true, "Prüfe Preise …");
  try {
    const r = await callPriceFunction({ token: state.person.share_token, force: true });
    const parts = [`${r.checked} geprüft`, `${r.changed} geändert`];
    if (r.failed) parts.push(`${r.failed} nicht gefunden`);
    toast(`Preise: ${parts.join(" · ")}`, r.failed && !r.changed ? "info" : "success");
    showPerson(state.person.id, { silent: true });
  } catch (err) {
    setBusy(btn, false);
    toast(err.missing ? NOT_SET_UP : "Die Preise konnten nicht aktualisiert werden.", "error");
  }
}

// ---------------------------------------------------------------------
//  Aktionen: Wunsch
// ---------------------------------------------------------------------

const itemDialog = document.getElementById("item-dialog");
const itemForm = document.getElementById("item-form");
const imgPreview = document.getElementById("img-preview");
const imgInput = document.getElementById("image-input");
const imgRemoveBtn = document.getElementById("image-remove");
const fetchBtn = document.getElementById("fetch-info");
const fetchStatus = document.getElementById("fetch-status");
let editingItem = null;
let pendingImage = null;   // neu gewähltes, komprimiertes Bild (Blob)
let removeImage = false;   // vorhandenes Bild entfernen
let previewUrl = null;
let fetched = null;        // { price, at } – zuletzt automatisch geladener Preis
let lastFetchedUrl = "";

function setPreview(src) {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = src?.startsWith("blob:") ? src : null;
  imgPreview.innerHTML = src ? `<img src="${esc(src)}" alt="">` : "Kein Bild";
  imgRemoveBtn.hidden = !src;
}

function hasImage() {
  return Boolean(pendingImage || (editingItem?.image_path && !removeImage));
}

function setFetchStatus(text, type = "") {
  fetchStatus.textContent = text;
  fetchStatus.className = `fetch-status ${type}`;
}

function updateAutoPriceRow() {
  document.getElementById("auto-price-row").hidden = !itemForm.elements.url.value.trim();
}

function openItemDialog(item = null) {
  editingItem = item;
  pendingImage = null;
  removeImage = false;
  fetched = null;
  lastFetchedUrl = item?.url || "";
  itemForm.reset();
  setFetchStatus("");
  document.getElementById("item-dialog-title").textContent = item ? "Wunsch bearbeiten" : "Neuer Wunsch";
  itemForm.elements.title.value = item?.title || "";
  itemForm.elements.url.value = item?.url || "";
  itemForm.elements.price.value = item?.price != null ? String(item.price).replace(".", ",") : "";
  itemForm.elements.note.value = item?.note || "";
  itemForm.elements.favorite.checked = Boolean(item?.favorite);
  itemForm.elements.auto_price.checked = item ? item.auto_price !== false : true;
  updateAutoPriceRow();
  setPreview(imageUrl(item?.image_path));
  itemDialog.showModal();
  (item ? itemForm.elements.title : itemForm.elements.url).focus();
}

function normalizedUrl() {
  let raw = itemForm.elements.url.value.trim();
  if (raw && !/^[a-z][a-z0-9+.-]*:/i.test(raw)) raw = `https://${raw}`;
  return raw ? safeUrl(raw) : null;
}

/** Titel, Preis und Bild aus dem Shop-Link laden */
async function fetchProductInfo() {
  const url = normalizedUrl();
  if (!url) return setFetchStatus("Bitte zuerst einen gültigen Link einfügen.", "warn");
  lastFetchedUrl = url;
  setBusy(fetchBtn, true, "Lädt");
  setFetchStatus("Shopseite wird gelesen …", "warn");
  try {
    const info = await callPriceFunction({ url });
    if (itemForm.elements.url.value.trim() && normalizedUrl() !== url) return; // Link inzwischen geändert
    const found = [];
    if (info.title && !itemForm.elements.title.value.trim()) {
      itemForm.elements.title.value = info.title;
      found.push("Titel");
    }
    if (info.price != null) {
      if (info.currency && info.currency !== "EUR") {
        setFetchStatus(`Preis ist in ${info.currency} angegeben – bitte in Euro eintragen.`, "warn");
      } else {
        itemForm.elements.price.value = String(info.price.toFixed(2)).replace(".", ",");
        fetched = { price: info.price, at: new Date().toISOString() };
        found.push("Preis");
      }
    }
    if (info.imageData && !hasImage()) {
      try {
        pendingImage = await compressImage(await dataUrlToBlob(info.imageData));
        removeImage = false;
        setPreview(URL.createObjectURL(pendingImage));
        found.push("Bild");
      } catch { /* Bildformat nicht lesbar */ }
    }
    if (found.length) {
      setFetchStatus(`✓ Übernommen: ${found.join(", ")}`, "ok");
    } else if (!fetchStatus.textContent.includes("Euro")) {
      setFetchStatus("Keine neuen Angaben gefunden – bitte von Hand ergänzen.", "warn");
    }
    if (info.price == null) {
      setFetchStatus(`${found.length ? `✓ Übernommen: ${found.join(", ")}. ` : ""}Kein Preis gefunden – bitte von Hand eintragen.`, "warn");
    }
  } catch (err) {
    setFetchStatus(err.missing ? NOT_SET_UP : "Dieser Shop lässt sich nicht automatisch auslesen – bitte von Hand ausfüllen.", "warn");
  } finally {
    setBusy(fetchBtn, false);
  }
}

async function handleImageFile(file) {
  if (!file || !file.type.startsWith("image/")) return toast("Bitte eine Bilddatei wählen.", "error");
  try {
    pendingImage = await compressImage(file);
    removeImage = false;
    setPreview(URL.createObjectURL(pendingImage));
  } catch {
    pendingImage = null;
    toast("Das Bild konnte nicht gelesen werden.", "error");
  }
}

async function saveItem(e) {
  e.preventDefault();
  const title = itemForm.elements.title.value.trim();
  const urlRaw = itemForm.elements.url.value.trim();
  const priceRaw = itemForm.elements.price.value;
  const note = itemForm.elements.note.value.trim() || null;
  const favorite = itemForm.elements.favorite.checked;
  const auto_price = itemForm.elements.auto_price.checked;

  if (!title) return toast("Bitte einen Produktnamen eingeben.", "error");
  const url = normalizedUrl();
  if (urlRaw && !url) return toast("Der Link ist ungültig. Er sollte mit https:// beginnen.", "error");
  const price = parsePrice(priceRaw);
  if (Number.isNaN(price)) return toast("Bitte einen gültigen Preis eingeben, z. B. 49,99.", "error");

  const saveBtn = document.getElementById("item-save");
  setBusy(saveBtn, true, "Speichert");

  try {
    const oldPath = editingItem?.image_path || null;
    let imagePath = removeImage ? null : oldPath;
    let uploadedPath = null;

    if (pendingImage) {
      uploadedPath = `${session.user.id}/${crypto.randomUUID()}.jpg`;
      const { error } = await sb.storage.from(BUCKET).upload(uploadedPath, pendingImage, {
        contentType: "image/jpeg",
        cacheControl: "31536000",
      });
      if (error) throw new Error(`Bild-Upload fehlgeschlagen: ${error.message}`);
      imagePath = uploadedPath;
    }

    const payload = { title, url, price, note, favorite, auto_price, image_path: imagePath };
    // Preis-Zeitstempel: wann wurde der Preis zuletzt bestätigt?
    const oldPrice = editingItem?.price == null ? null : Number(editingItem.price);
    const now = new Date().toISOString();
    if (price === null) payload.price_updated_at = null;
    else if (!editingItem || oldPrice !== price || fetched?.price === price) payload.price_updated_at = now;
    if (fetched) payload.price_checked_at = fetched.at;

    const { error } = editingItem
      ? await sb.from("items").update(payload).eq("id", editingItem.id)
      : await sb.from("items").insert({ ...payload, person_id: state.person.id });

    if (error) {
      if (uploadedPath) await sb.storage.from(BUCKET).remove([uploadedPath]);
      throw error;
    }
    // Altes Bild aufräumen, wenn ersetzt oder entfernt
    if (oldPath && oldPath !== imagePath) await sb.storage.from(BUCKET).remove([oldPath]);

    itemDialog.close();
    toast(editingItem ? "Wunsch gespeichert." : "Wunsch hinzugefügt.", "success");
    showPerson(state.person.id, { silent: true });
  } catch (err) {
    toast(friendlyError(err), "error");
  } finally {
    setBusy(saveBtn, false);
  }
}

async function deleteItem(id) {
  const item = state.items.find((i) => i.id === id);
  if (!item || !confirm(`„${item.title}“ wirklich löschen?`)) return;
  const { error } = await sb.from("items").delete().eq("id", id);
  if (error) return toast(friendlyError(error), "error");
  if (item.image_path) await sb.storage.from(BUCKET).remove([item.image_path]);
  toast("Wunsch gelöscht.", "success");
  showPerson(state.person.id, { silent: true });
}

async function releaseClaim(id) {
  const claim = state.claims[id];
  if (!claim || !confirm(`Reservierung von ${claim.claimer_name} aufheben?\nDer Wunsch ist danach wieder für alle verfügbar.`)) return;
  const { error } = await sb.from("claims").delete().eq("item_id", id);
  if (error) return toast(friendlyError(error), "error");
  toast("Reservierung aufgehoben.", "success");
  showPerson(state.person.id, { silent: true });
}

// ---------------------------------------------------------------------
//  Dialoge
// ---------------------------------------------------------------------

function setupDialogs() {
  for (const dialog of [personDialog, itemDialog]) {
    dialog.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => dialog.close()));
  }
  personForm.addEventListener("submit", savePerson);
  personForm.addEventListener("change", (e) => { if (e.target.name === "theme" || e.target.name === "palette") updateEventDateField(); });
  itemForm.addEventListener("submit", saveItem);
  fetchBtn.addEventListener("click", fetchProductInfo);

  // Neuer Wunsch: Link einfügen → Angaben automatisch laden
  const urlInput = itemForm.elements.url;
  urlInput.addEventListener("input", updateAutoPriceRow);
  urlInput.addEventListener("paste", () => setTimeout(() => {
    updateAutoPriceRow();
    if (!editingItem && normalizedUrl() && normalizedUrl() !== lastFetchedUrl) fetchProductInfo();
  }, 0));
  urlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); fetchProductInfo(); }
  });

  imgInput.addEventListener("change", () => handleImageFile(imgInput.files[0]));
  imgRemoveBtn.addEventListener("click", () => {
    pendingImage = null;
    removeImage = true;
    imgInput.value = "";
    setPreview(null);
  });
  // Bild direkt aus der Zwischenablage einfügen (z. B. "Bild kopieren" im Onlineshop)
  itemDialog.addEventListener("paste", (e) => {
    const file = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"))?.getAsFile();
    if (file) {
      e.preventDefault();
      handleImageFile(file);
    }
  });
}

// ---------------------------------------------------------------------
//  Start (am Ende, damit alle Konstanten initialisiert sind)
// ---------------------------------------------------------------------

if (!isConfigured) {
  renderNotConfigured(app);
} else {
  init();
}
