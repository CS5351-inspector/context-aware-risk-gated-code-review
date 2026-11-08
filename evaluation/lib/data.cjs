'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { inside } = require('../validate.cjs');
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const hash = value => crypto.createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const write = (p, value) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(value, null, 2) + '\n'); };
function load(root) {
  const manifest = read(path.join(root, 'manifest.json'));
  return manifest.cases.map(item => {
    const c = read(inside(root, item.file));
    return { case: c, family: read(inside(root, `families/${c.family_id}/family.json`)), gold: read(inside(root, c.gold_file)) };
  });
}
function fingerprint(root) {
  const names = new Set(['manifest.json']);
  for (const { case: c, family: f } of load(root)) {
    names.add(`cases/${c.case_id}.json`); names.add(c.input.diff_file); names.add(c.gold_file);
    names.add(`families/${c.family_id}/family.json`);
    for (const [version, files] of Object.entries(f.file_hashes)) for (const file of Object.keys(files)) names.add(`families/${c.family_id}/${version}/${file}`);
    if (c.label_status === 'reviewed') names.add(`reviews/${c.case_id}.json`);
  }
  return hash([...names].sort().map(file => [file, hash(fs.readFileSync(inside(root, file)))]));
}
// Only source/input data cross the worker boundary. This is an allow-list, not a security sandbox.
function inputFor(root, item) {
  const { case: c, family: f } = item;
  const files = Object.fromEntries(Object.keys(f.file_hashes[c.code_variant]).map(file => [file, fs.readFileSync(inside(root, `${c.input.head_dir}/${file}`), 'utf8')]));
  return { requirement: f.requirement, diff: fs.readFileSync(inside(root, c.input.diff_file), 'utf8'), files,
    headSha: hash(files), diffBaseSha: hash(f.file_hashes.base), changedFiles: [...c.input.changed_files] };
}
function implementationHash(repo) {
  const names=[];
  function walk(dir){for(const e of fs.readdirSync(path.join(repo,dir),{withFileTypes:true})){
    const rel=dir+'/'+e.name;
    if(e.isDirectory()) { if(!['.cache','runs','reports','tests','families','cases','gold','reviews'].includes(e.name))walk(rel); }
    else if(/\.(ts|cjs)$/.test(e.name)&&!e.name.startsWith('local-provider'))names.push(rel);
  }}
  walk('src');walk('evaluation');names.push('package.json','package-lock.json');
  return hash(names.sort().map(file=>[file,hash(fs.readFileSync(path.join(repo,file)))]));
}
module.exports = { read, hash, write, load, fingerprint, inputFor, implementationHash };
