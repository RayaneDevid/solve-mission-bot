'use strict';
require('dotenv').config();

const VILLAGE_CHANNELS = {
  konoha: process.env.MISSIONS_CHANNEL_KONOHA,
  oto:    process.env.MISSIONS_CHANNEL_OTO,
  suna:   process.env.MISSIONS_CHANNEL_SUNA,
  kiri:   process.env.MISSIONS_CHANNEL_KIRI,
};

function channelFor(village) {
  return VILLAGE_CHANNELS[village] || process.env.MISSIONS_CHANNEL_ID;
}

const VILLAGES = [
  { name: 'Konoha', value: 'konoha' },
  { name: 'Oto',    value: 'oto'    },
  { name: 'Suna',   value: 'suna'   },
  { name: 'Kiri',   value: 'kiri'   },
];

const RANGS = [
  { name: 'D', value: 'D' },
  { name: 'C', value: 'C' },
  { name: 'B', value: 'B' },
  { name: 'A', value: 'A' },
  { name: 'S', value: 'S' },
];

// Calibrer UNE FOIS en ouvrant un template dans Photopea/GIMP
const LAYOUT = {
  missionBox:   { x: 270, y: 700, width: 875, height: 720, padding: 20 },
  // Centre du rectangle numéro (à droite du "#" imprimé sur le template)
  numberCoords: { cx: 1055, cy: 208, fontSize: 65 },
};

const OVERRIDES = {
  // 'kiri_S': { missionBox: { ... } },
};

function layoutFor(village, rang) {
  return OVERRIDES[`${village}_${rang}`] ?? LAYOUT;
}

const VILLAGE_ROLES = {
  konoha: process.env.MISSIONS_ROLE_KONOHA || '1390396924343095297',
  oto:    process.env.MISSIONS_ROLE_OTO    || '1390396990625681488',
  suna:   process.env.MISSIONS_ROLE_SUNA   || '1390396888599101522',
  kiri:   process.env.MISSIONS_ROLE_KIRI   || '1418935420187836438',
};

const MISSION_VOICE_CONNECT_ROLE_ID = process.env.MISSION_VOICE_CONNECT_ROLE_ID || '1497615181625430092';
const MISSION_VOICE_HUB_NAME = process.env.MISSION_VOICE_HUB_NAME || 'Créer ton salon Mission';

module.exports = {
  channelFor,
  VILLAGES,
  RANGS,
  layoutFor,
  VILLAGE_ROLES,
  MISSION_VOICE_CONNECT_ROLE_ID,
  MISSION_VOICE_HUB_NAME,
};
