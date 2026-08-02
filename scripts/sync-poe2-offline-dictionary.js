const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, 'generated');
const baseHeaders = {'user-agent': 'POE2 Route Companion'};
const identityFiles = /\/(?:Gems_data\.txt|Items_[^/]+\.txt|Uniques\.txt|tree_dn|Monsters)\.csv$/;

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

async function main() {
  fs.mkdirSync(outputDir, {recursive: true});
  const pobTree = await getJson('https://api.github.com/repos/PathOfBuildingCommunity/PathOfBuilding-PoE2/git/trees/dev?recursive=1');
  const pobPaths = pobTree.tree.filter(item => item.type === 'blob' && /^src\/Data\/(?:Bases\/[^/]+\.lua|Uniques\/(?!Special\/)[^/]+\.lua|Gems\.lua|Skills\/(?:act|sup|other|minion)[^/]*\.lua)$/.test(item.path)).map(item => item.path);
  const pobTexts = await Promise.all(pobPaths.map(file => getText(`https://raw.githubusercontent.com/PathOfBuildingCommunity/PathOfBuilding-PoE2/dev/${file}`)));
  const corpus = pobTexts.join('\n');
  const scoutItems = await getJson('https://api.poe2scout.com/pc/Leagues/Standard/Items');
  const currentPoe2Names = new Set(scoutItems.flatMap(item => [item.Name, item.Text, item.Type]).filter(Boolean));

  const charmTree = await getJson('https://api.github.com/repos/Chuanhsing/PoeCharm2/git/trees/main?recursive=1');
  const translationPaths = charmTree.tree.map(item => item.path).filter(file => /^Data\/Translate\/zh-r(?:CN|TW)\//.test(file) && identityFiles.test(file));
  const translations = await Promise.all(translationPaths.map(async file => ({file, text: await getText(`https://raw.githubusercontent.com/Chuanhsing/PoeCharm2/main/${file}`)})));
  const records = new Map();
  for (const {file, text} of translations) {
    const locale = file.includes('/zh-rCN/') ? 'zh' : 'tw';
    for (const [english, chinese] of parseCsv(text)) {
      const type = typeFor(file);
      if (english.length > 100 || (type !== '天赋' && !corpus.includes(english)) || (type === '传奇物品' && !currentPoe2Names.has(english))) continue;
      const record = records.get(english) || {en: english, zh: '', tw: '', typeLabel: type};
      record[locale] = chinese;
      if (typeFor(file) !== '装备底材') record.typeLabel = typeFor(file);
      records.set(english, record);
    }
  }
  const output = [...records.values()].filter(term => term.tw || term.zh).sort((a, b) => a.en.localeCompare(b.en));
  fs.writeFileSync(path.join(outputDir, 'poe2-translations.json'), JSON.stringify(output, null, 2));
  console.log(`Generated ${output.length} POE2-only offline terms (${output.filter(x => x.tw).length} TW, ${output.filter(x => x.zh).length} CN)`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
