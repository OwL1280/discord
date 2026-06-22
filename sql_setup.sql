-- Discord Clone Database Schema
-- Run this script in the Supabase SQL Editor.

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Create tables
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  username text unique not null,
  display_name text,
  avatar_url text,
  status text default 'offline' check (status in ('online', 'idle', 'dnd', 'offline')),
  custom_status text,
  created_at timestamptz default now()
);

create table if not exists public.guilds (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  icon_url text,
  owner_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now()
);

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  guild_id uuid references public.guilds(id) on delete cascade not null,
  name text not null,
  color text default '#b9bbbe',
  permissions bigint default 68608, -- Default permissions: VIEW_CHANNEL (1024) | SEND_MESSAGES (2048) | READ_MESSAGE_HISTORY (65536) = 68608
  position integer default 0,
  created_at timestamptz default now()
);

create table if not exists public.members (
  guild_id uuid references public.guilds(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  nickname text,
  joined_at timestamptz default now(),
  primary key (guild_id, user_id)
);

create table if not exists public.member_roles (
  guild_id uuid references public.guilds(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  role_id uuid references public.roles(id) on delete cascade not null,
  primary key (guild_id, user_id, role_id)
);

create table if not exists public.channels (
  id uuid primary key default gen_random_uuid(),
  guild_id uuid references public.guilds(id) on delete cascade not null,
  name text not null,
  type text default 'text' check (type in ('text', 'voice')),
  position integer default 0,
  created_at timestamptz default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid references public.channels(id) on delete cascade not null,
  author_id uuid references public.profiles(id) on delete cascade not null,
  content text not null,
  created_at timestamptz default now()
);

create table if not exists public.invites (
  code text primary key,
  guild_id uuid references public.guilds(id) on delete cascade not null,
  channel_id uuid references public.channels(id) on delete cascade not null,
  inviter_id uuid references public.profiles(id) on delete cascade not null,
  uses integer default 0,
  max_uses integer,
  expires_at timestamptz,
  created_at timestamptz default now()
);

-- Enable RLS
alter table public.profiles enable row level security;
alter table public.guilds enable row level security;
alter table public.roles enable row level security;
alter table public.members enable row level security;
alter table public.member_roles enable row level security;
alter table public.channels enable row level security;
alter table public.messages enable row level security;
alter table public.invites enable row level security;

-- Setup triggers for Profile creation when user signs up
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, username, display_name, avatar_url, status)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url',
    'online'
  );
  return new;
end;
$$ language plpgsql security definer;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Setup permissions helper functions
create or replace function public.check_permission(guild_id uuid, user_id uuid, req_perm bigint)
returns boolean as $$
declare
  is_owner boolean;
  user_perms bigint;
begin
  -- 1. Check if owner
  select (owner_id = user_id) into is_owner from public.guilds where id = check_permission.guild_id;
  if is_owner then
    return true;
  end if;

  -- 2. Calculate permissions (bitwise OR of roles, including everyone)
  select coalesce(bit_or(r.permissions), 0) into user_perms
  from public.roles r
  where r.guild_id = check_permission.guild_id
    and (
      r.id in (select role_id from public.member_roles mr where mr.guild_id = check_permission.guild_id and mr.user_id = check_permission.user_id)
      or r.name = '@everyone'
    );

  -- 3. Check if ADMIN (8) or the required permission is set
  if (user_perms & 8) = 8 or (user_perms & req_perm) = req_perm then
    return true;
  end if;

  return false;
end;
$$ language plpgsql security definer;

-- RPC: Guild Creation
create or replace function public.create_guild(guild_name text)
returns json as $$
declare
  new_guild_id uuid;
  everyone_role_id uuid;
  general_channel_id uuid;
  curr_user_id uuid;
begin
  curr_user_id := auth.uid();
  if curr_user_id is null then
    raise exception 'Not authenticated';
  end if;

  -- 1. Create guild
  insert into public.guilds (name, owner_id)
  values (guild_name, curr_user_id)
  returning id into new_guild_id;

  -- 2. Create @everyone role (VIEW_CHANNEL (1024) + SEND_MESSAGES (2048) + READ_MESSAGE_HISTORY (65536) = 68608)
  insert into public.roles (guild_id, name, color, permissions, position)
  values (new_guild_id, '@everyone', '#b9bbbe', 68608, 0)
  returning id into everyone_role_id;

  -- 3. Create General channel
  insert into public.channels (guild_id, name, type, position)
  values (new_guild_id, 'general', 'text', 0)
  returning id into general_channel_id;

  -- 4. Add owner as member
  insert into public.members (guild_id, user_id)
  values (new_guild_id, curr_user_id);

  return json_build_object(
    'guild_id', new_guild_id,
    'everyone_role_id', everyone_role_id,
    'general_channel_id', general_channel_id
  );
end;
$$ language plpgsql security definer;

