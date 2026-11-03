/** Isolated, public synthetic import cases. No local skill contents or credentials. */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
if (!process.argv[2]) throw new Error('Pass the built dist/core/catalog.js path');
const { Catalog } = await import(pathToFileURL(resolve(process.argv[2])).href);
const opaque = 'q7W2m9R4v8L6c3X5n1P0'; // Public rejection fixture, never usable.
const cases = [
 ['allow-js-dot',true,'js','const token = process.env.GENERIC_TOKEN;'],
 ['allow-js-bracket',true,'js','const token = process.env["GENERIC_TOKEN"];'],
 ['allow-python-environ',true,'py','token = os.environ["GENERIC_TOKEN"]'],
 ['allow-python-getenv',true,'py','token = os.getenv("GENERIC_TOKEN")'],
 ['allow-python-empty-default',true,'py','token = os.environ.get("GENERIC_TOKEN", "")'],
 ['allow-python-nested-calls',true,'py','token = urllib.parse.unquote(os.getenv("GENERIC_TOKEN", ""))'],
 ['allow-python-json-call',true,'py','token = json.loads(generic_response).get("token")'],
 ['allow-python-string-call',true,'py','token = generic_response.strip()'],
 ['allow-js-call',true,'js','const secret = client.readCredential("generic")'],
 ['allow-js-member-reference',true,'js','const token = client.options.authToken;'],
 ['allow-minified-member-reference',true,'js','const z={};z.token=this.options.authToken;z.secret=this.credentials;'],
 ['allow-shell-reference',true,'sh','GENERIC_TOKEN="$GENERIC_TOKEN"'],
 ['allow-shell-nested-empty',true,'sh','GENERIC_TOKEN=${GENERIC_TOKEN:-${FALLBACK_TOKEN:-}}'],
 ['allow-shell-required-message',true,'sh','GENERIC_TOKEN=${GENERIC_TOKEN:?set a credential at runtime}'],
 ['allow-shell-nested-required',true,'sh','GENERIC_TOKEN=${GENERIC_TOKEN:-${FALLBACK_TOKEN:?set a credential at runtime}}'],
 ['allow-doc-placeholder',true,'md','token: `<GENERIC_TOKEN>`'],
 ['allow-doc-env-expression',true,'md','token: `process.env.GENERIC_TOKEN`'],
 ['allow-doc-prose',true,'md','Authorization: Configure this through your local credential manager.'],
 ['allow-doc-cjk-prose',true,'md','Authorization: 请从环境变量读取认证信息，不在技能文件中保存凭证。'],
 ['allow-doc-instructions-url',true,'md','Obtain a token: https://example.invalid/documentation/authentication'],
 ['allow-path-reference',true,'md','token: ~/generic-authentication-cache'],
 ['reject-js-literal',false,'js',`const token = "${opaque}";`],
 ['reject-python-literal',false,'py',`token = '${opaque}'`],
 ['reject-yaml-literal',false,'yaml',`token: ${opaque}`],
 ['reject-json-literal',false,'json',`{"token":"${opaque}"}`],
 ['reject-doc-literal',false,'md',`token: ${opaque}`],
 ['reject-python-default',false,'py',`token = os.getenv("GENERIC_TOKEN", "${opaque}")`],
 ['reject-python-default-nested-call',false,'py',`token = str(os.getenv("GENERIC_TOKEN", "${opaque}"))`],
 ['reject-js-or-default',false,'js',`const token = process.env.GENERIC_TOKEN || "${opaque}";`],
 ['reject-js-nullish-default',false,'js',`const token = process.env.GENERIC_TOKEN ?? "${opaque}";`],
 ['reject-shell-default',false,'sh',`GENERIC_TOKEN=\${GENERIC_TOKEN:-${opaque}}`],
 ['reject-shell-nested-default',false,'sh',`GENERIC_TOKEN=\${GENERIC_TOKEN:-\${FALLBACK_TOKEN:-${opaque}}}`],
 ['reject-shell-equals-default',false,'sh',`GENERIC_TOKEN=\${GENERIC_TOKEN:=${opaque}}`],
 ['reject-generic-private-key',false,'txt','-----BEGIN PRIVATE KEY-----'],
 ['reject-rsa-private-key',false,'txt','-----BEGIN RSA PRIVATE KEY-----'],
 ['reject-openssh-private-key',false,'txt','-----BEGIN OPENSSH PRIVATE KEY-----'],
 ['reject-bare-provider-signature',false,'txt','sk-'+'A'.repeat(30)],
 ['reject-bare-github-signature',false,'txt','ghp_'+'A'.repeat(30)],
 ['reject-url-query-literal',false,'md',`token: https://example.invalid/auth?api_key=${opaque}`],
 ['reject-bearer-literal',false,'md',`Authorization: Bearer ${opaque}`],
];
const sandbox=mkdtempSync(join(tmpdir(),'public-admission-extended-'));
const results=[];
try {
 for(const [name,allow,ext,body] of cases){
  const source=join(sandbox,'sources',name);mkdirSync(source,{recursive:true});
  writeFileSync(join(source,'SKILL.md'),`---\nname: ${name}\ndescription: Public synthetic import regression.\n---\n`);
  writeFileSync(join(source,`sample.${ext}`),body+'\n');
  const home=join(sandbox,'homes',name),catalog=new Catalog(home);let imported=false,rejected=false;
  try {catalog.importPath(source);imported=true;}catch(e){rejected=/credential|secret|private.?key/i.test(String(e?.message??''));}finally{catalog.close();}
  const partial=!imported&&existsSync(join(home,'skills',name));
  results.push({name,expected:allow?'allow':'reject',observed:imported?'allowed':rejected?'rejected':'other_failure',passed:allow?imported:rejected&&!partial,...(partial?{partialRepository:true}:{})});
 }
} finally {rmSync(sandbox,{recursive:true,force:true});}
console.log(JSON.stringify({tests:results.length,passed:results.filter(x=>x.passed).length,failed:results.filter(x=>!x.passed).length,results},null,2));
process.exitCode=results.some(x=>!x.passed)?1:0;
