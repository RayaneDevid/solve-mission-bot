'use strict';
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function createMission({ village, rang, description, authorId, authorName }) {
  const { data, error } = await supabase.rpc('create_mission', {
    p_village:     village,
    p_rang:        rang,
    p_description: description,
    p_author_id:   authorId,
    p_author_name: authorName,
  });
  if (error) throw error;
  const { id, village_number } = data[0];
  return { id, villageNumber: village_number };
}

async function getMission({ village, villageNumber }) {
  const { data, error } = await supabase
    .from('missions')
    .select('*')
    .eq('village', village)
    .eq('village_number', villageNumber)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getMissionById(id) {
  const { data, error } = await supabase
    .from('missions')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

async function updateMissionDescription(id, description) {
  const { data, error } = await supabase
    .from('missions')
    .update({ description, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function attachDiscordRefs(id, channelId, messageId) {
  const { error } = await supabase
    .from('missions')
    .update({ channel_id: channelId, message_id: messageId })
    .eq('id', id);
  if (error) throw error;
}

async function upsertMissionVoiceHub({ guildId, channelId, categoryId }) {
  const { error } = await supabase
    .from('mission_voice_hubs')
    .upsert({
      guild_id: guildId,
      channel_id: channelId,
      category_id: categoryId,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'guild_id,channel_id',
    });
  if (error) throw error;
}

async function getMissionVoiceHub({ guildId, channelId }) {
  const { data, error } = await supabase
    .from('mission_voice_hubs')
    .select('*')
    .eq('guild_id', guildId)
    .eq('channel_id', channelId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function upsertMissionVoiceRoom({ guildId, channelId, categoryId, ownerId, hubChannelId }) {
  const { error } = await supabase
    .from('mission_voice_rooms')
    .upsert({
      guild_id: guildId,
      channel_id: channelId,
      category_id: categoryId,
      owner_id: ownerId,
      hub_channel_id: hubChannelId,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'guild_id,channel_id',
    });
  if (error) throw error;
}

async function getMissionVoiceRoom({ guildId, channelId }) {
  const { data, error } = await supabase
    .from('mission_voice_rooms')
    .select('*')
    .eq('guild_id', guildId)
    .eq('channel_id', channelId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function deleteMissionVoiceRoom({ guildId, channelId }) {
  const { error } = await supabase
    .from('mission_voice_rooms')
    .delete()
    .eq('guild_id', guildId)
    .eq('channel_id', channelId);
  if (error) throw error;
}

async function listMissionVoiceRooms() {
  const { data, error } = await supabase
    .from('mission_voice_rooms')
    .select('*');
  if (error) throw error;
  return data;
}

const formatMissionNumber = (n) => `#${String(n).padStart(5, '0')}`;

module.exports = {
  supabase,
  createMission,
  getMission,
  getMissionById,
  updateMissionDescription,
  attachDiscordRefs,
  upsertMissionVoiceHub,
  getMissionVoiceHub,
  upsertMissionVoiceRoom,
  getMissionVoiceRoom,
  deleteMissionVoiceRoom,
  listMissionVoiceRooms,
  formatMissionNumber,
};
