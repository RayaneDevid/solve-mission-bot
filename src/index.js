'use strict';
require('dotenv').config();
const { Client, GatewayIntentBits, MessageFlags } = require('discord.js');
const fs = require('fs');
const path = require('path');

const { channelFor } = require('./config');
const { createMission, updateMissionDescription, attachDiscordRefs, formatMissionNumber } = require('./utils/supabase');
const { generateMission } = require('./utils/generateMission');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// Load commands
const commands = new Map();
const commandsDir = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsDir).filter(f => f.endsWith('.js'))) {
  const cmd = require(path.join(commandsDir, file));
  commands.set(cmd.data.name, cmd);
}

client.once('clientReady', () => {
  console.log({ event: 'bot.ready', tag: client.user.tag });
});

client.on('interactionCreate', async (interaction) => {
  try {
    // Slash commands
    if (interaction.isChatInputCommand()) {
      const cmd = commands.get(interaction.commandName);
      if (!cmd) return;
      await cmd.execute(interaction);
      return;
    }

    // Modal — création
    if (interaction.isModalSubmit() && interaction.customId.startsWith('mission:')) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const [, village, rang] = interaction.customId.split(':');
      const description = interaction.fields.getTextInputValue('description');

      const { id, villageNumber } = await createMission({
        village,
        rang,
        description,
        authorId:   interaction.user.id,
        authorName: interaction.user.username,
      });

      console.log({ event: 'mission.created', id, villageNumber, village, rang, authorId: interaction.user.id });

      const buffer = await generateMission({ village, rang, description, num: villageNumber });

      const channelId = channelFor(village);
      const channel = await interaction.client.channels.fetch(channelId);
      const sent = await channel.send({
        files: [{ attachment: buffer, name: `mission-${village}-${villageNumber}.png` }],
      });

      await attachDiscordRefs(id, channelId, sent.id);

      await interaction.editReply({
        content: `✅ Mission ${formatMissionNumber(villageNumber)} publiée dans <#${channelId}>`,
      });
      return;
    }

    // Modal — édition
    if (interaction.isModalSubmit() && interaction.customId.startsWith('mission-edit:')) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const [, missionId] = interaction.customId.split(':');
      const newDescription = interaction.fields.getTextInputValue('description');

      const mission = await updateMissionDescription(missionId, newDescription);

      console.log({ event: 'mission.edited', id: mission.id, villageNumber: mission.village_number, village: mission.village, authorId: interaction.user.id });

      const buffer = await generateMission({
        village:     mission.village,
        rang:        mission.rang,
        description: mission.description,
        num:         mission.village_number,
      });

      if (mission.channel_id && mission.message_id) {
        try {
          const channel = await interaction.client.channels.fetch(mission.channel_id);
          const message = await channel.messages.fetch(mission.message_id);
          await message.edit({
            files: [{
              attachment: buffer,
              name: `mission-${mission.village}-${mission.village_number}-${Date.now()}.png`,
            }],
          });
        } catch (fetchErr) {
          // Message supprimé manuellement — republier
          console.log({ event: 'mission.repost', id: mission.id, reason: fetchErr.message });
          const channelId = mission.channel_id || channelFor(mission.village);
          const channel = await interaction.client.channels.fetch(channelId);
          const sent = await channel.send({
            files: [{
              attachment: buffer,
              name: `mission-${mission.village}-${mission.village_number}-${Date.now()}.png`,
            }],
          });
          await attachDiscordRefs(mission.id, channelId, sent.id);
        }
      } else {
        // Pas de refs Discord (publication initiale avait échoué) — publier maintenant
        const channelId = channelFor(mission.village);
        const channel = await interaction.client.channels.fetch(channelId);
        const sent = await channel.send({
          files: [{
            attachment: buffer,
            name: `mission-${mission.village}-${mission.village_number}-${Date.now()}.png`,
          }],
        });
        await attachDiscordRefs(mission.id, channelId, sent.id);
      }

      await interaction.editReply({
        content: `✅ Mission ${formatMissionNumber(mission.village_number)} mise à jour.`,
      });
    }
  } catch (err) {
    console.error({ event: 'interaction.error', error: err.message, stack: err.stack });
    const payload = { content: '❌ Une erreur est survenue. Réessaie dans un instant.', flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
