const fs = require('node:fs');
const path = require('node:path');
const OpenCC = require('opencc-js');

const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, 'generated');
const baseHeaders = {'user-agent': 'POE2-Route-Companion/0.1 (offline affix sync)'};
const toSimplified = OpenCC.Converter({from: 'tw', to: 'cn'});

function headersFor(url) {
  const headers = {...baseHeaders};
  if (process.env.GITHUB_TOKEN && new URL(url).hostname === 'api.github.com') {
    headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

async function getJson(url) {
  const response = await fetch(url, {headers: headersFor(url)});
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

async function getText(url) {
  const response = await fetch(url, {headers: headersFor(url)});
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.text();
}

function flattenTradeGroups(data) {
  return data.result.flatMap(group => group.entries.map(entry => ({...entry, group: group.label || group.id || ''})));
}

function buildTradeStats(enData, twData) {
  const twById = new Map(flattenTradeGroups(twData).map(entry => [entry.id, entry]));
  return flattenTradeGroups(enData).map(entry => {
    const tw = twById.get(entry.id)?.text || '';
    return {
      id: entry.id,
      type: entry.type || entry.id.split('.')[0],
      group: entry.group,
      en: entry.text,
      tw,
      zh: tw ? toSimplified(tw) : ''
    };
  });
}

function quotedValues(text) {
  return [...String(text).matchAll(/"((?:\\.|[^"\\])*)"/g)].map(match => match[1].replace(/\\"/g, '"'));
}

function parseLuaList(line, key) {
  const body = line.match(new RegExp(`${key}\\s*=\\s*\\{([^}]*)\\}`))?.[1] || '';
  return quotedValues(body);
}

function parseLuaNumbers(line, key) {
  const body = line.match(new RegExp(`${key}\\s*=\\s*\\{([^}]*)\\}`))?.[1] || '';
  return [...body.matchAll(/-?\d+(?:\.\d+)?/g)].map(match => Number(match[0]));
}

