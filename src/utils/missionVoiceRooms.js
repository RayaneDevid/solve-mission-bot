'use strict';
const { ChannelType } = require('discord.js');
const { MISSION_VOICE_CONNECT_ROLE_ID, MISSION_VOICE_HUB_NAME } = require('../config');
const {
  deleteMissionVoiceRoom,
  getMissionVoiceHub,
  getMissionVoiceRoom,
  listMissionVoiceRooms,
  upsertMissionVoiceHub,
  upsertMissionVoiceRoom,
} = require('./supabase');

const missionRoomPattern = /^┃🎙️ ・Mission (\d+)$/;
const creationQueues = new Map();

function missionRoomName(num) {
  return `┃🎙️ ・Mission ${num}`;
}

async function registerMissionVoiceHub(guildId, channelId, categoryId) {
  await upsertMissionVoiceHub({ guildId, channelId, categoryId });
}

async function registerMissionRoom(guildId, channelId, categoryId, ownerId, hubChannelId) {
  await upsertMissionVoiceRoom({ guildId, channelId, categoryId, ownerId, hubChannelId });
}

async function unregisterMissionRoom(guildId, channelId) {
  await deleteMissionVoiceRoom({ guildId, channelId });
}

async function isMissionVoiceHub(guildId, channelId) {
  return Boolean(await getMissionVoiceHub({ guildId, channelId }));
}

async function isOrRegisterMissionVoiceHub(channel) {
  if (!channel) return false;
  if (await isMissionVoiceHub(channel.guild.id, channel.id)) return true;
  if (
    channel.type !== ChannelType.GuildVoice ||
    channel.name !== MISSION_VOICE_HUB_NAME ||
    !channel.parentId
  ) {
    return false;
  }

  await registerMissionVoiceHub(channel.guild.id, channel.id, channel.parentId);
  console.log({ event: 'missionVoice.hubRegistered', hubChannelId: channel.id, guildId: channel.guild.id });
  return true;
}

async function isMissionRoom(guildId, channelId) {
  return Boolean(await getMissionVoiceRoom({ guildId, channelId }));
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
  return missionRoomName(num);
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

      await registerMissionRoom(newState.guild.id, room.id, categoryId, newState.member.id, hubChannel.id);

      if (newState.member.voice.channelId !== hubChannel.id) {
        if (room.members.size === 0) {
          await room.delete('Suppression car le membre a quitté le hub avant le déplacement').catch(() => {});
          await unregisterMissionRoom(newState.guild.id, room.id);
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
        await unregisterMissionRoom(newState.guild.id, room.id);
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
  if (!await isMissionRoom(guild.id, channelId)) return;

  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel) {
    await unregisterMissionRoom(guild.id, channelId);
    return;
  }

  if (channel.type !== ChannelType.GuildVoice || channel.members.size > 0) return;

  await channel.delete('Salon mission temporaire vide');
  await unregisterMissionRoom(guild.id, channelId);
  console.log({ event: 'missionVoice.roomDeleted', roomId: channelId });
}

async function cleanupEmptyMissionRooms(client) {
  let rooms;

  try {
    rooms = await listMissionVoiceRooms();
  } catch (err) {
    console.error({ event: 'missionVoice.cleanupError', error: err.message });
    return;
  }

  for (const room of rooms) {
    const guild = await client.guilds.fetch(room.guild_id).catch(() => null);
    if (!guild) continue;

    await deleteMissionRoomIfEmpty(guild, room.channel_id);
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
  const joinedHub = newState.channelId && await isOrRegisterMissionVoiceHub(newState.channel);
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
    await registerMissionVoiceHub(interaction.guild.id, existing.id, category.id);
    return { channel: existing, created: false };
  }

  const channel = await interaction.guild.channels.create({
    name: MISSION_VOICE_HUB_NAME,
    type: ChannelType.GuildVoice,
    parent: category.id,
    reason: `Création du hub vocal mission par ${interaction.user.tag}`,
  });

  await channel.lockPermissions();
  await registerMissionVoiceHub(interaction.guild.id, channel.id, category.id);
  return { channel, created: true };
}

module.exports = {
  cleanupEmptyMissionRooms,
  createMissionVoiceHub,
  handleMissionVoiceStateUpdate,
  registerMissionVoiceHub,
  MISSION_VOICE_HUB_NAME,
};
