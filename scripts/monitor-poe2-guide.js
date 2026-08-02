'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const statePath = path.join(root, 'monitor', 'poe2wiki-guide.json');
const api = 'https://www.poe2wiki.net/api.php?action=query&prop=revisions&titles=Guide%3AActs_quick_guide&rvprop=ids%7Ctimestamp&format=json&formatversion=2';

async function main() {
  const previous = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : {};
  const response = await fetch(api, {headers: {'user-agent': 'POE2helper-route-monitor/1.0'}});
  if (!response.ok) throw new Error(`POE2 Wiki API HTTP ${response.status}`);
  const payload = await response.json();
  const page = payload?.query?.pages?.[0];
  const revision = page?.revisions?.[0];
  if (!revision?.revid) throw new Error('POE2 Wiki revision missing.');
  const current = {
    realm: 'poe2',
    title: page.title,
    pageId: page.pageid,
    revisionId: revision.revid,
    revisionTimestamp: revision.timestamp,
    url: 'https://www.poe2wiki.net/wiki/Guide:Acts_quick_guide',
    checkedAt: new Date().toISOString()
  };
  const changed = Boolean(previous.revisionId && previous.revisionId !== current.revisionId);
  if (!previous.revisionId || changed) {
    fs.mkdirSync(path.dirname(statePath), {recursive: true});
    fs.writeFileSync(statePath, `${JSON.stringify(current, null, 2)}\n`);
  }
  console.log(`changed=${changed}`);
  console.log(`previous_revision=${previous.revisionId || ''}`);
  console.log(`current_revision=${current.revisionId}`);
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\nprevious_revision=${previous.revisionId || ''}\ncurrent_revision=${current.revisionId}\n`);
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
