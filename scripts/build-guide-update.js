'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manual = path.join(root, 'manual');
const latest = path.join(root, 'latest');
const guideName = 'poe2-campaign-guide.json';
const guide = JSON.parse(fs.readFileSync(path.join(manual, guideName), 'utf8'));

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function validateGuide(value) {
  const taskCount = value.routes?.reduce((sum, stage) => sum + (stage.tasks?.length || 0), 0) || 0;
  if (value.schemaVersion !== 1 || value.realm !== 'poe2') throw new Error('Campaign guide must be POE2 schema 1.');
  if (!/^[0-9A-Za-z._-]+$/.test(value.guideVersion || '')) throw new Error('Invalid campaign guide version.');
  if (value.routes?.length < 7 || taskCount < 59 || Object.keys(value.tips || {}).length < 59) throw new Error('Campaign guide is incomplete.');
  if (!value.areaRouteAliases || !value.stageGuides || !value.terms || !value.typeLabels) throw new Error('Campaign guide helper data is incomplete.');
}

validateGuide(guide);
fs.mkdirSync(latest, {recursive: true});
const guideBytes = Buffer.from(JSON.stringify(guide));
fs.writeFileSync(path.join(latest, guideName), guideBytes);
const manifest = {
  schemaVersion: 1,
  realm: 'poe2',
  channel: 'stable',
  guideVersion: guide.guideVersion,
  gameVersion: guide.gameVersion,
  updatedAt: guide.updatedAt,
  sourceRevision: guide.sourceRevision,
  releaseNotes: guide.releaseNotes || [],
  sources: guide.sources || [],
  file: {
    name: guideName,
    url: `https://raw.githubusercontent.com/Phingo4455/POE2helper-updates/main/latest/${guideName}`,
    sha256: sha256(guideBytes),
    size: guideBytes.length
  }
};
fs.writeFileSync(path.join(latest, 'guide-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

const appManifest = JSON.parse(fs.readFileSync(path.join(manual, 'app-manifest.json'), 'utf8'));
if (appManifest.schemaVersion !== 1 || !/^\d+(?:\.\d+){2,3}$/.test(appManifest.version || '')) throw new Error('Invalid app manifest.');
fs.writeFileSync(path.join(latest, 'app-manifest.json'), `${JSON.stringify(appManifest, null, 2)}\n`);
console.log(`Built guide ${guide.guideVersion} and app ${appManifest.version} manifests.`);
