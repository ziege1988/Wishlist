-- =====================================================================
--  Wishlist – Datenbankschema für Supabase
--  Im Supabase-Dashboard unter "SQL Editor" ausführen.
--  Das Skript darf beliebig oft ausgeführt werden (auch nach Updates):
--  Tabellen/Spalten werden nur angelegt, wenn sie fehlen, vorhandene
--  Daten bleiben erhalten.
-- =====================================================================

-- ---------------------------------------------------------------------
--  Tabellen
-- ---------------------------------------------------------------------

-- Eine Person = eine Wunschliste
create table if not exists public.persons (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name          text not null check (char_length(trim(name)) between 1 and 80),
  occasion      text check (occasion is null or char_length(occasion) <= 120),
  -- Geheimer Teil des Teilen-Links. Kann jederzeit neu erzeugt werden.
  share_token   uuid not null unique default gen_random_uuid(),
  -- Überraschungsmodus: Admin sieht nicht, was reserviert wurde
  surprise_mode boolean not null default true,
  created_at    timestamptz not null default now()
);

create index if not exists persons_owner_idx on public.persons (owner_id);

-- Ergänzungen (Version 2) – werden beim erneuten Ausführen nachgerüstet
alter table public.persons
  add column if not exists theme text not null default 'birthday'
    check (theme in ('birthday', 'christmas', 'other')),
  add column if not exists event_date date,
  -- Farbe beim Geburtstag: rosa oder pastellgrün
  add column if not exists palette text not null default 'pink'
    check (palette in ('pink', 'green'));

-- Ein Wunsch auf einer Liste
create table if not exists public.items (
  id          uuid primary key default gen_random_uuid(),
  person_id   uuid not null references public.persons (id) on delete cascade,
  title       text not null check (char_length(trim(title)) between 1 and 200),
  url         text check (url is null or (url ~* '^https?://' and char_length(url) <= 2000)),
  price       numeric(10, 2) check (price is null or price >= 0),
  image_path  text check (image_path is null or char_length(image_path) <= 300),
  note        text check (note is null or char_length(note) <= 500),
  favorite    boolean not null default false,   -- "Herzenswunsch"
  created_at  timestamptz not null default now()
);

create index if not exists items_person_idx on public.items (person_id);

alter table public.items
  -- Preis automatisch aus dem Shop-Link aktuell halten
  add column if not exists auto_price boolean not null default true,
  -- letzter erfolgreich ermittelter Preis / letzter Versuch
  add column if not exists price_updated_at timestamptz,
  add column if not exists price_checked_at timestamptz;

-- Reservierung ("Ich kaufe das"). Primärschlüssel = item_id
-- => pro Wunsch kann es technisch nur EINE Reservierung geben.
create table if not exists public.claims (
  item_id       uuid primary key references public.items (id) on delete cascade,
  claimer_name  text not null check (char_length(trim(claimer_name)) between 1 and 60),
  -- Geheimnis, das nur das Gerät der reservierenden Person kennt
  -- (damit nur sie die Reservierung wieder aufheben kann)
  secret        uuid not null default gen_random_uuid(),
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
--  Row Level Security
--  Admin (eingeloggt) verwaltet nur eigene Personen/Wünsche.
--  Schenkende (nicht eingeloggt) haben KEINEN direkten Tabellenzugriff,
--  sondern nur über die RPC-Funktionen weiter unten.
-- ---------------------------------------------------------------------

alter table public.persons enable row level security;
alter table public.items   enable row level security;
alter table public.claims  enable row level security;

drop policy if exists "persons: owner full access" on public.persons;
create policy "persons: owner full access" on public.persons
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "items: owner full access" on public.items;
create policy "items: owner full access" on public.items
  for all to authenticated
  using (exists (select 1 from public.persons p
                 where p.id = items.person_id and p.owner_id = auth.uid()))
  with check (exists (select 1 from public.persons p
                      where p.id = items.person_id and p.owner_id = auth.uid()));

-- Admin darf Reservierungen nur sehen bzw. freigeben,
-- wenn der Überraschungsmodus der Liste AUS ist.
drop policy if exists "claims: owner read when not surprise" on public.claims;
create policy "claims: owner read when not surprise" on public.claims
  for select to authenticated
  using (exists (select 1 from public.items i
                 join public.persons p on p.id = i.person_id
                 where i.id = claims.item_id
                   and p.owner_id = auth.uid()
                   and not p.surprise_mode));

drop policy if exists "claims: owner delete when not surprise" on public.claims;
create policy "claims: owner delete when not surprise" on public.claims
  for delete to authenticated
  using (exists (select 1 from public.items i
                 join public.persons p on p.id = i.person_id
                 where i.id = claims.item_id
                   and p.owner_id = auth.uid()
                   and not p.surprise_mode));

-- ---------------------------------------------------------------------
--  Öffentliche Funktionen für Schenkende (per Teilen-Link)
-- ---------------------------------------------------------------------

-- Liste anhand des Teilen-Tokens laden
create or replace function public.get_shared_list(p_token uuid)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'name',       p.name,
    'occasion',   p.occasion,
    'theme',      p.theme,
    'event_date', p.event_date,
    'palette',    p.palette,
    'items', coalesce((
      select json_agg(json_build_object(
               'id',           i.id,
               'title',        i.title,
               'url',          i.url,
               'price',        i.price,
               'price_updated_at', i.price_updated_at,
               'image_path',   i.image_path,
               'note',         i.note,
               'favorite',     i.favorite,
               'created_at',   i.created_at,
               'claimed',      c.item_id is not null,
               'claimer_name', c.claimer_name,
               'claimed_at',   c.created_at
             ) order by i.favorite desc, i.created_at asc)
      from public.items i
      left join public.claims c on c.item_id = i.id
      where i.person_id = p.id
    ), '[]'::json)
  )
  from public.persons p
  where p.share_token = p_token;
