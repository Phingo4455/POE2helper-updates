'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const generated = path.join(root, 'generated');
const manual = path.join(root, 'manual');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function hasEnglish(items, name) {
  return items.some(item => item.en === name);
}

function main() {
  const translations = readJson(path.join(generated, 'poe2-translations.json'));
  const tradeStats = readJson(path.join(generated, 'poe2-trade-stats.json'));
  const affixes = readJson(path.join(generated, 'poe2-affix-data.json'));
  const icons = readJson(path.join(generated, 'poe2-icons.json'));
  const supplement = readJson(path.join(manual, 'poe2-dictionary-supplement.json'));
  const zones = readJson(path.join(manual, 'poe2-zones.json'));

  assert(Array.isArray(translations) && translations.length >= 5000, `翻译词典数量异常：${translations.length}`);
  assert(Array.isArray(tradeStats) && tradeStats.length >= 6000, `交易词缀数量异常：${tradeStats.length}`);
  assert(Array.isArray(affixes.items) && affixes.items.length >= 1000, `装备底材数量异常：${affixes.items?.length}`);
  assert(Array.isArray(affixes.groups) && affixes.groups.length >= 400, `词缀家族数量异常：${affixes.groups?.length}`);
  assert(Object.keys(icons.icons?.base || {}).length >= 3000, '底材图标数量异常');
  assert(Object.keys(icons.icons?.unique || {}).length >= 250, '传奇图标数量异常');
  assert(Object.keys(icons.icons?.gem || {}).length >= 700, '技能图标数量异常');
  assert(Array.isArray(supplement) && supplement.length >= 10, '人工俗称与补充词典为空或数量异常');
  assert(Object.keys(zones).length >= 80, '区域名称映射数量异常');

  for (const name of ['Mageblood', "Alpha's Howl", 'Constricting Command', 'Flicker Strike']) {
    assert(hasEnglish(translations, name), `POE2 核心哨兵词条缺失：${name}`);
  }
  assert(hasEnglish(supplement, 'Mageblood') && hasEnglish(supplement, 'Constricting Command'), '玩家俗称哨兵词条缺失');

  const allNames = translations.map(item => `${item.en}\n${item.zh}\n${item.tw}`).join('\n');
  for (const forbidden of ['Scarab', '圣甲虫', '聖甲蟲']) {
    assert(!allNames.includes(forbidden), `检测到疑似 POE1 专属词条：${forbidden}`);
  }

  const duplicateEnglish = translations.map(item => item.en).filter((name, index, values) => name && values.indexOf(name) !== index);
  assert(duplicateEnglish.length === 0, `英文主键重复：${[...new Set(duplicateEnglish)].slice(0, 5).join(', ')}`);

  console.log(`Validation passed: ${translations.length} terms, ${tradeStats.length} trade stats, ${affixes.items.length} bases, ${affixes.groups.length} affix groups.`);
}

main();
