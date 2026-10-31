// Admin-Bereich: Personen und Wünsche verwalten
import {
  sb, isConfigured, esc, formatPrice, parsePrice, safeUrl, hostOf, imageUrl,
  toast, placeholderSvg, renderNotConfigured, BUCKET,
} from "./common.js";

const app = document.getElementById("app");
const userbox = document.getElementById("userbox");

let session = null;
let recoveryMode = false;
let routeSeq = 0;
const state = { person: null, items: [], claims: {} };

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
  setupDialogs();
  route();
}

// ---------------------------------------------------------------------
//  Routing
// ---------------------------------------------------------------------

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
  return msg;
}

// ---------------------------------------------------------------------
//  Login & Passwort zurücksetzen
// ---------------------------------------------------------------------

function renderLogin() {
  app.innerHTML = `
    <section class="card narrow">
      <form class="stack" data-form="login">
        <h1>Anmelden</h1>
        <p class="muted">Melde dich an, um deine Wunschlisten zu verwalten.</p>
        <label class="field">E-Mail
          <input type="email" name="email" required autocomplete="username">
        </label>
        <label class="field">Passwort
          <input type="password" name="password" required autocomplete="current-password">
        </label>
        <button class="btn primary block" type="submit">Anmelden</button>
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
    sb.from("persons").select("id, name, occasion, created_at").order("created_at", { ascending: true }),
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
      <button class="btn primary" data-action="new-person">+ Neue Person</button>
    </div>
    ${persons.length === 0
      ? `<div class="card empty">
           <p style="font-size:2.4rem;margin:0">🎁</p>
           <p>Noch keine Person angelegt.<br>Leg los mit der ersten Wunschliste!</p>
           <button class="btn primary" data-action="new-person">+ Neue Person</button>
         </div>`
      : `<div class="person-grid">
          ${persons.map((p) => `
            <a class="person-card" href="#/p/${p.id}">
              <div class="avatar">${esc(p.name.trim().charAt(0).toUpperCase())}</div>
              <h3>${esc(p.name)}</h3>
              ${p.occasion ? `<div class="meta">${esc(p.occasion)}</div>` : ""}
              <div class="meta">${wishCount(counts[p.id] || 0)}</div>
            </a>`).join("")}
         </div>`}`;
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
      <a class="back" href="#/">← Alle Personen</a>
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
}

function shareUrl(person) {
  return new URL(`liste.html?t=${person.share_token}`, location.href).href;
}

function renderPerson() {
  const { person, items, claims } = state;
  const link = shareUrl(person);
  const total = items.reduce((sum, i) => sum + (i.price ? Number(i.price) : 0), 0);
  const claimedCount = Object.keys(claims).length;
  const waText = `Hier ist die Wunschliste für ${person.name}${person.occasion ? ` (${person.occasion})` : ""}: ${link}`;

  app.innerHTML = `
    <a class="back" href="#/">← Alle Personen</a>
    <div class="detail-head">
      <div>
        <h1>${esc(person.name)}</h1>
        ${person.occasion ? `<p class="muted" style="margin:0">${esc(person.occasion)}</p>` : ""}
      </div>
      <div class="row">
        <button class="btn sm" data-action="edit-person">Bearbeiten</button>
        <button class="btn sm danger" data-action="delete-person">Löschen</button>
      </div>
    </div>

    <div class="panel-grid">
      <section class="card stack">
        <h3>Liste teilen</h3>
        <p class="muted small" style="margin-top:4px">Schick diesen Link an Eltern, Familie und Freunde.
          Sie brauchen kein Konto und können Wünsche direkt reservieren.</p>
        <div class="share-link">
          <input type="text" readonly value="${esc(link)}" aria-label="Teilen-Link" data-select-on-focus>
          <button class="btn" data-action="copy-link">Kopieren</button>
        </div>
        <div class="row">
          <a class="btn sm" href="https://wa.me/?text=${encodeURIComponent(waText)}" target="_blank" rel="noopener">WhatsApp</a>
          ${navigator.share ? `<button class="btn sm" data-action="native-share">Teilen …</button>` : ""}
          <a class="btn sm" href="${esc(link)}" target="_blank" rel="noopener">Vorschau</a>
          <span class="spacer"></span>
          <button class="btn sm ghost" data-action="regen-link" title="Der alte Link funktioniert danach nicht mehr">Neuen Link erzeugen</button>
        </div>
      </section>

      <section class="card stack">
        <h3>Überraschungsmodus</h3>
        <label class="switch">
          <input type="checkbox" data-action="toggle-surprise" ${person.surprise_mode ? "checked" : ""}>
          <span class="track"></span>
          <span>
            <strong>${person.surprise_mode ? "An" : "Aus"}</strong><br>
            <span class="muted small">${person.surprise_mode
              ? "Du siehst hier nicht, was schon reserviert ist. Schenkende sehen es natürlich trotzdem."
              : "Du siehst, welche Wünsche reserviert sind und von wem."}</span>
          </span>
        </label>
      </section>
    </div>

    <div class="toolbar">
      <div class="stats">
        <span><strong>${items.length}</strong> ${items.length === 1 ? "Wunsch" : "Wünsche"}</span>
        ${total > 0 ? `<span>Summe <strong>${formatPrice(total)}</strong></span>` : ""}
        ${!person.surprise_mode ? `<span><strong>${claimedCount}</strong> reserviert</span>` : ""}
      </div>
      <button class="btn primary" data-action="new-item">+ Wunsch hinzufügen</button>
    </div>

    ${items.length === 0
      ? `<div class="card empty"><p>Noch keine Wünsche auf dieser Liste.</p>
           <button class="btn primary" data-action="new-item">+ Ersten Wunsch hinzufügen</button></div>`
      : `<div class="item-grid">${items.map((i) => adminItemCard(i, claims[i.id])).join("")}</div>`}`;
}

