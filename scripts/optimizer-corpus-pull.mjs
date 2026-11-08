#!/usr/bin/env node
// Read-only: a stratified random sample of live postings for the optimizer corpus harness
// (scripts/optimizer-corpus.mjs). Needs SUPABASE_URL + SUPABASE_SERVICE_KEY; writes nothing to the database.
//   node scripts/optimizer-corpus-pull.mjs <out.json>
import fs from 'node:fs';
import crypto from 'node:crypto';
const U=process.env.SUPABASE_URL,K=process.env.SUPABASE_SERVICE_KEY;
const h={apikey:K,Authorization:`Bearer ${K}`};
const out=process.argv[2];
const plan={Greenhouse:160,Ashby:60,Lever:40,Adzuna:60,'The Muse':30,Remotive:10};
const rows=[];
for (const [src,n] of Object.entries(plan)) {
  const got=new Map();
  for (let tries=0; got.size<n && tries<40; tries++) {
    const start=crypto.randomUUID();
    const q=`jobs?source=eq.${encodeURIComponent(src)}&id=gt.${start}&order=id.asc&limit=${Math.min(25,n)}&select=id,title,company,location,source,description,apply_url,is_employer_posted`;
    const r=await fetch(`${U}/rest/v1/${q}`,{headers:h}); if(!r.ok){console.log(src,r.status,await r.text());break;}
    for (const row of await r.json()) if (got.size<n) got.set(row.id,row);
  }
  console.log(src, got.size); rows.push(...got.values());
}
const emp=await (await fetch(`${U}/rest/v1/jobs?is_employer_posted=eq.true&limit=30&select=id,title,company,location,source,description,apply_url,is_employer_posted`,{headers:h})).json();
console.log('employer',emp.length); rows.push(...emp);
fs.writeFileSync(out, JSON.stringify(rows));
