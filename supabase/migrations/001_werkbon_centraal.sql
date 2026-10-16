-- Centrale database voor de werkbonnen-app (Lovable Cloud / Supabase).
--
-- Alle tabellen en functies beginnen met `wb_`, zodat ze niet botsen met tabellen
-- die Lovable zelf in hetzelfde project aanmaakt (bv. een eigen `klanten`).
--
-- Elke tabel bewaart het volledige record uit de app als jsonb in `data`, zodat
-- de app en de database niet bij elke nieuwe veldnaam aangepast moeten worden.
-- `bijgewerkt_op` wordt door de server gezet en dient als cursor voor de sync.
-- Verwijderen gebeurt "zacht" (verwijderd = true) zodat andere toestellen het
-- ook te zien krijgen.
--
-- Toegang: de app gebruikt de publieke (anon/publishable) sleutel. Omdat die in
-- de JavaScript staat, moet elke aanvraag ook de header `x-team-code` met de
-- geheime teamcode meesturen. Zonder juiste teamcode zie je niets en kan je
-- niets schrijven.

-- ---------------------------------------------------------------------------
-- Teamcode (niet leesbaar via de API)
-- ---------------------------------------------------------------------------
create table if not exists public.wb_config (
  sleutel text primary key,
  waarde  text not null
);
alter table public.wb_config enable row level security;
revoke all on public.wb_config from anon, authenticated;

-- Vervang VERANDER-MIJ door je eigen geheime teamcode vóór je dit uitvoert, en geef ze
-- door aan de monteurs (eenmalig per toestel). Zet de echte teamcode NOOIT in de
-- repository: samen met de publieke sleutel uit js/config.js geeft ze toegang tot alles.
insert into public.wb_config (sleutel, waarde)
values ('teamcode', 'VERANDER-MIJ')
on conflict (sleutel) do nothing;

create or replace function public.wb_teamcode_ok()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.wb_config
    where sleutel = 'teamcode'
      and waarde = coalesce(current_setting('request.headers', true)::json ->> 'x-team-code', '')
  );
$$;
revoke all on function public.wb_teamcode_ok() from public;
grant execute on function public.wb_teamcode_ok() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Server-tijdstempel bij elke wijziging
-- ---------------------------------------------------------------------------
create or replace function public.wb_touch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.bijgewerkt_op := clock_timestamp();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tabellen
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['wb_monteurs', 'wb_klanten', 'wb_machines', 'wb_onderdelen', 'wb_werkbonnen'] loop
    execute format($f$
      create table if not exists public.%1$I (
        id             text primary key,
        data           jsonb not null,
        verwijderd     boolean not null default false,
        gewijzigd_door text,
        bijgewerkt_op  timestamptz not null default clock_timestamp()
      );
      create index if not exists %1$s_bijgewerkt_op_idx on public.%1$I (bijgewerkt_op);

      drop trigger if exists %1$s_touch on public.%1$I;
      create trigger %1$s_touch before insert or update on public.%1$I
        for each row execute function public.wb_touch();

      alter table public.%1$I enable row level security;
      grant select, insert, update on public.%1$I to anon, authenticated;

      drop policy if exists %1$s_lezen on public.%1$I;
      create policy %1$s_lezen on public.%1$I for select
        to anon, authenticated using (public.wb_teamcode_ok());

      drop policy if exists %1$s_toevoegen on public.%1$I;
      create policy %1$s_toevoegen on public.%1$I for insert
        to anon, authenticated with check (public.wb_teamcode_ok());

      drop policy if exists %1$s_wijzigen on public.%1$I;
      create policy %1$s_wijzigen on public.%1$I for update
        to anon, authenticated using (public.wb_teamcode_ok()) with check (public.wb_teamcode_ok());
    $f$, t);
  end loop;
end;
$$;

-- Handige kolommen voor overzichten en rapporten (afgeleid uit data).
alter table public.wb_werkbonnen
  add column if not exists nummer    text generated always as (data ->> 'nummer') stored,
  add column if not exists datum     text generated always as (data ->> 'datum') stored,
  add column if not exists status    text generated always as (data ->> 'status') stored,
  add column if not exists monteur   text generated always as (data ->> 'monteur') stored,
  add column if not exists klant_naam text generated always as (data -> 'klant' ->> 'naam') stored;
create index if not exists wb_werkbonnen_nummer_idx on public.wb_werkbonnen (nummer);

alter table public.wb_klanten
  add column if not exists naam text generated always as (data ->> 'naam') stored;
alter table public.wb_onderdelen
  add column if not exists artikelnr text generated always as (data ->> 'artikelnr') stored;

-- PostgREST de nieuwe tabellen meteen laten zien
notify pgrst, 'reload schema';