-- RPC: Join Guild with Invite
create or replace function public.join_guild(invite_code text)
returns json as $$
declare
  invite_rec record;
  curr_user_id uuid;
begin
  curr_user_id := auth.uid();
  if curr_user_id is null then
    raise exception 'Not authenticated';
  end if;

  -- Fetch invite details
  select * into invite_rec from public.invites where code = invite_code;
  if not found then
    raise exception 'Invalid invite code';
  end if;

  -- Check expiry
  if invite_rec.expires_at is not null and invite_rec.expires_at < now() then
    raise exception 'Invite code expired';
  end if;

  -- Check max uses
  if invite_rec.max_uses is not null and invite_rec.uses >= invite_rec.max_uses then
    raise exception 'Invite code limit reached';
  end if;

  -- Check if already member
  if exists (select 1 from public.members where guild_id = invite_rec.guild_id and user_id = curr_user_id) then
    return json_build_object(
      'guild_id', invite_rec.guild_id,
      'message', 'Already a member'
    );
  end if;

  -- Add to guild
  insert into public.members (guild_id, user_id)
  values (invite_rec.guild_id, curr_user_id);

  -- Increment uses
  update public.invites set uses = uses + 1 where code = invite_code;

  return json_build_object(
    'guild_id', invite_rec.guild_id,
    'message', 'Successfully joined'
  );
end;
$$ language plpgsql security definer;

-- Security Definer function to bypass RLS recursion on the members table
create or replace function public.is_guild_member(guild_id uuid, user_id uuid)
returns boolean as $$
begin
  return exists (
    select 1 from public.members m
    where m.guild_id = is_guild_member.guild_id
      and m.user_id = is_guild_member.user_id
  );
end;
$$ language plpgsql security definer;

-- RLS Policies
-- Profiles
create policy "Allow public read profiles" on public.profiles for select to authenticated using (true);
create policy "Allow updates for self profile" on public.profiles for update to authenticated using (auth.uid() = id);

-- Guilds
create policy "Allow select guilds if member" on public.guilds for select to authenticated
  using (public.is_guild_member(id, auth.uid()));
create policy "Allow update guild if owner" on public.guilds for update to authenticated
  using (owner_id = auth.uid());
create policy "Allow delete guild if owner" on public.guilds for delete to authenticated
  using (owner_id = auth.uid());

-- Roles
create policy "Allow select roles if member" on public.roles for select to authenticated
  using (public.is_guild_member(guild_id, auth.uid()));
create policy "Allow modify roles if user has MANAGE_ROLES (268435456)" on public.roles for all to authenticated
  using (public.check_permission(guild_id, auth.uid(), 268435456));

-- Members
create policy "Allow select members if member" on public.members for select to authenticated
  using (true);
create policy "Allow kick members if user has KICK_MEMBERS (2)" on public.members for delete to authenticated
  using (public.check_permission(guild_id, auth.uid(), 2));

-- Member Roles
create policy "Allow select member roles if member" on public.member_roles for select to authenticated
  using (true);
create policy "Allow modify member roles if user has MANAGE_ROLES" on public.member_roles for all to authenticated
  using (public.check_permission(guild_id, auth.uid(), 268435456));

-- Channels
create policy "Allow select channels if member" on public.channels for select to authenticated
  using (public.is_guild_member(guild_id, auth.uid()));
create policy "Allow modify channels if user has MANAGE_CHANNELS (16)" on public.channels for all to authenticated
  using (public.check_permission(guild_id, auth.uid(), 16));

-- Messages
create policy "Allow select messages if member" on public.messages for select to authenticated
  using (exists (
    select 1 from public.channels c
    where c.id = messages.channel_id
      and public.is_guild_member(c.guild_id, auth.uid())
  ));
create policy "Allow insert messages if member and has SEND_MESSAGES (2048)" on public.messages for insert to authenticated
  with check (
    exists (
      select 1 from public.channels c
      where c.id = messages.channel_id
        and public.is_guild_member(c.guild_id, auth.uid())
    ) AND (
      select public.check_permission((select guild_id from public.channels where id = messages.channel_id), auth.uid(), 2048)
    )
  );
create policy "Allow update message if author" on public.messages for update to authenticated
  using (author_id = auth.uid());
create policy "Allow delete message if author or MANAGE_MESSAGES (8192)" on public.messages for delete to authenticated
  using (
    author_id = auth.uid() OR 
    public.check_permission((select guild_id from public.channels where id = messages.channel_id), auth.uid(), 8192)
  );

-- Invites
create policy "Allow select invites if member" on public.invites for select to authenticated
  using (public.is_guild_member(guild_id, auth.uid()));
create policy "Allow insert invites if user has CREATE_INSTANT_INVITE (1)" on public.invites for insert to authenticated
  with check (public.check_permission(guild_id, auth.uid(), 1));
create policy "Allow delete invites if user has MANAGE_GUILD (32)" on public.invites for delete to authenticated
  using (public.check_permission(guild_id, auth.uid(), 32));
