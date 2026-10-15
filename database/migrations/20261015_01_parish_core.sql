-- ============================================================================
-- Minga Parish Management System — migration 01: parish core
--   parish profile, organisational tree (parokia → kigango → jumuiya),
--   families, parishioners (waumini), leadership, parish roles & permissions,
--   audit log.
--
-- Safe to run on an existing Kanisa Hub database: only creates new objects
-- (create ... if not exists / create or replace) and never drops data.
-- Requires the Kanisa Hub base tables auth.users and public.profiles.
-- ============================================================================

-- gen_random_uuid() is built into PostgreSQL 13+, no extension needed.

-- ---------------------------------------------------------------------------
-- Audit log (written only by the audit trigger / security-definer functions)
-- ---------------------------------------------------------------------------
create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor_id    uuid,
  action      text not null,               -- INSERT / UPDATE / DELETE or a business action e.g. 'post_payment'
  table_name  text,
  row_id      text,
  old_data    jsonb,
  new_data    jsonb,
  note        text
);
create index if not exists audit_log_table_row_idx on public.audit_log (table_name, row_id);
create index if not exists audit_log_at_idx on public.audit_log (at desc);

create or replace function public.audit_row()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_log (actor_id, action, table_name, row_id, old_data, new_data)
  values (auth.uid(), tg_op, tg_table_name,
          coalesce((case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end) ->> 'id', ''),
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- ---------------------------------------------------------------------------
-- Parish profile (single row per parish; multi-parish ready via parish_id)
-- ---------------------------------------------------------------------------
create table if not exists public.parishes (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null unique,                 -- short code used in receipt numbers, e.g. 'MNG'
  official_name       text not null,
  short_name          text,
  patron_saint        text,
  diocese             text,
  region              text,
  district            text,
  postal_address      text,
  physical_address    text,
  phone               text,
  email               text,
  logo_url            text,
  parish_priest       text,
  assistant_priests   text[],
  established_year    int,
  history             text,
  mission             text,
  vision              text,
  fy_start_month      int not null default 1 check (fy_start_month between 1 and 12),
  receipt_title       text default 'STAKABADHI YA MALIPO',
  receipt_prefix      text,
  receipt_footer      text,
  report_header       text,
  report_footer       text,
  payment_accounts    jsonb not null default '[]'::jsonb,   -- [{label, bank, account_no, mobile_number}]
  verified_fields     text[] not null default '{}',         -- which fields an administrator has confirmed
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
drop trigger if exists parishes_touch on public.parishes;
create trigger parishes_touch before update on public.parishes for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Organisational tree: parish → (zone) → kigango → jumuiya, plus parish groups
-- (vyama vya kitume, kwaya, kanda, kamati) that also contribute money.
-- ---------------------------------------------------------------------------
create table if not exists public.org_units (
  id            uuid primary key default gen_random_uuid(),
  parish_id     uuid not null references public.parishes(id),
  parent_id     uuid references public.org_units(id),
  unit_type     text not null check (unit_type in ('parish','zone','kigango','jumuiya','group')),
  name          text not null,
  official_name text,
  ordinal       int,
  zone          text,              -- 'parokiani' (centre) / 'vigangoni' (outstations) as used by the legacy reports
  legacy_names  text[] not null default '{}',   -- spellings found in the workbook, used by the importer
  is_active     boolean not null default true,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (parish_id, unit_type, name)
);
create index if not exists org_units_parent_idx on public.org_units (parent_id);
drop trigger if exists org_units_touch on public.org_units;
create trigger org_units_touch before update on public.org_units for each row execute function public.touch_updated_at();

-- ancestor/descendant pairs (including self) — small tree, computed on demand
create or replace view public.org_unit_closure with (security_invoker = true) as
with recursive c as (
  select id as ancestor_id, id as descendant_id, 0 as depth from public.org_units
  union all
  select c.ancestor_id, o.id, c.depth + 1
  from c join public.org_units o on o.parent_id = c.descendant_id
)
select * from c;

-- nearest ancestor (or self) of a given type
create or replace function public.org_ancestor_of_type(p_unit uuid, p_type text)
returns uuid language sql stable set search_path = public as $$
  with recursive up as (
    select id, parent_id, unit_type, 0 as d from public.org_units where id = p_unit
    union all
    select o.id, o.parent_id, o.unit_type, up.d + 1 from public.org_units o join up on o.id = up.parent_id
  )
  select id from up where unit_type = p_type order by d limit 1
$$;

create or replace function public.org_is_within(p_unit uuid, p_scope uuid)
returns boolean language sql stable set search_path = public as $$
  with recursive up as (
    select id, parent_id from public.org_units where id = p_unit
    union all
    select o.id, o.parent_id from public.org_units o join up on o.id = up.parent_id
  )
  select p_scope is null or exists (select 1 from up where id = p_scope)
$$;

-- ---------------------------------------------------------------------------
-- Families and parishioners (parish register — independent of login accounts)
-- ---------------------------------------------------------------------------
create table if not exists public.families (
  id              uuid primary key default gen_random_uuid(),
  parish_id       uuid not null references public.parishes(id),
  family_code     text,                                  -- e.g. legacy "FAMILIA NAMBA" within the jumuiya
  family_name     text not null,
  jumuiya_id      uuid references public.org_units(id),
  head_parishioner_id uuid,                              -- FK added after parishioners exists
  phone           text,
  address         text,
  status          text not null default 'active' check (status in ('active','inactive','moved','merged')),
  legacy_ref      jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (parish_id, jumuiya_id, family_code)
);
create index if not exists families_jumuiya_idx on public.families (jumuiya_id);
drop trigger if exists families_touch on public.families;
create trigger families_touch before update on public.families for each row execute function public.touch_updated_at();

create table if not exists public.parishioners (
  id               uuid primary key default gen_random_uuid(),
  parish_id        uuid not null references public.parishes(id),
  member_no        text,                                 -- parish register number
  full_name        text not null,
  gender           text check (gender in ('male','female')),
  birth_year       int check (birth_year between 1900 and 2100),
  phone            text,
  family_id        uuid references public.families(id),
  relationship     text,                                 -- BABA, MAMA, MTOTO, ... (legacy UHUSIANO)
  jumuiya_id       uuid references public.org_units(id), -- current jumuiya (denormalised from family for people without a family)
  is_zaka_payer    boolean not null default false,       -- legacy "UTAMBUZI WA MLIPA ZAKA"
  membership_status text not null default 'active' check (membership_status in ('active','inactive','moved','deceased')),
  registered_on    date,
  profile_id       uuid unique references auth.users(id) on delete set null,  -- linked login account (verified by an admin)
  notes            text,
  legacy_ref       jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (parish_id, member_no)
);
create index if not exists parishioners_family_idx on public.parishioners (family_id);
create index if not exists parishioners_jumuiya_idx on public.parishioners (jumuiya_id);
create index if not exists parishioners_name_idx on public.parishioners (lower(full_name));
drop trigger if exists parishioners_touch on public.parishioners;
create trigger parishioners_touch before update on public.parishioners for each row execute function public.touch_updated_at();

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'families_head_fk') then
    alter table public.families add constraint families_head_fk
      foreign key (head_parishioner_id) references public.parishioners(id) on delete set null;
  end if;
end $$;

-- membership history (transfers between families / jumuiya keep the old attribution traceable)
create table if not exists public.membership_history (
  id              bigint generated always as identity primary key,
  parishioner_id  uuid references public.parishioners(id) on delete cascade,
  family_id       uuid references public.families(id) on delete cascade,
  from_jumuiya_id uuid references public.org_units(id),
  to_jumuiya_id   uuid references public.org_units(id),
  from_family_id  uuid references public.families(id),
  to_family_id    uuid references public.families(id),
  changed_on      date not null default current_date,
  reason          text,
  changed_by      uuid,
  created_at      timestamptz not null default now()
);

create or replace function public.track_membership_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'parishioners' then
    if new.jumuiya_id is distinct from old.jumuiya_id or new.family_id is distinct from old.family_id then
      insert into public.membership_history (parishioner_id, from_jumuiya_id, to_jumuiya_id, from_family_id, to_family_id, changed_by)
      values (new.id, old.jumuiya_id, new.jumuiya_id, old.family_id, new.family_id, auth.uid());
    end if;
  elsif new.jumuiya_id is distinct from old.jumuiya_id then
    insert into public.membership_history (family_id, from_jumuiya_id, to_jumuiya_id, changed_by)
    values (new.id, old.jumuiya_id, new.jumuiya_id, auth.uid());
    -- members of the family follow it
    update public.parishioners set jumuiya_id = new.jumuiya_id
     where family_id = new.id and jumuiya_id is not distinct from old.jumuiya_id;
  end if;
  return new;
end $$;
drop trigger if exists parishioners_membership on public.parishioners;
create trigger parishioners_membership after update on public.parishioners for each row execute function public.track_membership_change();
drop trigger if exists families_membership on public.families;
create trigger families_membership after update on public.families for each row execute function public.track_membership_change();

-- ---------------------------------------------------------------------------
-- Church leadership (separate from application permissions)
-- ---------------------------------------------------------------------------
create table if not exists public.leadership_positions (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  title_sw    text not null,
  title_en    text,
  level       text not null check (level in ('parish','kigango','jumuiya','group')),
  sort_order  int not null default 100
);

create table if not exists public.leadership_assignments (
  id              uuid primary key default gen_random_uuid(),
  position_id     uuid not null references public.leadership_positions(id),
  org_unit_id     uuid not null references public.org_units(id),
  parishioner_id  uuid references public.parishioners(id),
  holder_name     text not null,               -- kept even when the person is not in the register
  phone           text,
  starts_on       date,
  ends_on         date,
  status          text not null default 'active' check (status in ('active','ended')),
  notes           text,
  created_at      timestamptz not null default now(),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
create index if not exists leadership_org_idx on public.leadership_assignments (org_unit_id);

-- ---------------------------------------------------------------------------
-- Parish application roles & permissions (granular, scoped to an org unit)
--   Existing Kanisa Hub profiles.role (member/admin/super_admin) is kept;
--   profiles.role = 'super_admin' is treated as Platform Super Admin.
-- ---------------------------------------------------------------------------
create table if not exists public.parish_roles (
  code        text primary key,
  name_sw     text not null,
  name_en     text not null,
  scoped      boolean not null default false,     -- true = must be tied to a kigango/jumuiya
  sort_order  int not null default 100
);

create table if not exists public.role_permissions (
  role_code   text not null references public.parish_roles(code) on delete cascade,
  permission  text not null,
  primary key (role_code, permission)
);

create table if not exists public.parish_user_roles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  parish_id   uuid not null references public.parishes(id),
  role_code   text not null references public.parish_roles(code),
  org_unit_id uuid references public.org_units(id),        -- null = whole parish
  granted_by  uuid,
  granted_at  timestamptz not null default now(),
  unique (user_id, role_code, org_unit_id)
);
create index if not exists parish_user_roles_user_idx on public.parish_user_roles (user_id);

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin' and coalesce(status,'active') = 'active')
$$;

-- has_perm(permission, org_unit): true when the user holds a role granting the
-- permission whose scope is the whole parish or an ancestor of p_org.
-- p_org = null asks for parish-wide permission.
create or replace function public.has_perm(p_perm text, p_org uuid default null)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_platform_admin() or exists (
    select 1
    from public.parish_user_roles ur
    join public.role_permissions rp on rp.role_code = ur.role_code
    where ur.user_id = auth.uid()
      and rp.permission = p_perm
      and (case when ur.org_unit_id is null then true
                when p_org is null then false
                else public.org_is_within(p_org, ur.org_unit_id) end)
  )
$$;

-- any scope at all (used to decide whether a menu item should be shown)
create or replace function public.has_perm_anywhere(p_perm text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_platform_admin() or exists (
    select 1 from public.parish_user_roles ur join public.role_permissions rp on rp.role_code = ur.role_code
    where ur.user_id = auth.uid() and rp.permission = p_perm)
$$;

create or replace function public.my_parishioner_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.parishioners where profile_id = auth.uid() limit 1
$$;

create or replace function public.my_family_id()
returns uuid language sql stable security definer set search_path = public as $$
  select family_id from public.parishioners where profile_id = auth.uid() limit 1
$$;

-- what the current user may do — consumed by the frontend to build its menu
create or replace function public.my_parish_access()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'platform_admin', public.is_platform_admin(),
    'parishioner_id', public.my_parishioner_id(),
    'roles', coalesce((select jsonb_agg(jsonb_build_object('role', ur.role_code, 'org_unit_id', ur.org_unit_id,
                                 'org_unit', o.name, 'unit_type', o.unit_type))
                       from public.parish_user_roles ur left join public.org_units o on o.id = ur.org_unit_id
                       where ur.user_id = auth.uid()), '[]'::jsonb),
    'permissions', coalesce((select jsonb_agg(distinct rp.permission)
                             from public.parish_user_roles ur join public.role_permissions rp on rp.role_code = ur.role_code
                             where ur.user_id = auth.uid()), '[]'::jsonb)
  )
$$;

-- audit triggers on register tables
do $$ declare t text; begin
  foreach t in array array['parishes','org_units','families','parishioners','leadership_assignments','parish_user_roles','role_permissions'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row()', t || '_audit', t);
  end loop;
end $$;
