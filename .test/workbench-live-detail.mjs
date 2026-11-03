// Public isolated frontend regression: opening an Issue must not freeze its repair trajectory while dashboard polling advances.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import vm from 'node:vm';
const repo=resolve(process.argv[2]||process.cwd());
const source=readFileSync(join(repo,'src/web/app.ts'),'utf8')
 .replace(/^load\(\)\.then\(restoreHash\).*$/m,'')
 .replace(/^export \{\};?\s*$/m,'');
const elements=new Map();
function element(id){if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',hidden:false,disabled:false,value:'',classList:{add(){},remove(){},toggle(){}},contains(){return false},removeAttribute(){},addEventListener(){},querySelectorAll(){return []},querySelector(){return null},setAttribute(){},focus(){},showModal(){},close(){}});return elements.get(id);}
const calls=[];
const oldDetail={number:1,title:'Public polling fixture',status:'open',body:'public',created_at:'2026-01-01',updated_at:'2026-01-01',tests:[],runs:[{id:'public-run',runner:'test-runner',status:'running',started_at:'2026-01-01'}],pull_requests:[]};
const newDetail={...oldDetail,status:'closed',runs:[{...oldDetail.runs[0],status:'completed',finished_at:'2026-01-02'}]};
const dashboard={skills:[{id:'public-skill',name:'Public skill',available:true,source:'path'}],issues:[{...newDetail,skill:{id:'public-skill',name:'Public skill'}}],pull_requests:[],wiki:[],runs:newDetail.runs,harness:{state:'idle'},audit:{integrity:'verified'},automation:{default:{mode:'queued'}},merge_policy:{mode:'automatic'},notifications:{approval_required:0,items:[]}};
const context={console,JSON,Date,Map,Set,URLSearchParams,encodeURIComponent,decodeURIComponent,HTMLInputElement:class {},matchMedia(){return {matches:true}},
 document:{documentElement:{lang:'zh-CN'},getElementById:element,querySelectorAll(){return []},querySelector(){return null},addEventListener(){}},
 localStorage:{getItem(){return 'zh'},setItem(){}},navigator:{language:'zh-CN'},location:{hash:'#issue/public-skill/1'},history:{replaceState(){}},window:{addEventListener(){}},setInterval(){return 0},clearInterval(){},
 fetch:async path=>{calls.push(path);return {ok:true,json:async()=>path==='/api/dashboard'?dashboard:path==='/api/skills/public-skill/issues/1'?newDetail:(()=>{throw new Error('Unexpected public fixture path '+path)})()};}
};
vm.createContext(context);vm.runInContext(source+'\n;globalThis.publicTestHooks={state,load};',context,{filename:'actual-workbench-app.js'});
const {state,load}=context.publicTestHooks;
Object.assign(state,{view:'issues',skillId:'public-skill',detailType:'issues',detail:oldDetail});
await load();
await new Promise(resolve=>setImmediate(resolve));
assert.equal(state.detail.status,'closed','Polling must refresh the open Issue detail, not just the aggregate dashboard');
assert.equal(state.detail.runs[0].status,'completed','Polling must refresh repair trajectory state');
assert.ok(calls.includes('/api/skills/public-skill/issues/1'),'Polling must read the open Issue detail from its actual API');
console.log('PASS: open Issue detail and repair trajectory follow dashboard polling');
