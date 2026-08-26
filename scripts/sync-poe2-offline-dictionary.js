const fs = require('node:fs');
const path = require('node:path');
const OpenCC = require('opencc-js');

const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, 'generated');
const baseHeaders = {'user-agent': 'POE2 Route Companion'};
const identityFiles = /\/(?:Gems_data\.txt|Items_[^/]+\.txt|Uniques\.txt|tree_dn|Monsters)\.csv$/;
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

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted && char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { row.push(field); field = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field); if (row[0] && row[1]) rows.push([row[0].trim(), row[1].trim()]);
      row = []; field = '';
    } else field += char;
  }
  row.push(field); if (row[0] && row[1]) rows.push([row[0].trim(), row[1].trim()]);
  return rows;
}

function typeFor(file) {
  if (file.includes('Gems_data')) return '技能宝石';
  if (file.includes('Uniques')) return '传奇物品';
  if (file.includes('tree_dn')) return '天赋';
  if (file.includes('Monsters')) return '怪物';
  return '装备底材';
}

function typeForTradeGroup(group) {
  const key = `${group.id || ''} ${group.label || ''}`.toLowerCase();
  if (key.includes('currency')) return '通货';
  if (key.includes('card')) return '命运卡';
  if (key.includes('gem')) return '技能宝石';
  if (key.includes('jewel')) return '珠宝';
  if (key.includes('flask')) return '药剂';
  if (key.includes('map') || key.includes('fragment')) return '地图/碎片';
  if (key.includes('unique')) return '传奇物品';
  if (/(weapon|armour|armor|accessory)/.test(key)) return '装备底材';
  return '交易物品';
}

function addOfficialTradeName(target, value, typeLabel) {
  if (typeof value !== 'string') return;
  const name = value.trim();
  if (!name || name.length > 140) return;
  target.set(name, typeLabel);
}

function uncutGemKey(value, locale) {
  if (typeof value !== 'string') return '';
  const name = value.trim().replace(/\s+/g, ' ');
  let match;
  if (locale === 'en') {
    match = name.match(/^Uncut (Skill|Support|Spirit) Gem(?: \(Level (\d+)\))?$/);
  } else if (locale === 'tw') {
    match = name.match(/^(?:未切割的)?(技能|輔助|精魂)寶石(?:[（(]等級\s*(\d+)[）)])?$/);
  } else {
    match = name.match(/^(?:未切割的)?(技能|辅助|精魂)宝石(?:[（(]等级\s*(\d+)[）)])?$/);
  }
  if (!match) return '';
  const family = locale === 'en'
    ? match[1].toLowerCase()
    : ({技能: 'skill', 輔助: 'support', 辅助: 'support', 精魂: 'spirit'})[match[1]];
  return `${family}:${match[2] || 'base'}`;
}

function localizedUncutGems(data, locale) {
  const translations = new Map();
  const gemGroup = (data.result || []).find(group => group.id === 'gem');
  for (const entry of gemGroup?.entries || []) {
    const key = uncutGemKey(entry.type, locale);
    if (key) translations.set(key, entry.type.trim());
  }
  return translations;
}

