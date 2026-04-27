'use strict';
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const path = require('path');
const fs = require('fs');
const { layoutFor } = require('../config');

const FONTS_DIR = path.join(__dirname, '../../fonts');
const TEMPLATES_DIR = path.join(__dirname, '../../templates');

const FONT_FAMILY = "'GreatVibes-Regular'";
const MIN_FONT = 18;
const MAX_FONT = 72;
const LINE_HEIGHT_RATIO = 1.35;

(function registerFonts() {
  if (!fs.existsSync(FONTS_DIR)) return;
  for (const file of fs.readdirSync(FONTS_DIR)) {
    if (file.endsWith('.ttf') || file.endsWith('.otf')) {
      const name = path.basename(file, path.extname(file));
      GlobalFonts.registerFromPath(path.join(FONTS_DIR, file), name);
    }
  }
})();

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

function drawLinesCentered(ctx, lines, box, lineHeight) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.width, box.height);
  ctx.clip();

  ctx.fillStyle = '#111111';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';

  const totalHeight = lines.length * lineHeight;
  const centerX = box.x + box.width / 2;
  const availableHeight = box.height - box.padding * 2;
  const startY = totalHeight < availableHeight
    ? box.y + box.padding + (availableHeight - totalHeight) / 2
    : box.y + box.padding;

  let y = startY;
  for (const line of lines) {
    // Centrage horizontal manuel — indépendant de textAlign
    const lineWidth = ctx.measureText(line).width;
    ctx.fillText(line, centerX - lineWidth / 2, y);
    y += lineHeight;
  }

  ctx.restore();
}

function fitAndDrawText(ctx, text, box) {
  for (let size = MAX_FONT; size >= MIN_FONT; size--) {
    // Les guillemets sont indispensables pour que measureText utilise la bonne font
    ctx.font = `${size}px ${FONT_FAMILY}`;
    const lineHeight = Math.round(size * LINE_HEIGHT_RATIO);
    const lines = wrapText(ctx, text, box.width - box.padding * 2);
    const totalHeight = lines.length * lineHeight;

    if (totalHeight <= box.height - box.padding * 2 || size === MIN_FONT) {
      drawLinesCentered(ctx, lines, box, lineHeight);
      return size;
    }
  }
}

async function generateMission({ village, rang, description, num }) {
  const templatePath = path.join(TEMPLATES_DIR, `${village}_${rang}.png`);

  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template introuvable : ${village}_${rang}.png`);
  }

  const template = await loadImage(templatePath);
  const canvas = createCanvas(template.width, template.height);
  const ctx = canvas.getContext('2d');

  ctx.drawImage(template, 0, 0);

  const layout = layoutFor(village, rang);

  // Numéro — centré dans la zone à droite du "#" imprimé sur le template
  const { numberCoords } = layout;
  ctx.font = `${numberCoords.fontSize}px ${FONT_FAMILY}`;
  ctx.fillStyle = '#111111';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(String(num).padStart(5, '0'), numberCoords.cx, numberCoords.cy);

  fitAndDrawText(ctx, description, layout.missionBox);

  return canvas.toBuffer('image/png');
}

module.exports = { generateMission };