function adminItemCard(item, claim) {
  const img = imageUrl(item.image_path);
  const url = safeUrl(item.url);
  return `
    <article class="item ${claim ? "claimed" : ""}">
      ${item.favorite ? `<span class="fav-badge">❤️ Herzenswunsch</span>` : ""}
      <div class="img">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : placeholderSvg()}${claim ? `<span class="sold-overlay">Gekauft</span>` : ""}</div>
      <div class="body">
        <h3>${esc(item.title)}</h3>
        ${item.price !== null ? `<div class="price">${formatPrice(item.price)}</div>` : ""}
        ${url ? `<a class="shop" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(hostOf(url))} ↗</a>` : ""}
        ${item.note ? `<div class="note">${esc(item.note)}</div>` : ""}
        ${claim ? `<span class="claim-badge">🎁 Reserviert von ${esc(claim.claimer_name)}</span>` : ""}
        <div class="actions">
          <button class="btn sm" data-action="edit-item" data-id="${item.id}">Bearbeiten</button>
          ${claim ? `<button class="btn sm" data-action="release-claim" data-id="${item.id}">Freigeben</button>` : ""}
          <button class="btn sm danger" data-action="delete-item" data-id="${item.id}">Löschen</button>
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

app.addEventListener("focusin", (e) => {
  if (e.target.matches("[data-select-on-focus]")) e.target.select();
});

// ---------------------------------------------------------------------
//  Aktionen: Person
// ---------------------------------------------------------------------

const personDialog = document.getElementById("person-dialog");
const personForm = document.getElementById("person-form");
let editingPerson = null;

function openPersonDialog(person = null) {
  editingPerson = person;
  personForm.reset();
  document.getElementById("person-dialog-title").textContent = person ? "Person bearbeiten" : "Neue Person";
  personForm.elements.name.value = person?.name || "";
  personForm.elements.occasion.value = person?.occasion || "";
  personDialog.showModal();
  personForm.elements.name.focus();
}

async function savePerson(e) {
  e.preventDefault();
  const name = personForm.elements.name.value.trim();
  const occasion = personForm.elements.occasion.value.trim() || null;
  if (!name) return toast("Bitte einen Namen eingeben.", "error");

  const btn = personForm.querySelector("[type=submit]");
  btn.disabled = true;
  const res = editingPerson
    ? await sb.from("persons").update({ name, occasion }).eq("id", editingPerson.id)
    : await sb.from("persons").insert({ name, occasion }).select("id").single();
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
  if (!surprise && !confirm("Überraschungsmodus ausschalten?\n\nDu siehst dann, welche Wünsche schon reserviert sind.")) {
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

// ---------------------------------------------------------------------
//  Aktionen: Wunsch
// ---------------------------------------------------------------------

const itemDialog = document.getElementById("item-dialog");
const itemForm = document.getElementById("item-form");
const imgPreview = document.getElementById("img-preview");
const imgInput = document.getElementById("image-input");
const imgRemoveBtn = document.getElementById("image-remove");
let editingItem = null;
let pendingImage = null;   // neu gewähltes, komprimiertes Bild (Blob)
let removeImage = false;   // vorhandenes Bild entfernen
let previewUrl = null;

function setPreview(src) {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = src?.startsWith("blob:") ? src : null;
  imgPreview.innerHTML = src ? `<img src="${esc(src)}" alt="">` : "Kein Bild";
  imgRemoveBtn.hidden = !src;
}

function openItemDialog(item = null) {
  editingItem = item;
  pendingImage = null;
  removeImage = false;
  itemForm.reset();
  document.getElementById("item-dialog-title").textContent = item ? "Wunsch bearbeiten" : "Neuer Wunsch";
  itemForm.elements.title.value = item?.title || "";
  itemForm.elements.url.value = item?.url || "";
  itemForm.elements.price.value = item?.price != null ? String(item.price).replace(".", ",") : "";
  itemForm.elements.note.value = item?.note || "";
  itemForm.elements.favorite.checked = Boolean(item?.favorite);
  setPreview(imageUrl(item?.image_path));
  itemDialog.showModal();
  itemForm.elements.title.focus();
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

/** Verkleinert Bilder auf max. 1200 px und speichert sie als JPEG (spart Speicher & Ladezeit) */
async function compressImage(file, maxSize = 1200, quality = 0.85) {
  const src = URL.createObjectURL(file);
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

async function saveItem(e) {
  e.preventDefault();
  const title = itemForm.elements.title.value.trim();
  let urlRaw = itemForm.elements.url.value.trim();
  const priceRaw = itemForm.elements.price.value;
  const note = itemForm.elements.note.value.trim() || null;
  const favorite = itemForm.elements.favorite.checked;

  if (!title) return toast("Bitte einen Produktnamen eingeben.", "error");
  if (urlRaw && !/^[a-z][a-z0-9+.-]*:/i.test(urlRaw)) urlRaw = `https://${urlRaw}`;
  const url = urlRaw ? safeUrl(urlRaw) : null;
  if (urlRaw && !url) return toast("Der Link ist ungültig. Er sollte mit https:// beginnen.", "error");
  const price = parsePrice(priceRaw);
  if (Number.isNaN(price)) return toast("Bitte einen gültigen Preis eingeben, z. B. 49,99.", "error");

  const saveBtn = document.getElementById("item-save");
  saveBtn.disabled = true;
  saveBtn.textContent = "Speichert …";

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

    const payload = { title, url, price, note, favorite, image_path: imagePath };
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
    saveBtn.disabled = false;
    saveBtn.textContent = "Speichern";
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
  itemForm.addEventListener("submit", saveItem);
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
