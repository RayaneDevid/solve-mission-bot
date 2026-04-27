# Solve Mission Bot

Bot Discord pour la communauté NarutoRP **Solve Naruto** qui génère des fiches de mission illustrées à partir d'une commande slash, avec numérotation atomique **par village**, publication dans un salon dédié, et **édition après coup**.

---

## Vue d'ensemble

**Création** :
```
/mission village:<konoha|oto|suna|kiri> rang:<D|C|B|A|S>
  └─> Modale "Description de la mission"
       └─> Bot :
            1. Réserve atomiquement un numéro propre au village (RPC Supabase)
            2. Compose la fiche (template + numéro + description auto-fittée)
            3. Publie dans le salon dédié au village
            4. Confirme à l'auteur en éphémère
            5. Persiste channel_id + message_id pour pouvoir éditer plus tard
```

**Édition** :
```
/mission-edit village:<...> num:<42>
  └─> Vérifie permissions (auteur ou rôle admin)
       └─> Modale pré-remplie avec la description actuelle
            └─> Bot :
                 1. UPDATE missions SET description = ..., updated_at = now()
                 2. Régénère l'image avec le même numéro
                 3. Edit le message Discord original (via channel_id + message_id)
                 4. Confirme en éphémère
```

---

## Stack

- **discord.js v14** — slash commands, modals, interactions
- **@napi-rs/canvas** — composition d'image (préféré à `node-canvas` : pas de build natif)
- **Supabase** — numérotation atomique + log des missions
- **Node.js 20+**, CommonJS

---

## Structure

```
solve-mission-bot/
├── src/
│   ├── index.js                  # Bootstrap client + dispatch interactions
│   ├── deploy-commands.js        # Enregistrement des slash commands (à lancer 1x)
│   ├── config.js                 # Mapping village → channel, coords box, etc.
│   ├── commands/
│   │   ├── mission.js            # /mission + ouverture modale (création)
│   │   └── mission-edit.js       # /mission-edit + ouverture modale (édition)
│   └── utils/
│       ├── supabase.js           # Client Supabase + RPC reserve_mission_number
│       ├── permissions.js        # canEdit() — auteur ou rôle admin
│       └── generateMission.js    # Composition canvas + auto-fit + numéro
├── templates/                    # 20 PNG : {village}_{rang}.png
├── fonts/                        # Polices custom optionnelles (.ttf)
├── .env
└── package.json
```

---

## Variables d'environnement

```bash
# Discord
DISCORD_TOKEN=
CLIENT_ID=
GUILD_ID=

# Supabase
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# Salon de fallback (utilisé si pas de salon spécifique au village)
MISSIONS_CHANNEL_ID=

# Salons par village (optionnel — override le fallback)
MISSIONS_CHANNEL_KONOHA=
MISSIONS_CHANNEL_OTO=
MISSIONS_CHANNEL_SUNA=
MISSIONS_CHANNEL_KIRI=

# Rôle Discord autorisé à éditer n'importe quelle mission (en plus de l'auteur)
MISSION_ADMIN_ROLE_ID=
```

---

## Schéma Supabase

### Tables

```sql
-- Compteur par village (une ligne par village, lock atomique sur UPDATE)
create table mission_counters (
  village     text primary key check (village in ('konoha','oto','suna','kiri')),
  next_number int  not null default 1
);

insert into mission_counters (village) values
  ('konoha'), ('oto'), ('suna'), ('kiri');

-- Missions
create table missions (
  id              bigserial primary key,    -- PK technique (jamais affichée)
  village         text not null check (village in ('konoha','oto','suna','kiri')),
  rang            text not null check (rang in ('D','C','B','A','S')),
  village_number  int  not null,            -- = numéro affiché sur la fiche (#00042)
  description     text not null,
  author_id       text not null,            -- Discord user ID (auteur original)
  author_name     text not null,
  channel_id      text,                     -- rempli après publication
  message_id      text,                     -- rempli après publication (pour edit)
  created_at      timestamptz default now(),
  updated_at      timestamptz,              -- rempli quand /mission-edit est utilisé

  unique (village, village_number)          -- (konoha, 42) est unique → lookup rapide
);

create index missions_author_idx on missions (author_id);
```

