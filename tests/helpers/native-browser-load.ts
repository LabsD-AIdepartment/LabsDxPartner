import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { resolve } from 'node:path';
import { request, Agent } from 'node:https';
import { connectTestDatabase } from '../../scripts/test-database.mjs';
import { sourceForDrill } from '../../scripts/restore-drill-guards.mjs';
import { OverviewResponse } from '../../src/contracts/overview-http';
const root=process.cwd(),work=resolve(root,'.agent-work/20260911-browser-load');
process.umask(0o077);assert.equal(process.argv.length,2);
const cfg=JSON.parse(readFileSync(resolve(root,'.agent-work/20260911-native-marketing/private/environment.json'),'utf8'));
sourceForDrill(cfg.DATABASE_URL);assert.equal(cfg.BETTER_AUTH_URL,'https://127.0.0.1:4443');
Object.assign(process.env,{DATABASE_URL:cfg.DATABASE_URL,BETTER_AUTH_URL:cfg.BETTER_AUTH_URL,BETTER_AUTH_SECRET:cfg.BETTER_AUTH_SECRET,LABSD_IDENTITY_ENABLED:'1',LABSD_TEST_DATABASE_URL:cfg.DATABASE_URL});
const sql=await connectTestDatabase();
const agent=new Agent({keepAlive:true,maxSockets:20,ca:readFileSync('/Users/g/Library/Application Support/mkcert/rootCA.pem')});
let stop=false,active=0,peak=0,start=0,stage='fixtures';
process.on('SIGUSR1',()=>{stop=true;});
process.on('SIGTERM',()=>{stop=true;});
const samples:Array<{index:number;variant:number;startMs:number;endMs:number;ms:number;bytes:number}>=[];
const clients:Array<{index:number;partnerId:string;revision:string;cookie:string;sessionToken:string;sessionId:string}>=[];
let runtime:ReturnType<typeof import('../../src/server/modules/identity/runtime').getIdentityRuntime>;
function fetchReport(path:string,cookie:string){return new Promise<{status:number;body:string}>((done,fail)=>{
 const req=request('https://127.0.0.1:4443'+path,{agent,headers:{cookie}},res=>{let body='';res.setEncoding('utf8');res.on('data',v=>{body+=v;if(Buffer.byteLength(body)>150000)res.destroy(new Error('Payload budget exceeded'));});res.on('error',fail);res.on('end',()=>done({status:res.statusCode!,body}));});req.setTimeout(15000,()=>req.destroy(new Error('HTTP timeout')));req.on('error',fail);req.end();
});}
try{
 const [location]=await sql`select current_setting('data_directory') as directory`;
 assert(location.directory.endsWith('/20260911-native-marketing/pg'));
 const fixtures=await sql`with selected as (
 select distinct on(s.new_earnings_minor) s.partner_id,s.generation_id,s.new_earnings_minor,
 ((s.new_earnings_minor/1000-10001)/10)::int as index
 from portal_statements.statements s join portal_access.partners p on p.id=s.partner_id
 where p.name='Synthetic Overview partner' and p.status='active' and s.opening_minor=0 and s.adjustments_minor=0
 and s.new_earnings_minor between 10001000 and 10991000 and mod(s.new_earnings_minor-10001000,10000)=0
 and (select count(*) from portal_statements.statements other where other.partner_id=s.partner_id)=1
 and not exists(select 1 from portal_statements.settlements t where t.partner_id=s.partner_id)
 order by s.new_earnings_minor,s.published_at desc)
 select s.*,m.user_id,'p'||p.revision||':m'||m.permission_revision as revision from selected s
 join portal_access.partners p on p.id=s.partner_id join portal_access.memberships m on m.partner_id=s.partner_id
 join portal_identity.users u on u.id=m.user_id
 where m.status='active' and 'view_earnings'=any(m.capabilities) and u.username like 'overview_%'
 order by index`;
 assert.equal(fixtures.length,100);assert.equal(new Set(fixtures.map(f=>f.partner_id)).size,100);assert.equal(new Set(fixtures.map(f=>f.user_id)).size,100);
 const {getIdentityRuntime}=await import('../../src/server/modules/identity/runtime');runtime=getIdentityRuntime()!;await runtime.assertBinding();const ctx=await runtime.auth.$context;
 for(let index=0;index<100;index++){
  const f=fixtures[index];assert.equal(f.index,index);
  const [rows]=await sql`select count(*)::int as count,min(amount_minor)::text as min,max(amount_minor)::text as max,sum(amount_minor)::text as sum,sum(eligible_base_minor)::text as base from portal_imports.earning_rows where generation_id=${f.generation_id}`;
  assert.equal(rows.count,1000);assert.equal(rows.min,String(10001+10*index));assert.equal(rows.max,rows.min);assert.equal(rows.sum,String((10001+10*index)*1000));assert.equal(rows.base,String((100005+100*index)*1000));
  const session=await ctx.internalAdapter.createSession(f.user_id);assert(session);
  const signature=createHmac('sha256',cfg.BETTER_AUTH_SECRET).update(session.token).digest('base64');
  clients.push({sessionToken:session.token,sessionId:session.id,index,partnerId:f.partner_id,revision:f.revision,cookie:ctx.authCookies.sessionToken.name+'='+encodeURIComponent(session.token+'.'+signature)});
 }
 stage='warm-up';
 async function read(index:number,variant:number,record:boolean){
  const client=clients[index],lines=variant===0?1000:variant===3?250:500;
  const q=new URLSearchParams({partnerId:client.partnerId,permissionRevision:client.revision,from:variant>=2?'2026-08-01':'2026-07-01',toExclusive:'2026-09-01',...(variant%2?{brand:'Axtion'}:{})});
  const startMs=Date.now(),before=performance.now();active++;peak=Math.max(peak,active);
  try{
   const res=await fetchReport('/api/v1/partner/overview?'+q,client.cookie);assert.equal(res.status,200);const body=OverviewResponse.parse(JSON.parse(res.body));assert.equal(body.partnerId,client.partnerId);
   const expected=BigInt(10001+10*index)*BigInt(lines),base=BigInt(100005+100*index)*BigInt(lines),data=body.data;
   assert.equal(data.earnings.confirmed?.minor,expected.toString());assert.equal(data.earnings.eligibleSales?.minor,base.toString());assert.equal(data.obligation.confirmedUnpaid?.minor,String((10001+10*index)*1000));
   assert.equal(data.earnings.trend.reduce((sum,r)=>sum+BigInt(r.amount.minor),0n),expected);
   assert.equal(data.earnings.topContent.reduce((sum,r)=>sum+BigInt(r.earned!.minor),0n),expected);
   if(record)samples.push({index,variant,startMs,endMs:Date.now(),ms:performance.now()-before,bytes:Buffer.byteLength(res.body)});
  }finally{active--;}
 }
 for(let batch=0;batch<5;batch++){const warm=await Promise.allSettled(Array.from({length:20},(_,n)=>read(batch*20+n,0,false)));const failure=warm.find(r=>r.status==='rejected');if(failure?.status==='rejected')throw failure.reason;}
 stage='load';start=Date.now();
 writeFileSync(resolve(work,'evidence/ready.json'),JSON.stringify({pid:process.pid,startMs:start,partners:100,rows:100000,workers:20},null,2),{flag:'wx',mode:0o600});console.log('Native TLS load ready: '+process.pid+'; 100 partners / 100000 rows / 20 workers');
 const deadline=start+180000;
 const workers=await Promise.allSettled(Array.from({length:20},async(_,worker)=>{let step=0;try{while(!stop&&Date.now()<deadline){await read((worker+(step%5)*20),Math.floor(step/5)%4,true);step++;}}catch(error){stop=true;throw error;}}));assert(workers.every(r=>r.status==='fulfilled'),'Worker failed');
 const sorted=samples.map(r=>r.ms).sort((a,b)=>a-b);assert(samples.length>=400);assert.equal(peak,20);
 const result={status:'passed',startMs:start,endMs:Date.now(),partners:100,rows:100000,workers:20,peakOutstanding:peak,requests:samples.length,p95Ms:sorted[Math.ceil(sorted.length*0.95)-1],maxMs:sorted.at(-1),maxBytes:Math.max(...samples.map(r=>r.bytes)),scope:'Native built Next/TLS; persisted synthetic sessions, not login-throughput; 20 closed-loop workers'};
 assert(result.p95Ms<=500);assert(result.maxBytes<=100000);
 writeFileSync(resolve(work,'evidence/load-result.json'),JSON.stringify(result,null,2),{flag:'wx',mode:0o600});console.log(JSON.stringify(result));
}catch(error){stop=true;const e=error as {name?:string;code?:string;actual?:unknown;expected?:unknown};const numeric=(v:unknown)=>typeof v==='number'||typeof v==='string'&&/^[0-9]+$/.test(v)?v:undefined;console.log(JSON.stringify({status:'failed',stage,name:e.name,code:e.code,actual:numeric(e.actual),expected:numeric(e.expected)}));process.exitCode=1;}
finally{
 agent.destroy();
 try{
  if(runtime!){
   const ctx=await runtime!.auth.$context;
   const cleanup=await Promise.allSettled(clients.map(client=>ctx.internalAdapter.deleteSession(client.sessionToken)));
   assert(cleanup.every(result=>result.status==='fulfilled'),'Session cleanup failed');
   if(clients.length){const [remaining]=await sql`select count(*)::int as count from portal_identity.sessions where id=any(${clients.map(c=>c.sessionId)}::text[])`;assert.equal(remaining.count,0);}
   const result={cleanup:'test-created sessions removed',count:clients.length};console.log(JSON.stringify(result));
   writeFileSync(resolve(work,'evidence/cleanup.json'),JSON.stringify(result),{flag:'wx',mode:0o600});
  }
 }catch{process.exitCode=1;console.log(JSON.stringify({status:'failed',stage:'cleanup'}));}
 finally{
  try{writeFileSync(resolve(work,'evidence/samples-'+Date.now()+'.json'),JSON.stringify(samples),{flag:'wx',mode:0o600});}
  finally{await sql.end();}
 }
}
