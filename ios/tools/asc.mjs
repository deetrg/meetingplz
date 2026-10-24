import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
const KEY_ID='3SRX7UKS6U', ISS='bfea9a29-2504-45b9-be83-d4796218495b';
const pem=fs.readFileSync(os.homedir()+'/.appstoreconnect/private_keys/AuthKey_3SRX7UKS6U.p8','utf8');
const b=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
export function jwt(){
  const now=Math.floor(Date.now()/1000);
  const h=b({alg:'ES256',kid:KEY_ID,typ:'JWT'}), p=b({iss:ISS,iat:now,exp:now+1100,aud:'appstoreconnect-v1'});
  const sig=crypto.sign('sha256',Buffer.from(h+'.'+p),{key:pem,dsaEncoding:'ieee-p1363'}).toString('base64url');
  return h+'.'+p+'.'+sig;
}
export async function api(method,path,body){
  const r=await fetch('https://api.appstoreconnect.apple.com'+path,{method,headers:{Authorization:'Bearer '+jwt(),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  const t=await r.text(); let j; try{j=JSON.parse(t)}catch{j=t}
  return {status:r.status,json:j};
}
if (process.argv[1].endsWith('asc.mjs')) {
  const cmd=process.argv[2];
  if(cmd==='bundle'){
    let r=await api('GET','/v1/bundleIds?filter[identifier]=com.dai.meetingplz');
    console.log(r.status, JSON.stringify(r.json.data?.map(d=>({id:d.id,a:d.attributes}))));
    if(!r.json.data?.length){
      r=await api('POST','/v1/bundleIds',{data:{type:'bundleIds',attributes:{identifier:'com.dai.meetingplz',name:'MeetingPlz',platform:'IOS'}}});
      console.log(r.status, JSON.stringify(r.json).slice(0,800));
    }
  }
  if(cmd==='apps'){
    const r=await api('GET','/v1/apps');
    console.log(r.status, JSON.stringify(r.json.data?.map(d=>({id:d.id,n:d.attributes.name,b:d.attributes.bundleId,sku:d.attributes.sku}))||r.json));
  }
}
