-- Compteur par village (une ligne par village, lock atomique sur UPDATE)
create table mission_counters (
  village     text primary key check (village in ('konoha','oto','suna','kiri')),
  next_number int  not null default 1
);

insert into mission_counters (village) values
  ('konoha'), ('oto'), ('suna'), ('kiri');

-- Missions
create table missions (
  id              bigserial primary key,
  village         text not null check (village in ('konoha','oto','suna','kiri')),
  rang            text not null check (rang in ('D','C','B','A','S')),
  village_number  int  not null,
  description     text not null,
  author_id       text not null,
  author_name     text not null,
  channel_id      text,
  message_id      text,
  created_at      timestamptz default now(),
  updated_at      timestamptz,

  unique (village, village_number)
);

create index missions_author_idx on missions (author_id);