### RPC atomique de création

`UPDATE ... RETURNING` prend un row-level lock, donc deux appels concurrents pour le même village seront sérialisés. Pas de race possible.

```sql
create or replace function create_mission(
  p_village     text,
  p_rang        text,
  p_description text,
  p_author_id   text,
  p_author_name text
)
returns table (id bigint, village_number int)
language plpgsql
as $$
declare
  v_number int;
  v_id     bigint;
begin
  -- 1. Réserve atomiquement le prochain numéro pour ce village
  update mission_counters
    set next_number = next_number + 1
    where village = p_village
    returning next_number - 1 into v_number;

  if v_number is null then
    raise exception 'Village inconnu : %', p_village;
  end if;

  -- 2. Insert la mission avec ce numéro
  insert into missions (village, rang, village_number, description, author_id, author_name)
    values (p_village, p_rang, v_number, p_description, p_author_id, p_author_name)
    returning missions.id into v_id;

  return query select v_id, v_number;
end;
$$;
```

### Pourquoi un compteur séparé plutôt que `MAX(village_number) + 1` ?

Sous concurrence, `MAX() + 1` peut donner deux fois le même numéro à deux INSERT simultanés (chacun lit la même valeur max avant que l'autre commit). La table de compteurs avec `UPDATE ... RETURNING` garantit l'unicité par lock de ligne, sans dépendre du niveau d'isolation de la transaction.

L'`unique (village, village_number)` sert de filet de sécurité au cas où.

### Si la publication Discord échoue après le `create_mission`

Le numéro est "consommé" et restera dans la table. Ce n'est **pas** grave : la numérotation n'a pas besoin d'être strictement contiguë. Alternative (rollback) = compliqué et expose à des races. On garde.

---

## Fonctionnalité 1 — Numérotation par village

Chaque village a sa propre séquence (`Konoha #00001`, `Konoha #00002`, ... indépendamment de `Oto #00001`, `Oto #00002`, ...).

```js
// supabase.js
async function createMission({ village, rang, description, authorId, authorName }) {
  const { data, error } = await supabase.rpc('create_mission', {
    p_village: village,
    p_rang: rang,
    p_description: description,
    p_author_id: authorId,
    p_author_name: authorName,
  });
  if (error) throw error;
  // RPC returns table → tableau d'une seule ligne
  const { id, village_number } = data[0];
  return { id, villageNumber: village_number };
}

// Format pour affichage : #00042 (le contexte du salon village suffit pour désambiguïser)
const formatMissionNumber = (n) => `#${String(n).padStart(5, '0')}`;
```

À la fin du flow, on update la ligne avec les IDs Discord :

```js
async function attachDiscordRefs(id, channelId, messageId) {
  await supabase
    .from('missions')
    .update({ channel_id: channelId, message_id: messageId })
    .eq('id', id);
}
```

**Note d'affichage** : on garde le format `#00042` simple. Pas besoin de préfixer par village (`KON#00042`) puisque chaque salon ne reçoit que les missions de son village. Si plus tard il faut un identifiant universel, on a toujours `id` (PK technique) en interne.

---

## Fonctionnalité 2 — Salon dédié

`config.js` expose une fonction de résolution avec fallback :

```js
const VILLAGE_CHANNELS = {
  konoha: process.env.MISSIONS_CHANNEL_KONOHA,
  oto:    process.env.MISSIONS_CHANNEL_OTO,
  suna:   process.env.MISSIONS_CHANNEL_SUNA,
  kiri:   process.env.MISSIONS_CHANNEL_KIRI,
};

function channelFor(village) {
  return VILLAGE_CHANNELS[village] || process.env.MISSIONS_CHANNEL_ID;
}
```

Dans le handler de submit modale :

```js
const channelId = channelFor(village);
const channel = await interaction.client.channels.fetch(channelId);
const sent = await channel.send({ files: [{ attachment: buffer, name: `mission-${num}.png` }] });

await interaction.editReply({
  content: `✅ Mission ${formatMissionNumber(num)} publiée dans <#${channelId}>`,
});
// editReply respecte le flag ephemeral du deferReply initial
```

**Important** : `deferReply({ flags: MessageFlags.Ephemeral })` dès le début pour que la confirmation finale soit privée à l'auteur.

---

## Fonctionnalité 3 — Auto-fit du texte

Le texte doit toujours rentrer dans la zone "Mission :" du template. On part de la taille max et on descend tant que ça déborde.

```js
const MIN_FONT = 14;
const MAX_FONT = 32;
const LINE_HEIGHT_RATIO = 1.3;

