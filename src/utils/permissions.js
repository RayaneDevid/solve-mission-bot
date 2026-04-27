'use strict';
const { VILLAGE_ROLES } = require('../config');

function isAdmin(member) {
  const adminRole = process.env.MISSION_ADMIN_ROLE_ID;
  return Boolean(adminRole && member.roles.cache.has(adminRole));
}

function canCreateMission(member, village) {
  if (isAdmin(member)) return true;
  const roleId = VILLAGE_ROLES[village];
  return Boolean(roleId && member.roles.cache.has(roleId));
}

function canEditMission(member, mission) {
  if (isAdmin(member)) return true;
  if (member.user.id === mission.author_id) return true;
  return false;
}

module.exports = { canCreateMission, canEditMission };
