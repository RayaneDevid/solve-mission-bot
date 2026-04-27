create or replace function create_mission(
  p_village     text,
  p_rang        text,
  p_description text,
  p_author_id   text,
  p_author_name text
)
returns table (id bigint, village_number int)
language plpgsql
as $$
declare
  v_number int;
  v_id     bigint;
begin
  -- Réserve atomiquement le prochain numéro pour ce village
  update mission_counters
    set next_number = next_number + 1
    where village = p_village
    returning next_number - 1 into v_number;

  if v_number is null then
    raise exception 'Village inconnu : %', p_village;
  end if;

  -- Insert la mission avec ce numéro
  insert into missions (village, rang, village_number, description, author_id, author_name)
    values (p_village, p_rang, v_number, p_description, p_author_id, p_author_name)
    returning missions.id into v_id;

  return query select v_id, v_number;
end;
$$;
