import {gh} from './gh.mjs';
import fs from 'node:fs';
const runs=await (await gh('/actions/workflows/ios.yml/runs?per_page=3')).json();
const run=runs.workflow_runs.find(r=>r.conclusion==='success');
const arts=await (await gh(`/actions/runs/${run.id}/artifacts`)).json();
const r=await gh(`/actions/artifacts/${arts.artifacts[0].id}/zip`,{raw:true});
const z=await (await fetch(r.headers.get('location'))).arrayBuffer();
fs.writeFileSync('/Users/macbookpro13m1/.aside/u/0/sessions/2026-10-22_SXkPWUk0DdwFub6U/tmp/v1qa/ios-shots.zip',Buffer.from(z));
console.log('saved',z.byteLength);
