const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, 'generated');
const sourceRoot = 'https://raw.githubusercontent.com/repoe-fork/poe2/master/data';
const headers = {'user-agent': 'POE2 Route Companion'};

async function getJson(name) {
  const response = await fetch(`${sourceRoot}/${name}`, {headers});
  if (!response.ok) throw new Error(`${response.status} ${name}`);
  return response.json();
}

function iconRecord(value, ddsFile, kind) {
  if (!value?.name || !ddsFile || !/\.dds$/i.test(ddsFile)) return null;
  return [value.name, {
    dds: ddsFile,
    kind,
    width: Number(value.inventory_width) || 1,
    height: Number(value.inventory_height) || 1
  }];
}

function sortedObject(entries) {
  return Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)));
}

async function main() {
  fs.mkdirSync(outputDir, {recursive: true});
  const [baseItems, uniques, skillGems] = await Promise.all([
    getJson('base_items.json'),
    getJson('uniques.json'),
    getJson('skill_gems.json')
  ]);
  const bases = new Map();
  for (const value of Object.values(baseItems)) {
    const record = iconRecord(value, value.visual_identity?.dds_file, 'base');
    if (record && value.release_state === 'released' && !bases.has(record[0])) bases.set(...record);
  }
  const uniqueItems = new Map();
  for (const value of Object.values(uniques)) {
    const record = iconRecord(value, value.visual_identity?.dds_file, 'unique');
    if (record && !value.is_alternate_art && !uniqueItems.has(record[0])) uniqueItems.set(...record);
  }
  const gems = new Map();
  for (const value of Object.values(skillGems)) {
    const name = value.base_item?.display_name;
    const dds = value.icon_dds_file;
    if (!name || !dds || !/\.dds$/i.test(dds) || value.base_item?.release_state !== 'released') continue;
    if (!gems.has(name)) gems.set(name, {dds, kind: 'gem', width: 1, height: 1});
  }
  const output = {
    version: 'RePoE POE2',
    generatedAt: new Date().toISOString(),
    sources: ['repoe-fork/poe2', 'image.ggpk.exposed/poe2'],
    icons: {
      base: sortedObject([...bases]),
      unique: sortedObject([...uniqueItems]),
      gem: sortedObject([...gems])
    }
  };
  fs.writeFileSync(path.join(outputDir, 'poe2-icons.json'), JSON.stringify(output));
  const sample = uniqueItems.get('Mageblood') || [...uniqueItems.values()][0];
  const samplePath = sample.dds.split('/').map(encodeURIComponent).join('/');
  const imageResponse = await fetch(`https://image.ggpk.exposed/poe2/${samplePath}`, {headers});
  const imageBytes = Buffer.from(await imageResponse.arrayBuffer());
  if (!imageResponse.ok || imageBytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error(`Icon image source validation failed (${imageResponse.status})`);
  }
  console.log(`Generated icon manifest: ${bases.size} bases, ${uniqueItems.size} uniques, ${gems.size} gems; image source OK`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
