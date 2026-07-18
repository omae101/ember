-- Ember 클라우드 백업 스키마 (백업코드 방식)
-- 익명 로그인 + 8자리 코드로 다른 기기에서 복원. (아이담다 검증 구조 재활용)
-- Supabase SQL Editor에 통째로 붙여넣고 Run.
create extension if not exists pgcrypto;

create table if not exists public.spaces (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);
create table if not exists public.space_members (
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id  uuid not null references auth.users(id)  on delete cascade,
  role  text not null default 'member' check (role in ('owner','member')),
  label text,
  created_at timestamptz not null default now(),
  primary key (space_id, user_id)
);
create index if not exists idx_members_user on public.space_members(user_id);
create table if not exists public.pair_codes (
  code text primary key,
  space_id   uuid not null references public.spaces(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  used boolean not null default false
);
create table if not exists public.kv (
  space_id uuid not null references public.spaces(id) on delete cascade,
  slot text not null default 'main',
  k text not null,
  v jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (space_id, slot, k)
);
create index if not exists idx_kv_space on public.kv(space_id);

alter table public.spaces        enable row level security;
alter table public.space_members enable row level security;
alter table public.pair_codes    enable row level security;
alter table public.kv            enable row level security;

create or replace function public.is_member(p_space uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists(select 1 from public.space_members m
                where m.space_id = p_space and m.user_id = auth.uid());
$$;

drop policy if exists spaces_select on public.spaces;
drop policy if exists spaces_insert on public.spaces;
create policy spaces_select on public.spaces for select using (public.is_member(id));
create policy spaces_insert on public.spaces for insert with check (auth.uid() is not null);

drop policy if exists members_select on public.space_members;
drop policy if exists members_insert_self on public.space_members;
drop policy if exists members_delete_self on public.space_members;
create policy members_select on public.space_members for select using (public.is_member(space_id));
create policy members_insert_self on public.space_members for insert with check (user_id = auth.uid());
create policy members_delete_self on public.space_members for delete using (user_id = auth.uid());

drop policy if exists codes_insert on public.pair_codes;
create policy codes_insert on public.pair_codes for insert with check (public.is_member(space_id));

drop policy if exists kv_select on public.kv;
drop policy if exists kv_write  on public.kv;
create policy kv_select on public.kv for select using (public.is_member(space_id));
create policy kv_write  on public.kv for all   using (public.is_member(space_id)) with check (public.is_member(space_id));

-- 8자리 영숫자 코드 생성 (extensions 스키마의 pgcrypto 참조)
create or replace function public.gen_pair_code()
returns text language sql volatile set search_path = public, extensions as $$
  select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + (get_byte(b, i) % 31), 1), '')
  from (select gen_random_bytes(8) as b) s, generate_series(0, 7) as i;
$$;

-- 이 기기: 백업 공간 만들고 코드 발급
create or replace function public.create_space_with_code()
returns json language plpgsql security definer set search_path = public as $$
declare v_space uuid; v_code text;
begin
  if auth.uid() is null then raise exception 'auth required'; end if;
  insert into public.spaces default values returning id into v_space;
  insert into public.space_members(space_id, user_id, role, label) values (v_space, auth.uid(), 'owner', 'main');
  v_code := public.gen_pair_code();
  insert into public.pair_codes(code, space_id, created_by, expires_at)
    values (v_code, v_space, auth.uid(), now() + interval '30 days');
  return json_build_object('space_id', v_space, 'code', v_code);
end; $$;

-- 다른 기기: 코드로 복원 참여
create or replace function public.join_space(p_code text)
returns json language plpgsql security definer set search_path = public as $$
declare v_space uuid;
begin
  if auth.uid() is null then raise exception 'auth required'; end if;
  select space_id into v_space from public.pair_codes
    where code = upper(trim(p_code)) and expires_at > now();
  if v_space is null then raise exception 'invalid_or_expired'; end if;
  insert into public.space_members(space_id, user_id, role, label)
    values (v_space, auth.uid(), 'member', 'device') on conflict do nothing;
  return json_build_object('space_id', v_space);
end; $$;

do $$ begin
  alter publication supabase_realtime add table public.kv;
exception when duplicate_object then null; end $$;
