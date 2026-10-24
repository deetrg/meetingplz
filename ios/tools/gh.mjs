import {execSync} from 'node:child_process';
const out=execSync("printf 'protocol=https\\nhost=github.com\\n' | git credential-osxkeychain get").toString();
const TOKEN=out.split('\n').find(l=>l.startsWith('password=')).slice(9);
export async function gh(path,opts={}){
  const r=await fetch('https://api.github.com/repos/deetrg/meetingplz'+path,{...opts,headers:{Authorization:'Bearer '+TOKEN,Accept:'application/vnd.github+json'},redirect:opts.raw?'manual':'follow'});
  return r;
}
if(process.argv[1].endsWith('gh.mjs')){
  const cmd=process.argv[2];
  if(cmd==='runs'){
    const r=await (await gh('/actions/workflows/ios.yml/runs?per_page=5')).json();
    for(const x of r.workflow_runs||[]) console.log(x.id,x.run_number,x.status,x.conclusion,x.event,x.head_sha.slice(0,7),x.html_url);
    const id=process.argv[3]||r.workflow_runs?.[0]?.id;
    if(id){const j=await (await gh(`/actions/runs/${id}/jobs`)).json();
      for(const jb of j.jobs||[]){console.log('JOB',jb.id,jb.name,jb.status,jb.conclusion);for(const s of jb.steps) if(s.conclusion&&s.conclusion!=='success'||s.status==='in_progress') console.log('  step',s.name,s.status,s.conclusion);}}
  }
  if(cmd==='dispatch'){
    const r=await gh('/actions/workflows/ios.yml/dispatches',{method:'POST',body:JSON.stringify({ref:'main'})});
    console.log(r.status);
  }
  if(cmd==='log'){ // job id
    const r=await gh(`/actions/jobs/${process.argv[3]}/logs`);
    const t=await r.text(); const lines=t.split('\n');
    const tail=Number(process.argv[4]||80);
    console.log(lines.slice(-tail).join('\n'));
  }
}
