'use strict';
const {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  MessageFlags,
} = require('discord.js');
const { VILLAGES } = require('../config');
const { getMission } = require('../utils/supabase');
const { canEditMission } = require('../utils/permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mission-edit')
    .setDescription('Éditer la description d\'une mission existante')
    .addStringOption(o =>
      o.setName('village')
        .setDescription('Village de la mission')
        .setRequired(true)
        .addChoices(...VILLAGES)
    )
    .addIntegerOption(o =>
      o.setName('num')
        .setDescription('Numéro de la mission')
        .setRequired(true)
        .setMinValue(1)
    ),

  async execute(interaction) {
    const village = interaction.options.getString('village');
    const num     = interaction.options.getInteger('num');

    const mission = await getMission({ village, villageNumber: num });

    if (!mission) {
      return interaction.reply({
        content: `❌ Mission #${String(num).padStart(5, '0')} introuvable pour ${village}.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (!canEditMission(interaction.member, mission)) {
      return interaction.reply({
        content: '❌ Tu n\'as pas la permission d\'éditer cette mission.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const modal = new ModalBuilder()
      .setCustomId(`mission-edit:${mission.id}`)
      .setTitle(`Éditer #${String(num).padStart(5, '0')} (${village})`);

    const descInput = new TextInputBuilder()
      .setCustomId('description')
      .setLabel('Description')
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(1500)
      .setRequired(true)
      .setValue(mission.description);

    modal.addComponents(new ActionRowBuilder().addComponents(descInput));
    await interaction.showModal(modal);
  },
};
