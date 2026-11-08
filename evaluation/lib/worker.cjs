'use strict';
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
(async()=>{
  const plugin = await import(pathToFileURL(process.argv[2]).href);
  const bridge = require(process.argv[3]);
  const payload=JSON.parse(fs.readFileSync(0,'utf8'));
  const result=await bridge.evaluate(payload,plugin.default || plugin);
  process.stdout.write(JSON.stringify(result));
})().catch(e=>{ process.stderr.write(JSON.stringify({error_type:e.name,error:'Adapter execution failed; inspect trusted adapter locally without exposing credentials'})+'\n');process.exitCode=1; });
