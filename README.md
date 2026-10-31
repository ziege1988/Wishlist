# 🎁 Wishlist

Wunschlisten für mehrere Personen – zum Teilen mit Familie und Freunden.

- **Personen anlegen:** Jede Person bekommt ihre eigene Wunschliste.
- **Wünsche erfassen:** Produktname, Link zum Shop, Preis, Produktbild, Notiz (z. B. Größe/Farbe), optional als ❤️ Herzenswunsch markiert.
- **Per Link teilen:** Schenkende (z. B. Eltern) öffnen den Link ohne Konto und klicken auf **„Ich kaufe das“**.
- **Keine Doppelgeschenke:** Ein reservierter Wunsch ist für alle anderen sofort ausgegraut. Klicken zwei Personen gleichzeitig, gewinnt nachweislich nur eine; die andere bekommt einen Hinweis.
- **Überraschungsmodus (pro Liste):** Wenn er an ist, siehst du als Admin nicht, was schon reserviert wurde.

## Funktionen im Überblick

| Admin (`index.html`) | Schenkende (`liste.html?t=…`) |
|---|---|
| Login per E-Mail und Passwort | Kein Konto nötig |
| Personen anlegen, umbenennen, löschen | Fortschritt: „2 von 5 Wünschen vergeben“ |
| Wünsche mit Bild, Link, Preis, Notiz | „Ich kaufe das“ mit Namen |
| Bilder werden automatisch verkleinert (max. 1200 px, JPEG); Einfügen per Strg+V geht auch | Eigene Reservierung wieder aufheben („Doch nicht“) |
| Link kopieren, per WhatsApp oder über das Teilen-Menü des Handys verschicken | Vergebene Wünsche ausblenden |
| **Neuen Link erzeugen**, falls der alte in falsche Hände geraten ist | Aktualisiert sich automatisch (alle 20 s) |
| Überraschungsmodus an/aus, Reservierungen freigeben | |

## Technik

- Reines statisches Frontend (HTML, CSS, JavaScript), ohne Build-Schritt. Es läuft auf **GitHub Pages**.
- **Supabase** (kostenloser Plan reicht) stellt Datenbank, Login und Bildspeicher bereit.
- Die Supabase-JS-Bibliothek liegt unter `vendor/supabase.js` (v2.117.3, MIT-Lizenz), es wird also kein CDN gebraucht.
- Sicherheit: Row Level Security in der Datenbank.
  - Schenkende haben keinen direkten Tabellenzugriff, sondern nur drei Funktionen (Liste laden, reservieren, aufheben), die den geheimen Link-Token prüfen.
  - Reservierungen sind über den Primärschlüssel atomar: Pro Wunsch gibt es maximal eine.

```
index.html            Admin-Bereich
liste.html            Ansicht für Schenkende
assets/config.js      ← hier Supabase-Zugangsdaten eintragen
assets/common.js      gemeinsame Helfer
assets/admin.js       Logik Admin
assets/liste.js       Logik Schenkende
assets/style.css      Design (inkl. Dark Mode)
supabase/schema.sql   Datenbankschema, Regeln, Funktionen, Bildspeicher
vendor/supabase.js    Supabase-Client-Bibliothek
```

## Einrichtung (ca. 15 Minuten)

### 1. Supabase-Projekt anlegen
1. Auf [supabase.com](https://supabase.com) registrieren und ein **neues Projekt** anlegen. Als Region empfiehlt sich Frankfurt (`eu-central-1`).
2. Im Projekt links auf **SQL Editor** gehen, den kompletten Inhalt von [`supabase/schema.sql`](supabase/schema.sql) einfügen und auf **Run** klicken.
   Damit sind Tabellen, Sicherheitsregeln, Funktionen und der Bildspeicher `wishlist-images` eingerichtet.

### 2. Admin-Konto anlegen und Registrierung sperren
1. **Authentication → Users → Add user → Create new user**: E-Mail und Passwort eintragen und „Auto Confirm User“ anhaken.
2. **Authentication → Sign In / Providers**: **„Allow new users to sign up“ deaktivieren.**
   Sonst könnte sich jeder ein eigenes Konto anlegen. Er sähe zwar nur seine eigenen, leeren Listen, könnte aber deinen Speicherplatz nutzen.

### 3. Zugangsdaten eintragen
Unter **Project Settings → API** (bzw. über den Button **Connect**) die **Project URL** und den **anon / publishable key** kopieren und in `assets/config.js` eintragen:

```js
window.WISHLIST_CONFIG = {
  supabaseUrl: "https://abcdefgh.supabase.co",
  supabaseAnonKey: "eyJhbGciOi…",
};
```

> Der anon-Key darf öffentlich sein, denn die Datenbankregeln schützen die Daten.
> Den **service_role / secret key** darfst du **niemals** eintragen.

### 4. Auf GitHub Pages veröffentlichen
1. Änderungen committen und pushen.
2. Im GitHub-Repository: **Settings → Pages → Source: „Deploy from a branch“**, Branch und Ordner `/ (root)` wählen und speichern.
3. Nach ca. 1 Minute ist die App unter `https://<benutzername>.github.io/<repo>/` erreichbar.

### 5. Passwort-Zurücksetzen aktivieren (optional)
Unter **Authentication → URL Configuration** die GitHub-Pages-Adresse als **Site URL** eintragen.
Dann funktioniert „Passwort vergessen?“ auf der Login-Seite.

## Lokal testen

Ein beliebiger statischer Webserver genügt, zum Beispiel:

```bash
npx serve .
# oder
python3 -m http.server 8000
```

Danach `http://localhost:8000` öffnen. Direktes Öffnen per Doppelklick (`file://`) funktioniert nicht, weil die App JavaScript-Module nutzt.

## Gut zu wissen

- **Wer hat den Link?** Jeder mit dem Link kann die Liste sehen und reservieren. Der Link enthält einen zufälligen, nicht erratbaren Schlüssel.
  Gerät er in falsche Hände, erzeugst du einfach einen neuen. Bestehende Reservierungen bleiben dabei erhalten.
- **Reservierung aufheben:** Das geht nur auf dem Gerät und im Browser, mit dem reserviert wurde. Ist der Überraschungsmodus aus, kannst du als Admin jede Reservierung freigeben.
- **Überraschungsmodus:** Er schützt vor versehentlichem Spoilern, ist aber keine Sperre gegen dich selbst, denn du kannst ihn jederzeit ausschalten.
- **Kostenloser Supabase-Plan:** Projekte ohne Aktivität werden nach ca. einer Woche pausiert und lassen sich im Dashboard per Klick wieder starten.
  Vor Weihnachten oder Geburtstagen also kurz prüfen, ob das Projekt aktiv ist.

## Mögliche Erweiterungen

- **Mengen:** z. B. „3× Socken“, wobei jede Person ein Stück reserviert.
- **Gruppengeschenke:** Mehrere Personen beteiligen sich mit Beträgen an einem teuren Wunsch.
- **„Gekauft“ statt nur „reserviert“**, plus Erinnerung an offene Reservierungen.
- **Echtzeit-Aktualisierung** über Supabase Realtime statt Abfrage alle 20 Sekunden.
- **Automatisches Auslesen von Titel, Bild und Preis aus dem Shop-Link.** Dafür wäre eine Supabase Edge Function nötig, weil viele Shops das direkte Auslesen im Browser blockieren.
