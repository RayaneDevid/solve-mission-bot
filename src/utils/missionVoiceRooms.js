'use strict';
const fs = require('fs');
const path = require('path');
const { ChannelType } = require('discord.js');
const { MISSION_VOICE_CONNECT_ROLE_ID, MISSION_VOICE_HUB_NAME } = require('../config');

const STATE_PATH = path.join(__dirname, '..', '..', 'data', 'mission-voice-rooms.json');
const missionRoomPattern = /^┃🎙️・Mission (\d+)$/;
const creationQueues = new Map();

function emptyState() {
  return { hubs: {}, rooms: {} };
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error({ event: 'missionVoice.state.readError', error: err.message });
    }
    return emptyState();
  }
}

function writeState(state) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
}

function ensureGuildBucket(state, guildId) {
  state.hubs[guildId] ??= {};
  state.rooms[guildId] ??= {};
}

function registerMissionVoiceHub(guildId, channelId, categoryId) {
  const state = readState();
  ensureGuildBucket(state, guildId);
  state.hubs[guildId][channelId] = {
    categoryId,
    createdAt: new Date().toISOString(),
  };
  writeState(state);
}

function registerMissionRoom(guildId, channelId, categoryId, ownerId, hubChannelId) {
  const state = readState();
  ensureGuildBucket(state, guildId);
  state.rooms[guildId][channelId] = {
    categoryId,
    ownerId,
    hubChannelId,
    createdAt: new Date().toISOString(),
  };
  writeState(state);
}

function unregisterMissionRoom(guildId, channelId) {
  const state = readState();
  if (!state.rooms[guildId]?.[channelId]) return;
  delete state.rooms[guildId][channelId];
  writeState(state);
}

function isMissionVoiceHub(guildId, channelId) {
  const state = readState();
  return Boolean(state.hubs[guildId]?.[channelId]);
}

function isMissionRoom(guildId, channelId) {
  const state = readState();
  return Boolean(state.rooms[guildId]?.[channelId]);
}

function getNextMissionRoomName(guild, categoryId) {
  const used = new Set();

  for (const channel of guild.channels.cache.values()) {
    if (channel.type !== ChannelType.GuildVoice || channel.parentId !== categoryId) continue;
    const match = channel.name.match(missionRoomPattern);
    if (match) used.add(Number(match[1]));
  }

  let num = 1;
  while (used.has(num)) num += 1;
  return `Mission ${num}`;
}

async function createMissionRoomForMember(newState) {
  const hubChannel = newState.channel;
  const categoryId = hubChannel.parentId;

  if (!categoryId) {
    console.error({
      event: 'missionVoice.noCategory',
      hubChannelId: hubChannel.id,
      guildId: newState.guild.id,
    });
    return;
  }

  const queueKey = `${newState.guild.id}:${categoryId}`;
  const previous = creationQueues.get(queueKey) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    const name = getNextMissionRoomName(newState.guild, categoryId);
    let room;

    try {
      room = await newState.guild.channels.create({
        name,
        type: ChannelType.GuildVoice,
        parent: categoryId,
        reason: `Salon mission temporaire pour ${newState.member.user.tag}`,
      });

      await room.lockPermissions();
      await room.permissionOverwrites.edit(
        MISSION_VOICE_CONNECT_ROLE_ID,
        { Connect: true },
        { reason: 'Autoriser le rôle mission à rejoindre les salons mission temporaires' }
      );

      registerMissionRoom(newState.guild.id, room.id, categoryId, newState.member.id, hubChannel.id);

      if (newState.member.voice.channelId !== hubChannel.id) {
        if (room.members.size === 0) {
          await room.delete('Suppression car le membre a quitté le hub avant le déplacement').catch(() => {});
          unregisterMissionRoom(newState.guild.id, room.id);
        }
        return;
      }

      await newState.setChannel(room, `Création automatique de ${name}`);
      console.log({
        event: 'missionVoice.roomCreated',
        roomId: room.id,
        roomName: room.name,
        userId: newState.member.id,
      });
    } catch (err) {
      console.error({
        event: 'missionVoice.roomCreateError',
        guildId: newState.guild.id,
        roomId: room?.id,
        userId: newState.member.id,
        error: err.message,
      });

      if (room?.members.size === 0) {
        await room.delete('Suppression après erreur de configuration').catch(() => {});
        unregisterMissionRoom(newState.guild.id, room.id);
      }

      throw err;
    }
  });

  creationQueues.set(queueKey, next);
  next.then(() => {
    if (creationQueues.get(queueKey) === next) creationQueues.delete(queueKey);
  }, () => {
    if (creationQueues.get(queueKey) === next) creationQueues.delete(queueKey);
  });
  await next;
}

async function deleteMissionRoomIfEmpty(guild, channelId) {
  if (!isMissionRoom(guild.id, channelId)) return;

  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel) {
    unregisterMissionRoom(guild.id, channelId);
    return;
  }

  if (channel.type !== ChannelType.GuildVoice || channel.members.size > 0) return;

  await channel.delete('Salon mission temporaire vide');
  unregisterMissionRoom(guild.id, channelId);
  console.log({ event: 'missionVoice.roomDeleted', roomId: channelId });
}

async function cleanupEmptyMissionRooms(client) {
  const state = readState();

  for (const [guildId, rooms] of Object.entries(state.rooms)) {
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) continue;

    for (const channelId of Object.keys(rooms)) {
      await deleteMissionRoomIfEmpty(guild, channelId);
    }
  }
}

function scheduleDeleteMissionRoomIfEmpty(guild, channelId) {
  setTimeout(() => {
    deleteMissionRoomIfEmpty(guild, channelId).catch(err => {
      console.error({ event: 'missionVoice.deleteError', channelId, error: err.message });
    });
  }, 1500);
}

async function handleMissionVoiceStateUpdate(oldState, newState) {
  const joinedHub = newState.channelId && isMissionVoiceHub(newState.guild.id, newState.channelId);
  const changedChannel = oldState.channelId !== newState.channelId;

  if (oldState.channelId && changedChannel) {
    scheduleDeleteMissionRoomIfEmpty(oldState.guild, oldState.channelId);
  }

  if (joinedHub && changedChannel) {
    await createMissionRoomForMember(newState);
  }
}

async function createMissionVoiceHub(interaction, category) {
  const existing = interaction.guild.channels.cache.find(channel =>
    channel.type === ChannelType.GuildVoice &&
    channel.parentId === category.id &&
    channel.name === MISSION_VOICE_HUB_NAME
  );

  if (existing) {
    registerMissionVoiceHub(interaction.guild.id, existing.id, category.id);
    return { channel: existing, created: false };
  }

  const channel = await interaction.guild.channels.create({
    name: MISSION_VOICE_HUB_NAME,
    type: ChannelType.GuildVoice,
    parent: category.id,
    reason: `Création du hub vocal mission par ${interaction.user.tag}`,
  });

  await channel.lockPermissions();
  registerMissionVoiceHub(interaction.guild.id, channel.id, category.id);
  return { channel, created: true };
}

module.exports = {
  cleanupEmptyMissionRooms,
  createMissionVoiceHub,
  handleMissionVoiceStateUpdate,
  registerMissionVoiceHub,
  MISSION_VOICE_HUB_NAME,
};
