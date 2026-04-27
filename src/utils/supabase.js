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

const formatMissionNumber = (n) => `#${String(n).padStart(5, '0')}`;

module.exports = {
  supabase,
  createMission,
  getMission,
  getMissionById,
  updateMissionDescription,
  attachDiscordRefs,
  formatMissionNumber,
};
