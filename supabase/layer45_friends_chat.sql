-- Слой 45: друзья и личные сообщения.
--
-- Правила:
--   • дружба — заявка → принять; писать можно только друзьям;
--   • участвовать могут одобренные тренером взрослые аккаунты (ученики и тренеры);
--     детские аккаунты (parent_id) в друзья не добавляются и переписки не имеют;
--   • переписку видят только двое её участников — тренер чужие сообщения не читает;
--   • защита от спама: 40 заявок в сутки, 30 сообщений в минуту.

create table if not exists public.friendships (
  requester uuid not null references public.profiles (id) on delete cascade,
  addressee uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (requester, addressee),
  check (requester <> addressee)
);
-- одна пара — одна запись, в какую бы сторону ни шла заявка
create unique index if not exists friendships_pair_idx
  on public.friendships (least(requester, addressee), greatest(requester, addressee));
create index if not exists friendships_addressee_idx on public.friendships (addressee);

create table if not exists public.messages (
  id bigint generated always as identity primary key,
  sender uuid not null references public.profiles (id) on delete cascade,
  recipient uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  check (sender <> recipient)
);
create index if not exists messages_pair_idx
  on public.messages (least(sender, recipient), greatest(sender, recipient), created_at desc);
create index if not exists messages_unread_idx on public.messages (recipient) where read_at is null;

alter table public.friendships enable row level security;
alter table public.messages enable row level security;

drop policy if exists friendships_own on public.friendships;
create policy friendships_own on public.friendships for select to authenticated
  using ((select auth.uid()) in (requester, addressee));

drop policy if exists messages_own on public.messages;
create policy messages_own on public.messages for select to authenticated
  using ((select auth.uid()) in (sender, recipient));
-- запись — только через функции ниже
revoke insert, update, delete on public.friendships from anon, authenticated;
revoke insert, update, delete on public.messages from anon, authenticated;

-- Новые сообщения приходят сразу (Realtime учитывает политику выше).
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'friendships') then
    alter publication supabase_realtime add table public.friendships;
  end if;
end $$;

-- Может ли аккаунт участвовать в друзьях/чате.
create or replace function public.can_chat(p_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
     where id = p_id and parent_id is null and approved_at is not null
       and role in ('athlete', 'coach', 'admin')
  );
$$;

create or replace function public.are_friends(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.friendships
     where status = 'accepted'
       and least(requester, addressee) = least(a, b)
       and greatest(requester, addressee) = greatest(a, b)
  );
$$;

