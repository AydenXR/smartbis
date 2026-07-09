create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member',
  created_at timestamptz not null default timezone('utc', now()),
  unique (tenant_id, user_id)
);

create index if not exists memberships_user_id_idx on public.memberships (user_id);
create index if not exists memberships_tenant_id_idx on public.memberships (tenant_id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'memberships_role_check'
      and conrelid = 'public.memberships'::regclass
  ) then
    alter table public.memberships
      add constraint memberships_role_check
      check (role in ('owner', 'admin', 'member'));
  end if;
end
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

drop trigger if exists tenants_set_updated_at on public.tenants;
create trigger tenants_set_updated_at
before update on public.tenants
for each row
execute function public.set_updated_at();

create or replace function public.bootstrap_user_account(p_user_id uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_workspace_label text;
  v_workspace_slug text;
  v_tenant_id uuid;
begin
  v_email := lower(coalesce(nullif(trim(p_email), ''), concat(p_user_id::text, '@smartbis.local')));

  insert into public.profiles (id, email)
  values (p_user_id, v_email)
  on conflict (id) do update
    set email = excluded.email,
        updated_at = timezone('utc', now());

  if exists (
    select 1
    from public.memberships
    where user_id = p_user_id
  ) then
    return;
  end if;

  v_workspace_label := split_part(v_email, '@', 1);
  v_workspace_slug := lower(regexp_replace(v_workspace_label, '[^a-zA-Z0-9]+', '-', 'g'));
  v_workspace_slug := trim(both '-' from v_workspace_slug);
  v_workspace_slug := concat(
    coalesce(nullif(v_workspace_slug, ''), 'workspace'),
    '-',
    substr(replace(p_user_id::text, '-', ''), 1, 8)
  );

  insert into public.tenants (name, slug, created_by)
  values (
    concat(initcap(coalesce(nullif(v_workspace_label, ''), 'workspace')), ' Workspace'),
    v_workspace_slug,
    p_user_id
  )
  returning id into v_tenant_id;

  insert into public.memberships (tenant_id, user_id, role)
  values (v_tenant_id, p_user_id, 'owner');
end;
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.bootstrap_user_account(new.id, new.email);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_auth_user();

do $$
declare
  existing_user record;
begin
  for existing_user in
    select id, email
    from auth.users
  loop
    perform public.bootstrap_user_account(existing_user.id, existing_user.email);
  end loop;
end
$$;

alter table public.profiles enable row level security;
alter table public.tenants enable row level security;
alter table public.memberships enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_select_own'
  ) then
    create policy profiles_select_own
      on public.profiles
      for select
      to authenticated
      using (auth.uid() = id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_update_own'
  ) then
    create policy profiles_update_own
      on public.profiles
      for update
      to authenticated
      using (auth.uid() = id)
      with check (auth.uid() = id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'tenants' and policyname = 'tenants_select_member'
  ) then
    create policy tenants_select_member
      on public.tenants
      for select
      to authenticated
      using (
        exists (
          select 1
          from public.memberships
          where memberships.tenant_id = tenants.id
            and memberships.user_id = auth.uid()
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'tenants' and policyname = 'tenants_update_owner_admin'
  ) then
    create policy tenants_update_owner_admin
      on public.tenants
      for update
      to authenticated
      using (
        exists (
          select 1
          from public.memberships
          where memberships.tenant_id = tenants.id
            and memberships.user_id = auth.uid()
            and memberships.role in ('owner', 'admin')
        )
      )
      with check (
        exists (
          select 1
          from public.memberships
          where memberships.tenant_id = tenants.id
            and memberships.user_id = auth.uid()
            and memberships.role in ('owner', 'admin')
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'memberships' and policyname = 'memberships_select_own'
  ) then
    create policy memberships_select_own
      on public.memberships
      for select
      to authenticated
      using (user_id = auth.uid());
  end if;
end
$$;

grant select, update on public.profiles to authenticated;
grant select on public.tenants to authenticated;
grant select on public.memberships to authenticated;
