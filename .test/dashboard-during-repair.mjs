// Public isolated regression: dashboard reads must work while the host protects repair audit records.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
const target = resolve(process.argv[2] || process.cwd());
const { Catalog } = await import(pathToFileURL(join(target,'dist/core/catalog.js')).href);
const root=mkdtempSync(join(tmpdir(),'skillhone-dashboard-lock-'));
const home=join(root,'home'), source=join(root,'source');
mkdirSync(source);writeFileSync(join(source,'SKILL.md'),'---\nname: public-dashboard-lock-demo\ndescription: Public isolated dashboard lock regression\n---\nDemo.\n');
let catalog,tracker;
try {
 catalog=new Catalog(home);
 const skill=catalog.importPath(source);
 tracker=catalog.tracker(String(skill.id));
 const result=tracker.createIssue('Public isolated repair issue','Dashboard must remain readable during host audit protection.');
 const run=tracker.startRun(Number(result.issue.number),'isolated-test','test-branch');
 assert.equal(catalog.dashboard().runs.some(x=>x.id===run.id),true);
 tracker.protectAuditTrail(()=>{
  const other=new DatabaseSync(tracker.dbPath);
  try {assert.throws(()=>other.exec('UPDATE project SET name=name'),/locked|busy/i,'Host write lock must remain enforced');}
  finally {other.close();}
  const dashboard=catalog.dashboard();
  assert.equal(dashboard.runs.find(x=>x.id===run.id)?.status,'running');
  assert.equal(dashboard.audit.integrity,'verified');
 });
 console.log('PASS: dashboard reads running repair; nested audit writes remain blocked');
} finally {tracker?.close();catalog?.close();rmSync(root,{recursive:true,force:true});}