-- Кого можно найти и добавить: одобренные взрослые аккаунты клуба (имя и фото).
create or replace function public.chat_people()
returns table (id uuid, first_name text, last_name text, avatar_url text, role text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.first_name, p.last_name, p.avatar_url, p.role
    from public.profiles p
   where public.can_chat((select auth.uid()))
     and p.id <> (select auth.uid())
     and p.parent_id is null and p.approved_at is not null
     and p.role in ('athlete', 'coach', 'admin')
   order by p.first_name, p.last_name;
$$;

-- Мои друзья и заявки + последнее сообщение и число непрочитанных.
create or replace function public.my_friends()
returns table (
  id uuid, first_name text, last_name text, avatar_url text, role text,
  status text,          -- accepted | incoming | outgoing
  last_body text, last_at timestamptz, last_mine boolean, unread integer
)
language sql stable security definer set search_path = '' as $$
  with me as (select (select auth.uid()) as uid),
  f as (
    select case when fr.requester = me.uid then fr.addressee else fr.requester end as other,
           case when fr.status = 'accepted' then 'accepted'
                when fr.addressee = me.uid then 'incoming' else 'outgoing' end as status,
           coalesce(fr.accepted_at, fr.created_at) as since
      from public.friendships fr, me
     where me.uid in (fr.requester, fr.addressee)
  )
  select p.id, p.first_name, p.last_name, p.avatar_url, p.role, f.status,
         lm.body, lm.created_at, lm.sender = me.uid,
         (select count(*)::int from public.messages m
           where m.sender = f.other and m.recipient = me.uid and m.read_at is null)
    from f
    join public.profiles p on p.id = f.other
    cross join me
    left join lateral (
      select m.body, m.created_at, m.sender from public.messages m
       where (m.sender = me.uid and m.recipient = f.other) or (m.sender = f.other and m.recipient = me.uid)
       order by m.created_at desc limit 1
    ) lm on true
   order by (f.status = 'incoming') desc, coalesce(lm.created_at, f.since) desc;
$$;

create or replace function public.chat_unread()
returns integer language sql stable security definer set search_path = '' as $$
  select (select count(*)::int from public.messages where recipient = (select auth.uid()) and read_at is null)
       + (select count(*)::int from public.friendships where addressee = (select auth.uid()) and status = 'pending');
$$;

create or replace function public.send_friend_request(p_to uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_row public.friendships;
begin
  if v_uid is null then raise exception 'Войдите в приложение' using errcode = '42501'; end if;
  if p_to = v_uid then raise exception 'Себя добавить нельзя'; end if;
  if not public.can_chat(v_uid) then raise exception 'Друзья доступны после того, как тренер подтвердит ваш аккаунт'; end if;
  if not public.can_chat(p_to) then raise exception 'Этого человека добавить нельзя'; end if;

  select * into v_row from public.friendships
   where least(requester, addressee) = least(v_uid, p_to)
     and greatest(requester, addressee) = greatest(v_uid, p_to);
  if found then
    if v_row.status = 'accepted' then return 'accepted'; end if;
    -- встречная заявка уже есть — значит, оба хотят: сразу друзья
    if v_row.addressee = v_uid then
      update public.friendships set status = 'accepted', accepted_at = now()
       where requester = v_row.requester and addressee = v_row.addressee;
      return 'accepted';
    end if;
    return 'pending';
  end if;

  if (select count(*) from public.friendships where requester = v_uid and created_at > now() - interval '1 day') >= 40 then
    raise exception 'Слишком много заявок за сутки';
  end if;
  insert into public.friendships (requester, addressee) values (v_uid, p_to);
  return 'pending';
end;
$$;

create or replace function public.respond_friend_request(p_from uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_accept then
    update public.friendships set status = 'accepted', accepted_at = now()
     where requester = p_from and addressee = auth.uid() and status = 'pending';
  else
    delete from public.friendships
     where requester = p_from and addressee = auth.uid() and status = 'pending';
  end if;
end;
$$;

-- Удалить из друзей / отменить свою заявку. Переписка остаётся, но писать больше нельзя.
create or replace function public.remove_friend(p_other uuid)
returns void language sql security definer set search_path = '' as $$
  delete from public.friendships
   where least(requester, addressee) = least(auth.uid(), p_other)
     and greatest(requester, addressee) = greatest(auth.uid(), p_other);
$$;

create or replace function public.send_message(p_to uuid, p_body text)
returns public.messages language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_msg public.messages;
begin
  if v_uid is null then raise exception 'Войдите в приложение' using errcode = '42501'; end if;
  if not public.are_friends(v_uid, p_to) then raise exception 'Писать можно только друзьям'; end if;
  if not (public.can_chat(v_uid) and public.can_chat(p_to)) then raise exception 'Переписка недоступна'; end if;
  if char_length(btrim(coalesce(p_body, ''))) = 0 then raise exception 'Пустое сообщение'; end if;
  if char_length(p_body) > 2000 then raise exception 'Слишком длинное сообщение (до 2000 знаков)'; end if;
  if (select count(*) from public.messages where sender = v_uid and created_at > now() - interval '1 minute') >= 30 then
    raise exception 'Слишком много сообщений подряд, подождите минуту';
  end if;
  insert into public.messages (sender, recipient, body) values (v_uid, p_to, btrim(p_body)) returning * into v_msg;
  return v_msg;
end;
$$;

create or replace function public.mark_chat_read(p_other uuid)
returns void language sql security definer set search_path = '' as $$
  update public.messages set read_at = now()
   where recipient = auth.uid() and sender = p_other and read_at is null;
$$;

revoke execute on function public.can_chat(uuid), public.are_friends(uuid, uuid) from anon, public;
revoke execute on function public.chat_people(), public.my_friends(), public.chat_unread(),
  public.send_friend_request(uuid), public.respond_friend_request(uuid, boolean),
  public.remove_friend(uuid), public.send_message(uuid, text), public.mark_chat_read(uuid) from anon, public;
grant execute on function public.chat_people(), public.my_friends(), public.chat_unread(),
  public.send_friend_request(uuid), public.respond_friend_request(uuid, boolean),
  public.remove_friend(uuid), public.send_message(uuid, text), public.mark_chat_read(uuid) to authenticated;