async function main() {
  fs.mkdirSync(outputDir, {recursive: true});
  const pobTree = await getJson('https://api.github.com/repos/PathOfBuildingCommunity/PathOfBuilding-PoE2/git/trees/dev?recursive=1');
  const pobPaths = pobTree.tree.filter(item => item.type === 'blob' && /^src\/Data\/(?:Bases\/[^/]+\.lua|Uniques\/(?!Special\/)[^/]+\.lua|Gems\.lua|Skills\/(?:act|sup|other|minion)[^/]*\.lua)$/.test(item.path)).map(item => item.path);
  const pobTexts = await Promise.all(pobPaths.map(file => getText(`https://raw.githubusercontent.com/PathOfBuildingCommunity/PathOfBuilding-PoE2/dev/${file}`)));
  const corpus = pobTexts.join('\n');
  const scoutItems = await getJson('https://api.poe2scout.com/pc/Leagues/Standard/Items');
  const currentPoe2Names = new Set(scoutItems.flatMap(item => [item.Name, item.Text, item.Type]).filter(Boolean));
  const [officialTradeData, officialChinaData, officialTaiwanData] = await Promise.all([
    getJson('https://www.pathofexile.com/api/trade2/data/items'),
    getJson('https://poe.game.qq.com/api/trade2/data/items'),
    getJson('https://pathofexile.tw/api/trade2/data/items'),
  ]);
  const officialTradeNames = new Map();
  const officialGroupIds = new Set();
  for (const group of officialTradeData.result || []) {
    officialGroupIds.add(group.id);
    const typeLabel = typeForTradeGroup(group);
    for (const entry of group.entries || []) {
      addOfficialTradeName(officialTradeNames, entry.type, typeLabel);
      addOfficialTradeName(officialTradeNames, entry.name, '传奇物品');
    }
  }
  if (officialTradeNames.size < 3000 || ['gem', 'currency', 'armour', 'weapon'].some(id => !officialGroupIds.has(id))) {
    throw new Error(`POE2 official trade source is incomplete: ${officialTradeNames.size} names`);
  }

  const charmTree = await getJson('https://api.github.com/repos/Chuanhsing/PoeCharm2/git/trees/main?recursive=1');
  const translationPaths = charmTree.tree.map(item => item.path).filter(file => /^Data\/Translate\/zh-r(?:CN|TW)\//.test(file) && identityFiles.test(file));
  const translations = await Promise.all(translationPaths.map(async file => ({file, text: await getText(`https://raw.githubusercontent.com/Chuanhsing/PoeCharm2/main/${file}`)})));
  const records = new Map();
  for (const {file, text} of translations) {
    const locale = file.includes('/zh-rCN/') ? 'zh' : 'tw';
    for (const [english, chinese] of parseCsv(text)) {
      const type = typeFor(file);
      const tradeType = officialTradeNames.get(english);
      if (english.length > 140 || (type !== '天赋' && !corpus.includes(english) && !tradeType) || (type === '传奇物品' && !currentPoe2Names.has(english) && !tradeType)) continue;
      const typeLabel = tradeType || type;
      const record = records.get(english) || {en: english, zh: '', tw: '', typeLabel};
      record[locale] = chinese;
      if (tradeType || type !== '装备底材') record.typeLabel = typeLabel;
      records.set(english, record);
    }
  }
  for (const [english, typeLabel] of officialTradeNames) {
    if (!records.has(english)) records.set(english, {en: english, zh: '', tw: '', typeLabel});
  }
  const chinaUncutGems = localizedUncutGems(officialChinaData, 'zh');
  const taiwanUncutGems = localizedUncutGems(officialTaiwanData, 'tw');
  const officialUncutNames = [...officialTradeNames.keys()].filter(english => uncutGemKey(english, 'en'));
  for (const english of officialUncutNames) {
    const key = uncutGemKey(english, 'en');
    const record = records.get(english);
    record.tw = taiwanUncutGems.get(key) || '';
    record.zh = chinaUncutGems.get(key) || (record.tw ? toSimplified(record.tw) : '');
  }
  const output = [...records.values()].sort((a, b) => a.en.localeCompare(b.en));
  for (const sentinel of ['Uncut Skill Gem', 'Uncut Support Gem', 'Uncut Spirit Gem']) {
    if (!output.some(term => term.en === sentinel)) throw new Error(`POE2 official trade sentinel missing: ${sentinel}`);
  }
  if (officialUncutNames.length < 40 || officialUncutNames.some(english => {
    const term = records.get(english);
    return !term.zh || !term.tw;
  })) throw new Error(`POE2 Uncut Gem translations are incomplete: ${officialUncutNames.length} official names`);
  if (output.some(term => /\bScarabs?\b|圣甲虫|聖甲蟲/i.test(`${term.en} ${term.zh} ${term.tw}`))) throw new Error('POE1 scarab leaked into POE2 dictionary');
  fs.writeFileSync(path.join(outputDir, 'poe2-translations.json'), JSON.stringify(output, null, 2));
  console.log(`Generated ${output.length} POE2-only offline terms (${output.filter(x => x.tw).length} TW, ${output.filter(x => x.zh).length} CN, ${officialTradeNames.size} official trade names)`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
