// Public isolated frontend regression: polling must refresh the open detail for every shared load path (PR, Wiki, repository), not just Issues.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import vm from 'node:vm';
const repo=resolve(process.argv[2]||process.cwd());
const source=readFileSync(join(repo,'src/web/app.ts'),'utf8')
  .replace(/^load\(\)\.then\(restoreHash\).*$/m,'')
  .replace(/^export \{\};?\s*$/m,'');
function buildContext(dashboard, detail, view, skillId, detailType, detailObj, hashPrefix, hashRef) {
  const elements=new Map();
  function element(id){if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',hidden:false,disabled:false,value:'',classList:{add(){},remove(){},toggle(){}},contains(){return false},removeAttribute(){},addEventListener(){},querySelectorAll(){return []},querySelector(){return null},setAttribute(){},focus(){},showModal(){},close(){}});return elements.get(id);}
  const calls=[];
  const context={console,JSON,Date,Map,Set,URLSearchParams,encodeURIComponent,decodeURIComponent,HTMLInputElement:class {},
    document:{documentElement:{lang:'zh-CN'},getElementById:element,querySelectorAll(){return []},querySelector(){return null},addEventListener(){}},
    localStorage:{getItem(){return 'zh'},setItem(){}},navigator:{language:'zh-CN'},location:{hash:`#${hashPrefix}/${skillId}/${hashRef}`},history:{replaceState(){}},window:{addEventListener(){}},setInterval(){return 0},clearInterval(){},
    fetch:async path=>{calls.push(path);return {ok:true,json:async()=>path==='/api/dashboard'?dashboard:path===detailPath?detail:(()=>{throw new Error('Unexpected fixture path '+path)})()};}
  };
  return {context,calls};
}
const skillId='public-skill';
const cases=[
  {
    name:'PR detail refresh', detailType:'prs', view:'prs', hashPrefix:'pr', hashRef:'7',
    detailPath:`/api/skills/${skillId}/pull-requests/7`,
    oldDetail:{number:7,title:'Fix PR',status:'open',head:'feature',base:'main',runs:[{status:'running'}],commits:[],files:[]},
    newDetail:{number:7,title:'Fix PR',status:'merged',head:'feature',base:'main',runs:[{status:'completed'}],commits:[],files:[]},
    assert:(state)=>assert.equal(state.detail.status,'merged'),
  },
  {
    name:'Wiki detail refresh', detailType:'wiki', view:'wiki', hashPrefix:'wiki', hashRef:'run-1',
    detailPath:`/api/skills/${skillId}/wiki/run-1`,
    oldDetail:{slug:'run-1',title:'Old',body:'old',skill:{id:skillId,name:'s'}},
    newDetail:{slug:'run-1',title:'New',body:'new',skill:{id:skillId,name:'s'}},
    assert:(state)=>assert.equal(state.detail.title,'New'),
  },
  {
    name:'Repository detail refresh', detailType:'skills', view:'skills', hashPrefix:'repo', hashRef:'',
    detailPath:`/api/skills/${skillId}`,
    oldDetail:{name:'skill',default_branch:'main',issue_count:0,open_issue_count:0,pr_count:0,open_pr_count:0,wiki_count:0,completed_run_count:0},
    newDetail:{name:'skill',default_branch:'main',issue_count:2,open_issue_count:1,pr_count:1,open_pr_count:0,wiki_count:0,completed_run_count:1},
    assert:(state)=>assert.equal(state.detail.completed_run_count,1),
  },
];
for (const c of cases) {
  const dashboard={skills:[{id:skillId,name:'Public skill',available:true,source:'path'}],issues:[],pull_requests:[],wiki:[],runs:[],harness:{state:'idle'},audit:{integrity:'verified'},automation:{default:{mode:'queued'}},merge_policy:{mode:'automatic'},notifications:{approval_required:0,items:[]}};
  const {context,calls}=buildContext(dashboard,c.newDetail,c.view,skillId,c.detailType,c.oldDetail,c.hashPrefix,c.hashRef);
  // Patch the fetch closure to resolve the correct detail path.
  context.fetch=async path=>{calls.push(path);return {ok:true,json:async()=>path==='/api/dashboard'?dashboard:path===c.detailPath?c.newDetail:(()=>{throw new Error('Unexpected fixture path '+path)})()};};
  vm.createContext(context);vm.runInContext(source+'\n;globalThis.publicTestHooks={state,load};',context,{filename:'actual-workbench-app.js'});
  const {state,load}=context.publicTestHooks;
  Object.assign(state,{view:c.view,skillId,detailType:c.detailType,detail:c.oldDetail});
  await load();
  c.assert(state);
  assert.ok(calls.includes(c.detailPath),`${c.name}: polling must read the detail from its actual API`);
  console.log(`PASS: ${c.name} follows dashboard polling`);
}