function fitAndDrawText(ctx, text, box, fontFamily = 'Arial') {
  for (let size = MAX_FONT; size >= MIN_FONT; size--) {
    ctx.font = `${size}px ${fontFamily}`;
    const lineHeight = Math.round(size * LINE_HEIGHT_RATIO);
    const lines = wrapText(ctx, text, box.width - box.padding * 2);
    const totalHeight = lines.length * lineHeight;

    const fits = totalHeight <= box.height - box.padding * 2;
    if (fits || size === MIN_FONT) {
      drawLines(ctx, lines, box, lineHeight);
      return size;
    }
  }
}

function wrapText(ctx, text, maxWidth) {
  const lines = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(' ');
    let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function drawLines(ctx, lines, box, lineHeight) {
  ctx.fillStyle = '#111111';
  ctx.textBaseline = 'top';
  const x = box.x + box.padding;
  let y = box.y + box.padding;
  for (const line of lines) {
    ctx.fillText(line, x, y);
    y += lineHeight;
  }
}
```

**Pièges courants** :
- `ctx.font` DOIT être réassigné à chaque itération avant `measureText` — sinon Canvas garde la précédente
- Respecter les `\n` saisis dans la modale (paragraphes manuels)
- Si le texte est vraiment trop long même à 14px, on dessine quand même : c'est plus utile qu'une erreur

---

## Fonctionnalité 4 — Édition d'une mission

`/mission-edit village:konoha num:42` permet de modifier la description d'une mission existante. L'image Discord est régénérée et le message original est `edit()`-é (pas un nouveau post).

### Permissions

```js
// utils/permissions.js
function canEditMission(member, mission) {
  // Auteur original
  if (member.user.id === mission.author_id) return true;
  // Rôle admin (configuré via env)
  const adminRole = process.env.MISSION_ADMIN_ROLE_ID;
  if (adminRole && member.roles.cache.has(adminRole)) return true;
  return false;
}
```

### Commande slash

```js
// commands/mission-edit.js
new SlashCommandBuilder()
  .setName('mission-edit')
  .setDescription('Éditer la description d\'une mission existante')
  .addStringOption(o => o.setName('village').setDescription('Village').setRequired(true).addChoices(...VILLAGES))
  .addIntegerOption(o => o.setName('num').setDescription('Numéro de la mission').setRequired(true).setMinValue(1));

async execute(interaction) {
  const village = interaction.options.getString('village');
  const num     = interaction.options.getInteger('num');

  // 1. Lookup via (village, village_number) — index unique → O(log n)
  const { data: mission, error } = await supabase
    .from('missions')
    .select('*')
    .eq('village', village)
    .eq('village_number', num)
    .maybeSingle();

  if (error || !mission) {
    return interaction.reply({
      content: `❌ Mission #${String(num).padStart(5, '0')} introuvable pour ${village}`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // 2. Permission check
  if (!canEditMission(interaction.member, mission)) {
    return interaction.reply({
      content: '❌ Tu n\'as pas la permission d\'éditer cette mission.',
      flags: MessageFlags.Ephemeral,
    });
  }

  // 3. Modale pré-remplie
  const modal = new ModalBuilder()
    .setCustomId(`mission-edit:${mission.id}`)            // PK technique, pas village_number
    .setTitle(`Éditer #${String(num).padStart(5, '0')} (${village})`);

  const descInput = new TextInputBuilder()
    .setCustomId('description')
    .setLabel('Description')
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(1500)
    .setRequired(true)
    .setValue(mission.description);                       // 👈 pré-remplissage

  modal.addComponents(new ActionRowBuilder().addComponents(descInput));
  await interaction.showModal(modal);
}
```

### Handler de submit

```js
// dans interactionCreate (index.js)
if (interaction.isModalSubmit() && interaction.customId.startsWith('mission-edit:')) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const [, missionId] = interaction.customId.split(':');
  const newDescription = interaction.fields.getTextInputValue('description');

  // 1. UPDATE + retour de la mission complète
  const { data: mission, error } = await supabase
    .from('missions')
    .update({ description: newDescription, updated_at: new Date().toISOString() })
    .eq('id', missionId)
    .select('*')
    .single();
  if (error) throw error;

  // 2. Régénération de l'image avec le MÊME village_number
  const buffer = await generateMission({
    village: mission.village,
    rang: mission.rang,
    description: mission.description,
    num: mission.village_number,
  });

  // 3. Edit du message Discord original
  if (mission.channel_id && mission.message_id) {
    const channel = await interaction.client.channels.fetch(mission.channel_id);
    const message = await channel.messages.fetch(mission.message_id);
    await message.edit({
      // Nom unique pour bypass le cache Discord/CDN
      files: [{
        attachment: buffer,
        name: `mission-${mission.village}-${mission.village_number}-${Date.now()}.png`,
      }],
    });
  }

  await interaction.editReply({
    content: `✅ Mission #${String(mission.village_number).padStart(5, '0')} mise à jour.`,
  });
}
```

### Pièges à éviter

- **Cache CDN Discord** : si on garde le même `name` d'attachment, certains clients affichent l'ancienne image. Solution : suffixer par `Date.now()` (cf. ci-dessus).
- **Message introuvable** : si quelqu'un a supprimé manuellement le message original, `messages.fetch()` throw. Catcher et re-publier dans ce cas (avec update de `message_id`).
- **Mission sans `channel_id`/`message_id`** : peut arriver si la publication initiale a échoué. Re-publier au lieu d'edit.
- **`village_number` ne change JAMAIS lors d'un edit** : c'est une mise à jour, pas une nouvelle mission. Le numéro reste celui d'origine.

### Pourquoi le `customId` de la modale d'édition utilise `id` (PK) et pas `(village, village_number)` ?

Plus court et plus simple à parser. Le `customId` est limité à 100 caractères dans Discord.

---



Tous les templates partagent (a priori) le même layout — seuls l'icône village et la lettre du rang changent. Donc une constante unique :

```js
// À calibrer UNE FOIS en ouvrant un template dans Photopea / GIMP
const LAYOUT = {
  missionBox:    { x: 130, y: 720, width: 1150, height: 800, padding: 40 },
  numberCoords:  { x: 1100, y: 180, fontSize: 56, font: 'italic 56px serif' },
};
```

Si un template diffère, override via mapping :

```js
const OVERRIDES = {
  // 'kiri_S': { missionBox: { ... } },
};
const layoutFor = (village, rang) => OVERRIDES[`${village}_${rang}`] ?? LAYOUT;
```

### Numéro affiché sur la fiche

Les templates fournis ont `#00005` écrit en dur. Deux options :

| Option | Description | Recommandation |
|--------|-------------|----------------|
| **A** | Nettoyer les 20 templates (retirer le numéro statique), on l'écrit dynamiquement | ✅ Plus propre |
| **B** | Recouvrir avec un rectangle de la couleur de fond + réécrire | Si pas envie de toucher aux PSD |

Si option A : on dessine `formatMissionNumber(num)` aux `numberCoords` avec la même police/style que sur le template original.

---

## Flow complet — Création (annoté)

```js
// src/index.js — handler
client.on('interactionCreate', async (interaction) => {
  if (interaction.isModalSubmit() && interaction.customId.startsWith('mission:')) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }); // 1. ack rapide

    const [, village, rang] = interaction.customId.split(':');
    const description = interaction.fields.getTextInputValue('description');

    // 2. Création atomique : RPC qui réserve le numéro ET insert
    const { id, villageNumber } = await createMission({
      village, rang, description,
      authorId: interaction.user.id,
      authorName: interaction.user.username,
    });

    // 3. Génération de l'image avec le numéro propre au village
    const buffer = await generateMission({ village, rang, description, num: villageNumber });

    // 4. Publication dans le salon dédié
    const channelId = channelFor(village);
    const channel = await interaction.client.channels.fetch(channelId);
    const sent = await channel.send({
      files: [{ attachment: buffer, name: `mission-${village}-${villageNumber}.png` }],
    });

    // 5. Persistance des refs Discord (indispensable pour /mission-edit plus tard)
    await attachDiscordRefs(id, channelId, sent.id);

    // 6. Ack à l'auteur
    await interaction.editReply({
      content: `✅ Mission ${formatMissionNumber(villageNumber)} publiée dans <#${channelId}>`,
    });
  }
});
```

---

## Conventions

- **`deferReply` systématique** avant toute opération > 500ms (Supabase + canvas = ~1s facile)
- **`customId` = état** :
  - Création : `mission:<village>:<rang>` (encode le contexte du choix slash)
  - Édition : `mission-edit:<missionId>` (PK technique, suffit pour retrouver tout)
- **Logs structurés** : `console.log({ event: 'mission.created', id, villageNumber, village, rang, authorId })`
- **Erreurs** : catch global dans `interactionCreate`, fallback en `editReply` ou `reply` éphémère selon l'état
- **Pas de DB query côté frontend** : le bot écrit directement via `SERVICE_ROLE_KEY` (côté serveur uniquement, jamais exposé)
- **Templates immutables** : `templates/` est read-only à l'exécution, jamais modifié par le bot
- **`village_number` est immuable après création** : un edit ne change que la description, jamais le numéro
- **Cache-busting d'attachment Discord** : suffixer le nom de fichier par `Date.now()` à chaque edit pour éviter que le client/CDN serve l'ancienne image

---

## Setup

```bash
pnpm install
cp .env.example .env
# Remplir DISCORD_TOKEN, CLIENT_ID, GUILD_ID, SUPABASE_*, MISSIONS_CHANNEL_*

# Appliquer le schéma SQL (via dashboard Supabase ou CLI)
# (cf. section "Schéma Supabase" ci-dessus)

pnpm run deploy   # Enregistre les slash commands sur la guild (1x suffit)
pnpm start        # Lance le bot
```

---

## TODO / Idées futures

- [ ] Statut de mission (ouverte / en cours / terminée) avec re-render de l'image
- [ ] Stats : `/mission-stats village:konoha` → top distributeurs, volume par rang, etc.
- [ ] Champ optionnel "Distributeur" dans la modale pour remplacer "Par Kyuna Ganedo" dynamiquement
- [ ] Auto-fit avec **deux passes** (taille + interligne) pour une densité encore meilleure sur les longues missions
- [ ] Historique des éditions (`mission_history` table) : qui a édité quoi, quand, ancienne valeur
- [ ] `/mission-info village:konoha num:42` : voir les métadonnées (auteur, créée le, éditée le, ...) sans scroller dans le salon