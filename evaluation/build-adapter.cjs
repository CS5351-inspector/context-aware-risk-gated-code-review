'use strict';
const path=require('node:path');
require('esbuild').buildSync({entryPoints:[path.join(__dirname,'adapters/production.ts')],bundle:true,platform:'node',format:'cjs',target:'node18',outfile:path.join(__dirname,'.cache/production.cjs')});
const {hash,write,implementationHash}=require('./lib/data.cjs');
write(path.join(__dirname,'.cache/receipt.json'),{implementation_sha256:implementationHash(path.dirname(__dirname)),bundle_sha256:hash(require('node:fs').readFileSync(path.join(__dirname,'.cache/production.cjs')))});
console.log('Built evaluation bridge to existing C/A modules (no model call).');