$$;

-- Wunsch reservieren. Liefert das Geheimnis zum späteren Aufheben.
-- Fehler: 'not_found' (falscher Link/Wunsch), 'already_claimed' (jemand war schneller)
create or replace function public.claim_item(p_token uuid, p_item_id uuid, p_name text)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_secret uuid;
begin
  if p_name is null or char_length(trim(p_name)) = 0 then
    raise exception 'name_required';
  end if;

  if not exists (select 1 from public.items i
                 join public.persons p on p.id = i.person_id
                 where i.id = p_item_id and p.share_token = p_token) then
    raise exception 'not_found';
  end if;

  -- Atomar: Der Primärschlüssel verhindert Doppel-Reservierungen,
  -- auch wenn zwei Personen exakt gleichzeitig klicken.
  insert into public.claims (item_id, claimer_name)
  values (p_item_id, left(trim(p_name), 60))
  on conflict (item_id) do nothing
  returning secret into v_secret;

  if v_secret is null then
    raise exception 'already_claimed';
  end if;

  return v_secret;
end;
$$;

-- Eigene Reservierung wieder aufheben (nur mit passendem Geheimnis)
create or replace function public.unclaim_item(p_token uuid, p_item_id uuid, p_secret uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  delete from public.claims c
  using public.items i, public.persons p
  where c.item_id = p_item_id
    and c.secret  = p_secret
    and i.id = c.item_id
    and p.id = i.person_id
    and p.share_token = p_token;
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

revoke all on function public.get_shared_list(uuid)          from public;
revoke all on function public.claim_item(uuid, uuid, text)   from public;
revoke all on function public.unclaim_item(uuid, uuid, uuid) from public;
grant execute on function public.get_shared_list(uuid)          to anon, authenticated;
grant execute on function public.claim_item(uuid, uuid, text)   to anon, authenticated;
grant execute on function public.unclaim_item(uuid, uuid, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
--  Bildspeicher (Supabase Storage)
--  Bucket ist öffentlich lesbar (Bilder per URL abrufbar),
--  hochladen/löschen darf nur der Admin in seinem eigenen Ordner.
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('wishlist-images', 'wishlist-images', true, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

drop policy if exists "wishlist-images: owner read" on storage.objects;
create policy "wishlist-images: owner read" on storage.objects
  for select to authenticated
  using (bucket_id = 'wishlist-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "wishlist-images: owner upload" on storage.objects;
create policy "wishlist-images: owner upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'wishlist-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "wishlist-images: owner delete" on storage.objects;
create policy "wishlist-images: owner delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'wishlist-images' and (storage.foldername(name))[1] = auth.uid()::text);
