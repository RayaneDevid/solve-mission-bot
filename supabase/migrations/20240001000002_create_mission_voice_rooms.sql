create table if not exists mission_voice_hubs (
  guild_id    text not null,
  channel_id  text not null,
  category_id text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz,

  primary key (guild_id, channel_id)
);

create index if not exists mission_voice_hubs_guild_idx
  on mission_voice_hubs (guild_id);

create table if not exists mission_voice_rooms (
  guild_id       text not null,
  channel_id     text not null,
  category_id    text not null,
  owner_id       text not null,
  hub_channel_id text not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz,

  primary key (guild_id, channel_id)
);

create index if not exists mission_voice_rooms_guild_idx
  on mission_voice_rooms (guild_id);

create index if not exists mission_voice_rooms_hub_idx
  on mission_voice_rooms (guild_id, hub_channel_id);
