alter table mission_counters
  drop constraint if exists mission_counters_village_check;

alter table mission_counters
  add constraint mission_counters_village_check
  check (village in ('konoha','oto','suna','kiri','samurai'));

alter table missions
  drop constraint if exists missions_village_check;

alter table missions
  add constraint missions_village_check
  check (village in ('konoha','oto','suna','kiri','samurai'));

insert into mission_counters (village)
  values ('samurai')
  on conflict (village) do nothing;
