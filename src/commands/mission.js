'use strict';
const {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  MessageFlags,
} = require('discord.js');
const { VILLAGES, RANGS } = require('../config');
const { canCreateMission } = require('../utils/permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mission')
    .setDescription('Créer une nouvelle fiche de mission')
    .addStringOption(o =>
      o.setName('village')
        .setDescription('Village de la mission')
        .setRequired(true)
        .addChoices(...VILLAGES)
    )
    .addStringOption(o =>
      o.setName('rang')
        .setDescription('Rang de la mission')
        .setRequired(true)
        .addChoices(...RANGS)
    ),

  async execute(interaction) {
    const village = interaction.options.getString('village');
    const rang    = interaction.options.getString('rang');

    if (!canCreateMission(interaction.member, village)) {
      return interaction.reply({
        content: `❌ Tu n'as pas le rôle requis pour créer une mission pour **${village}**.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    const modal = new ModalBuilder()
      .setCustomId(`mission:${village}:${rang}`)
      .setTitle(`Nouvelle mission — ${village.charAt(0).toUpperCase() + village.slice(1)} Rang ${rang}`);

    const descInput = new TextInputBuilder()
      .setCustomId('description')
      .setLabel('Description de la mission')
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(1500)
      .setRequired(true)
      .setPlaceholder('Décris la mission en détail...');

    modal.addComponents(new ActionRowBuilder().addComponents(descInput));
    await interaction.showModal(modal);
  },
};
