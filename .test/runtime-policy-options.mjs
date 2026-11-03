import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const target = resolve(process.argv[2] || process.cwd());
const { main } = await import(pathToFileURL(join(target, 'dist/cli.js')).href);
const originalLog = console.log;
const cases = [
  { name:'fresh default remains queued', before:null, flags:[], mode:'queued', interval:60 },
  { name:'saved immediate and interval survive init', before:['immediate',37], flags:[], mode:'immediate', interval:37 },
  { name:'saved scheduled and interval survive init', before:['scheduled',23], flags:[], mode:'scheduled', interval:23 },
  { name:'saved queued interval survives init', before:['queued',41], flags:[], mode:'queued', interval:41 },
  { name:'explicit mode overrides saved mode only', before:['immediate',53], flags:['--trigger','queued'], mode:'queued', interval:53 },
  { name:'explicit interval overrides saved interval only', before:['immediate',53], flags:['--interval-minutes','17'], mode:'immediate', interval:17 },
  { name:'fresh explicit mode and interval honored', before:null, flags:['--trigger','immediate','--interval-minutes','19'], mode:'immediate', interval:19 },
];
const results=[];
for (const item of cases) {
 const root=mkdtempSync(join(tmpdir(),'skillhone-host-trigger-'));
 const home=join(root,'home'); const source=join(root,'skill');
 mkdirSync(source); writeFileSync(join(source,'SKILL.md'),'---\nname: public-host-trigger-demo\ndescription: Isolated trigger policy verification\n---\nDemo.\n');
 async function cli(args) {
  const logs=[]; console.log=(...parts)=>logs.push(parts.map(String).join(' '));
  try { const code=await main(['--home',home,'--json',...args]); assert.equal(code,0,logs.join('\n')); return JSON.parse(logs.at(-1)); }
  finally { console.log=originalLog; }
 }
 try {
  if(item.before) await cli(['config','set','--trigger',item.before[0],'--interval-minutes',String(item.before[1])]);
  await cli(['--repo',source,'init','--mode','copy','--merge','automatic',...item.flags]);
  const result=await cli(['config','show']);
  assert.equal(result.trigger.mode,item.mode,item.name);
  assert.equal(result.trigger.interval_minutes,item.interval,item.name);
  results.push({name:item.name,passed:true,trigger:result.trigger});
 } catch(error) { results.push({name:item.name,passed:false,error:String(error)}); }
 finally { console.log=originalLog; rmSync(root,{recursive:true,force:true}); }
}
console.log(JSON.stringify({target,passed:results.every(x=>x.passed),checks:results},null,2));
if(results.some(x=>!x.passed)) process.exitCode=1;