function parsePobMods(lua, tradeById) {
  const mods = [];
  for (const line of lua.split(/\r?\n/)) {
    const header = line.match(/^\s*\["([^"]+)"\]\s*=\s*\{\s*type\s*=\s*"(Prefix|Suffix)",\s*affix\s*=\s*"([^"]*)",/);
    if (!header) continue;
    const [, id, type, affix] = header;
    const textBody = line.match(/affix\s*=\s*"[^"]*",\s*([\s\S]*?)\s*statOrder\s*=/)?.[1] || '';
    const rawLines = quotedValues(textBody);
    const tradeIds = [...line.matchAll(/\[(\d+)\]\s*=\s*\{/g)].map(match => `explicit.stat_${match[1]}`);
    const official = tradeIds.map(tradeId => tradeById.get(tradeId)).filter(Boolean);
    const weightKeys = parseLuaList(line, 'weightKey');
    const weightValues = parseLuaNumbers(line, 'weightVal');
    mods.push({
      id,
      type,
      affix,
      group: line.match(/group\s*=\s*"([^"]+)"/)?.[1] || id.replace(/\d+_?$/, ''),
      level: Number(line.match(/level\s*=\s*(\d+)/)?.[1] || 1),
      raw: rawLines.join('\n'),
      tradeIds,
      en: official.map(item => item.en).join('\n') || rawLines.join('\n'),
      tw: official.map(item => item.tw).filter(Boolean).join('\n'),
      zh: official.map(item => item.zh).filter(Boolean).join('\n'),
      weightKeys,
      weightValues,
      modTags: parseLuaList(line, 'modTags')
    });
  }
  return mods;
}

function groupPobMods(mods) {
  const groups = new Map();
  for (const mod of mods) {
    const key = `${mod.type}|${mod.group}|${mod.tradeIds.join(',') || mod.en}`;
    const group = groups.get(key) || {
      id: `pob:${key}`,
      type: mod.type,
      family: mod.group,
      en: mod.en,
      tw: mod.tw,
      zh: mod.zh,
      tags: mod.modTags,
      tiers: []
    };
    group.tiers.push({
      id: mod.id,
      level: mod.level,
      affix: mod.affix,
      raw: mod.raw,
      weightKeys: mod.weightKeys,
      weightValues: mod.weightValues
    });
    groups.set(key, group);
  }
  for (const group of groups.values()) group.tiers.sort((a, b) => a.level - b.level);
  return [...groups.values()];
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&ndash;|&#8211;/g, '—')
    .replace(/&#(\d+);/g, (_match, value) => String.fromCodePoint(Number(value)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

function parseTabletRows(html) {
  const table = [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)]
    .map(match => match[1])
    .find(value => /Pre\/Suf/i.test(value) && /Description/i.test(value)) || '';
  const body = table.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i)?.[1] || '';
  return [...body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(row => {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(cell => decodeHtml(cell[1]));
    return {level: Number(cells[0] || 1), type: /Prefix|前綴/.test(cells[1]) ? 'Prefix' : 'Suffix', text: cells[2] || ''};
  }).filter(row => row.text);
}

const TABLET_MECHANISMS = {
  breach: /breach|wombgift|hiveblood|xesht/i,
  delirium: /delirium|simulacrum|fracturing mirror/i,
  ritual: /ritual|tribute|favour|omen/i,
  expedition: /expedition|logbook|runic|remnant|artifact/i,
  abyss: /abyss|desecrated|closed pit/i,
  incursion: /vaal beacon|incursion/i,
  overseer: /map boss/i
};

function tabletMechanisms(text) {
  return Object.entries(TABLET_MECHANISMS).filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}

function buildTabletGroups(enHtml, twHtml) {
  const enRows = parseTabletRows(enHtml);
  const twRows = parseTabletRows(twHtml);
  if (enRows.length < 20 || enRows.length !== twRows.length) {
    throw new Error(`碑牌词缀表未完整对齐：EN ${enRows.length}, TW ${twRows.length}`);
  }
  return enRows.map((row, index) => ({
    id: `tablet:${index}`,
    type: row.type,
    family: `Tablet${index}`,
    en: row.text,
    tw: twRows[index].text,
    zh: toSimplified(twRows[index].text),
    tabletMechanisms: tabletMechanisms(row.text),
    tiers: [{id: `Tablet${index}`, level: row.level, affix: '', raw: row.text, weightKeys: [], weightValues: []}]
  }));
}

function parseNumericTable(block, key) {
  const body = block.match(new RegExp(`\\b${key}\\s*=\\s*\\{([^}]*)\\}`))?.[1] || '';
  return Object.fromEntries([...body.matchAll(/([A-Za-z][A-Za-z0-9_]*)\s*=\s*(-?\d+(?:\.\d+)?)/g)]
    .map(match => [match[1], Number(match[2])]));
}

function canonicalStat(value) {
  return String(value || '').replace(/\((-?\d+(?:\.\d+)?)\s*[-–—]\s*(-?\d+(?:\.\d+)?)\)/g, '#')
    .replace(/[+-]?\d+(?:\.\d+)?/g, '#').replace(/\+#/g, '#').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

function localizeImplicit(value, tradeStats) {
  if (!value) return null;
  const official = new Map(tradeStats.filter(stat => stat.tw || stat.zh).map(stat => [canonicalStat(stat.en), stat]));
  const values = [...value.matchAll(/\((-?\d+(?:\.\d+)?)\s*[-–—]\s*(-?\d+(?:\.\d+)?)\)|([+-]?\d+(?:\.\d+)?)/g)]
    .map(match => match[1] !== undefined ? `(${match[1]}–${match[2]})` : match[3]);
  const fill = template => {
    let index = 0;
    return String(template || '').replace(/#/g, () => values[index++] ?? '#');
  };
  const match = official.get(canonicalStat(value));
  return {en: value, tw: match ? fill(match.tw) : '', zh: match ? fill(match.zh) : ''};
}

function parseBaseItems(file, text, translations, tradeStats) {
  const items = [];
  const starts = [...text.matchAll(/itemBases\["([^"]+)"\]\s*=\s*\{/g)];
  for (let index = 0; index < starts.length; index += 1) {
    const name = starts[index][1];
    const block = text.slice(starts[index].index, starts[index + 1]?.index || text.length);
    const type = block.match(/\btype\s*=\s*"([^"]+)"/)?.[1] || path.basename(file, '.lua');
    const tagsBody = block.match(/\btags\s*=\s*\{([^}]*)\}/)?.[1] || '';
    const tags = [...tagsBody.matchAll(/([a-zA-Z0-9_]+)\s*=\s*true/g)].map(match => match[1]);
    const translation = translations.get(name) || {};
    const implicitRaw = block.match(/\bimplicit\s*=\s*"((?:\\.|[^"\\])*)"/)?.[1]?.replace(/\\n/g, '\n').replace(/\\"/g, '"') || '';
    const requirements = parseNumericTable(block, 'req');
    const weapon = parseNumericTable(block, 'weapon');
    const armour = parseNumericTable(block, 'armour');
    const blockChance = Number(block.match(/^\s*block\s*=\s*(\d+(?:\.\d+)?)/m)?.[1] || 0);
    items.push({
      id: `base:${name}`,
      kind: 'base',
      en: name,
      zh: translation.zh || '',
      tw: translation.tw || '',
      type,
      tags,
      requirements,
      weapon: Object.keys(weapon).length ? weapon : undefined,
      armour: Object.keys(armour).length ? armour : undefined,
      blockChance: blockChance || undefined,
      implicit: localizeImplicit(implicitRaw, tradeStats)
    });
  }
  return items;
}

const CATEGORY_ITEMS = [
  ['bow', '弓', '弓', 'Bow', ['弓箭'], ['bow','ranged','two_hand_weapon','twohand','weapon','default']],
  ['crossbow', '弩', '十字弓', 'Crossbow', ['弩箭'], ['crossbow','ranged','two_hand_weapon','twohand','weapon','default']],
  ['quiver', '箭袋', '箭袋', 'Quiver', [], ['quiver','default']],
  ['wand', '法杖', '法杖', 'Wand', [], ['wand','one_hand_weapon','weapon','default']],
  ['staff', '长杖', '長杖', 'Staff', [], ['staff','two_hand_weapon','twohand','weapon','default']],
  ['sceptre', '权杖', '權杖', 'Sceptre', [], ['sceptre','one_hand_weapon','weapon','default']],
  ['mace', '锤', '錘', 'Mace', ['钉锤'], ['mace','one_hand_weapon','weapon','default']],
  ['axe', '斧', '斧', 'Axe', [], ['axe','weapon','default']],
  ['sword', '剑', '劍', 'Sword', [], ['sword','weapon','default']],
  ['spear', '长矛', '長矛', 'Spear', [], ['spear','weapon','default']],
  ['flail', '连枷', '連枷', 'Flail', [], ['flail','weapon','default']],
  ['claw', '爪', '爪', 'Claw', [], ['claw','weapon','default']],
  ['dagger', '匕首', '匕首', 'Dagger', [], ['dagger','weapon','default']],
  ['ring', '戒指', '戒指', 'Ring', [], ['ring','default']],
  ['amulet', '项链', '項鍊', 'Amulet', ['项链'], ['amulet','default']],
  ['belt', '腰带', '腰帶', 'Belt', [], ['belt','default']],
  ['helmet', '头盔', '頭盔', 'Helmet', [], ['helmet','armour','default']],
  ['gloves', '手套', '手套', 'Gloves', [], ['gloves','armour','default']],
  ['boots', '鞋子', '鞋子', 'Boots', ['靴子'], ['boots','armour','default']],
  ['body', '胸甲', '胸甲', 'Body Armour', [], ['body_armour','armour','default']],
  ['shield', '盾牌', '盾牌', 'Shield', [], ['shield','armour','default']],
  ['focus', '法器', '法器', 'Focus', [], ['focus','default']]
].map(([id, zh, tw, en, aliases, tags]) => ({id: `category:${id}`, kind: 'category', zh, tw, en, aliases, type: en, tags}));

const TABLET_ITEMS = [
  ['breach','裂隙石板','裂痕碑牌','Breach Tablet',['裂隙石碑','裂隙石牌','裂痕石碑','裂痕石牌']],
  ['delirium','迷雾石板','譫妄碑牌','Delirium Tablet',['迷雾石碑','譫妄石碑']],
  ['ritual','仪式石板','祭祀碑牌','Ritual Tablet',['仪式石碑','祭祀石碑']],
  ['expedition','先祖秘藏石板','探險碑牌','Expedition Tablet',['探险石板','探险石碑']],
  ['abyss','深渊石板','深淵碑牌','Abyss Tablet',['深渊石碑','深淵石碑']],
  ['incursion','神庙石板','神廟碑牌','Incursion Tablet',['神庙石碑','瓦尔碑牌']],
  ['overseer','总督石板','總督碑牌','Overseer Tablet',['总督石碑']]
].map(([mechanism, zh, tw, en, aliases]) => ({
  id: `tablet:${mechanism}`,
  kind: 'tablet',
  mechanism,
  zh, tw, en, aliases,
  type: 'Tablet',
  tags: ['tablet','tower_augment','default']
}));

async function main() {
  fs.mkdirSync(outputDir, {recursive: true});
  const [enTrade, twTrade, modItemLua, pobTree, tabletEn, tabletTw] = await Promise.all([
    getJson('https://www.pathofexile.com/api/trade2/data/stats'),
    getJson('https://pathofexile.tw/api/trade2/data/stats'),
    getText('https://raw.githubusercontent.com/PathOfBuildingCommunity/PathOfBuilding-PoE2/dev/src/Data/ModItem.lua'),
    getJson('https://api.github.com/repos/PathOfBuildingCommunity/PathOfBuilding-PoE2/git/trees/dev?recursive=1'),
    getText('https://poe2db.tw/us/Tablet'),
    getText('https://poe2db.tw/tw/Tablet')
  ]);

  const tradeStats = buildTradeStats(enTrade, twTrade);
  const tradeById = new Map(tradeStats.map(entry => [entry.id, entry]));
  const pobGroups = groupPobMods(parsePobMods(modItemLua, tradeById));
  const tabletGroups = buildTabletGroups(tabletEn, tabletTw);
  const translationTerms = JSON.parse(fs.readFileSync(path.join(outputDir, 'poe2-translations.json'), 'utf8'));
  const translations = new Map(translationTerms.map(term => [term.en, term]));
  const basePaths = pobTree.tree.filter(item => item.type === 'blob' && /^src\/Data\/Bases\/[^/]+\.lua$/.test(item.path)).map(item => item.path);
  const baseFiles = await Promise.all(basePaths.map(async file => ({file, text: await getText(`https://raw.githubusercontent.com/PathOfBuildingCommunity/PathOfBuilding-PoE2/dev/${file}`)})));
  const baseItems = baseFiles.flatMap(({file, text}) => parseBaseItems(file, text, translations, tradeStats));

  fs.writeFileSync(path.join(outputDir, 'poe2-trade-stats.json'), JSON.stringify(tradeStats));
  fs.writeFileSync(path.join(outputDir, 'poe2-affix-data.json'), JSON.stringify({
    version: 'POE2 current',
    generatedAt: new Date().toISOString(),
    items: [...CATEGORY_ITEMS, ...TABLET_ITEMS, ...baseItems],
    groups: [...pobGroups, ...tabletGroups]
  }));
  console.log(`Generated ${tradeStats.length} trade stats, ${pobGroups.length} equipment affix groups, ${tabletGroups.length} tablet affixes, ${baseItems.length} base items.`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
