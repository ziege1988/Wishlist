# 🎁 Wishlist

Wunschlisten für mehrere Personen – zum Teilen mit Familie und Freunden.

- **Personen anlegen:** Jede Person bekommt ihre eigene Wunschliste.
- **Wünsche erfassen:** Produktname, Link zum Shop, Preis, Produktbild, Notiz (z. B. Größe/Farbe), optional als ❤️ Herzenswunsch markiert.
- **Per Link teilen:** Schenkende öffnen den Link ohne Konto und klicken auf **„Besorge ich“**.
- **Keine Doppelgeschenke:** Ein reservierter Wunsch ist für alle anderen sofort ausgegraut. Klicken zwei Personen gleichzeitig, gewinnt nachweislich nur eine; die andere bekommt einen Hinweis.
- **Überraschungsmodus (pro Liste):** Wenn er an ist, siehst du als Admin nicht, was schon reserviert wurde.
- **Anlass pro Liste:** 🎂 Geburtstag (wahlweise 🌸 Rosa oder 🌿 Pastellgrün), 🎄 Weihnachten (Tannengrün mit geschmücktem Baum und Schnee) oder 🎁 Sonstiges, jeweils mit eigenem Design und Countdown. Beim Geburtstag zeigt die App mit Geburtsjahr auch das Alter an („Lena wird 7“).
- **Preise aus dem Link:** Titel, Preis und Bild werden aus dem Shop-Link geladen, und Preise halten sich automatisch aktuell (optional, siehe unten).
- **Als App auf dem Homescreen:** mit eigenem Icon, auf iPhone und Android.

## Funktionen im Überblick

| Admin (`index.html`) | Schenkende (`liste.html?t=…`) |
|---|---|
| Login per E-Mail und Passwort | Kein Konto nötig |
| Personen anlegen, umbenennen, löschen | Fortschritt: „2 von 5 Wünschen vergeben“ |
| Wünsche mit Bild, Link, Preis, Notiz | „Besorge ich“ mit Namen, „Gekauft“-Stempel über dem Bild |
| Bilder werden automatisch verkleinert (max. 1200 px, JPEG); Einfügen per Strg+V geht auch | Eigene Reservierung wieder aufheben („Doch nicht“) |
| Link kopieren, per WhatsApp oder über das Teilen-Menü des Handys verschicken | Vergebene Wünsche ausblenden |
| **Neuen Link erzeugen**, falls der alte in falsche Hände geraten ist | Aktualisiert sich automatisch (alle 20 s) |
| Überraschungsmodus an/aus, Reservierungen freigeben | Preis mit Stand („Preis von heute“) |
| Anlass, Datum, Countdown; „Preise aktualisieren“ auf Knopfdruck | Design passend zum Anlass, Countdown |

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
supabase/functions/product-info/index.ts   Edge Function: Preis/Titel/Bild aus Shop-Links
manifest.webmanifest, assets/icons/        App-Icon für den Homescreen
assets/fonts/         Schriften „Fredoka“ & „Nunito“ (SIL Open Font License), lokal eingebunden (DSGVO)
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

### 6. Preise automatisch aus dem Link (optional, ca. 5 Minuten)
Ohne diesen Schritt funktioniert alles andere, Preis, Titel und Bild trägst du dann von Hand ein.

1. Supabase → links **Edge Functions** → **„Deploy a new function“** → **„Via Editor“**.
2. Als Namen genau **`product-info`** eintragen.
3. Den vorhandenen Beispielcode komplett löschen. Stattdessen den Inhalt von
   [`supabase/functions/product-info/index.ts`](supabase/functions/product-info/index.ts) einfügen
   (auf GitHub: Datei öffnen → Kopieren-Symbol „Copy raw file“).
4. Auf **„Deploy function“** klicken und ca. 30 Sekunden warten.
5. In der Funktion auf **„Details“** bzw. **„Settings“** gehen, **„Verify JWT with legacy secret“ / „Enforce JWT Verification“ AUSSCHALTEN** und speichern.
   Das ist nötig, weil auch Schenkende ohne Konto die Preisaktualisierung anstoßen. Wer was darf, prüft die Funktion selbst:
   - Shopseiten auslesen und Preise sofort aktualisieren darf nur der angemeldete Admin.
   - Schenkende können höchstens alle 12 Stunden eine Preisprüfung auslösen.

**So funktioniert es danach:**
- **Neuer Wunsch:** Link einfügen, dann werden Titel, Preis und Bild automatisch geladen. Alternativ auf „✨ Laden“ tippen.
- **Automatische Aktualisierung:** Wird die Liste aufgerufen, prüft die App Preise, deren letzte Prüfung über 12 Stunden zurückliegt. Das gilt für dich und für die Schenkenden.
- **„🔄 Preise aktualisieren“** prüft alle Preise einer Liste sofort.
- Pro Wunsch lässt sich die automatische Aktualisierung abschalten, z. B. wenn ein Shop einen falschen Preis liefert.

**Grenzen:** Viele Shops stellen ihre Preise in einem Standardformat für Suchmaschinen bereit, z. B. Otto, MediaMarkt, Thalia, IKEA oder die meisten Shopify-Shops. Dort klappt es in der Regel.
**Amazon** und einige große Händler blockieren automatische Abrufe dagegen häufig. Dann erscheint ein Hinweis, und du trägst den Preis von Hand ein.

### Updates einspielen
Wenn es eine neue Version gibt, die die Datenbank erweitert, führe **`supabase/schema.sql` einfach erneut** im SQL Editor aus.
Das Skript ergänzt nur, was fehlt. Vorhandene Listen, Wünsche und Reservierungen bleiben erhalten.

## Als App auf dem Homescreen
- **iPhone (Safari):** Teilen-Symbol → **„Zum Home-Bildschirm“**.
- **Android (Chrome):** Menü ⋮ → **„Zum Startbildschirm hinzufügen“** bzw. **„App installieren“**.

Der Admin-Bereich öffnet sich danach wie eine eigene App. Schenkende können ihre Liste genauso ablegen und haben sie dann direkt auf dem Handy.

## Updates und Zwischenspeicher
CSS- und JavaScript-Dateien werden mit einer Versionsnummer eingebunden (`?v=…`). Nach Code-Änderungen vor dem Commit
`tools/version.sh` ausführen. So laden Browser und Homescreen-Apps garantiert die neue Version statt einer zwischengespeicherten.

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
- **Preis-Wecker:** Hinweis an Schenkende, wenn ein Wunsch deutlich günstiger geworden ist.
