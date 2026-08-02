'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const generated = path.join(root, 'generated');
const manual = path.join(root, 'manual');
const latest = path.join(root, 'latest');
const repository = 'Phingo4455/POE2helper-updates';
const rawRoot = `https://raw.githubusercontent.com/${repository}/main/latest`;

const definitions = [
  ['translations', 'poe2-translations.json', generated],
  ['supplement', 'poe2-dictionary-supplement.json', manual],
  ['tradeStats', 'poe2-trade-stats.json', generated],
  ['affixes', 'poe2-affix-data.json', generated],
  ['icons', 'poe2-icons.json', generated],
  ['zones', 'poe2-zones.json', manual]
];

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stablePayload(file, object) {
  if (file === 'poe2-affix-data.json' || file === 'poe2-icons.json') {
    const copy = {...object};
    delete copy.generatedAt;
    return copy;
  }
  return object;
}

function main() {
  fs.mkdirSync(latest, {recursive: true});
  const inputs = definitions.map(([id, file, directory]) => {
    const object = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
    return {id, file, object};
  });
  const contentId = sha256(inputs.map(input => JSON.stringify(stablePayload(input.file, input.object))).join('\n'));
  const previousManifestPath = path.join(latest, 'manifest.json');
  if (fs.existsSync(previousManifestPath)) {
    const previous = JSON.parse(fs.readFileSync(previousManifestPath, 'utf8'));
    if (previous.contentId === contentId) {
      console.log(`No data changes (${contentId.slice(0, 12)}).`);
      return;
    }
  }

  const generatedAt = new Date().toISOString();
  const date = generatedAt.slice(0, 10).replace(/-/g, '.');
  const version = `1.${date}.${contentId.slice(0, 8)}`;
  const files = [];
  for (const input of inputs) {
    const output = stablePayload(input.file, input.object);
    if (input.file === 'poe2-affix-data.json' || input.file === 'poe2-icons.json') output.generatedAt = generatedAt;
    const bytes = Buffer.from(JSON.stringify(output));
    fs.writeFileSync(path.join(latest, input.file), bytes);
    files.push({
      id: input.id,
      name: input.file,
      url: `${rawRoot}/${input.file}`,
      sha256: sha256(bytes),
      size: bytes.length
    });
  }

  const manifest = {
    schemaVersion: 1,
    realm: 'poe2',
    channel: 'stable',
    version,
    contentId,
    generatedAt,
    minAppVersion: '0.1.0',
    sources: [
      'Grinding Gear Games trade2',
      'PathOfBuildingCommunity/PathOfBuilding-PoE2',
      'Chuanhsing/PoeCharm2',
      'repoe-fork/poe2',
      'poe2db.tw',
      'poe2scout.com',
      'POE2helper manual aliases and zones'
    ],
    files
  };
  fs.writeFileSync(previousManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Built update ${version} (${files.length} files).`);
}

main();
