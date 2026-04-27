'use strict';
const {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');
const { createMissionVoiceHub, MISSION_VOICE_HUB_NAME } = require('../utils/missionVoiceRooms');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mission-vocal')
    .setDescription(`Créer le salon vocal "${MISSION_VOICE_HUB_NAME}" dans une catégorie`)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addChannelOption(o =>
      o.setName('categorie')
        .setDescription('Catégorie où créer le salon vocal')
        .addChannelTypes(ChannelType.GuildCategory)
        .setRequired(true)
    ),

  async execute(interaction) {
    const category = interaction.options.getChannel('categorie');

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
      return interaction.reply({
        content: '❌ Tu dois avoir la permission **Gérer les salons** pour créer ce salon.',
        flags: MessageFlags.Ephemeral,
      });
    }

    if (!category || category.type !== ChannelType.GuildCategory) {
      return interaction.reply({
        content: '❌ Choisis une catégorie valide.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const botPermissions = category.permissionsFor(interaction.guild.members.me);
    if (!botPermissions?.has([
      PermissionFlagsBits.ManageChannels,
      PermissionFlagsBits.MoveMembers,
    ])) {
      return interaction.reply({
        content: '❌ Le bot doit avoir les permissions **Gérer les salons** et **Déplacer des membres** dans cette catégorie.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const { channel, created } = await createMissionVoiceHub(interaction, category);

    return interaction.reply({
      content: created
        ? `✅ Salon vocal <#${channel.id}> créé dans **${category.name}**.`
        : `✅ Le salon vocal <#${channel.id}> existe déjà dans **${category.name}** et il est bien enregistré.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
