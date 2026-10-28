// usage: node upload-shots.mjs <dir69> <dir65>   (replaces any existing screenshots in those sets)
import fs from 'node:fs'; import crypto from 'node:crypto';
import {api} from './asc.mjs';
const LOC='6c05a660-d594-47b4-9c9e-ec15ad0b7d93';
const sets=[['APP_IPHONE_67',process.argv[2]],['APP_IPHONE_65',process.argv[3]]];
const err=r=>JSON.stringify(r.json?.errors?.map(e=>e.code+': '+e.detail));
for(const [type,dir] of sets){
  const files=fs.readdirSync(dir).filter(f=>f.endsWith('.png')).sort();
  let r=await api('GET',`/v1/appStoreVersionLocalizations/${LOC}/appScreenshotSets`);
  let set=r.json.data?.find(s=>s.attributes.screenshotDisplayType===type);
  if(!set){ r=await api('POST','/v1/appScreenshotSets',{data:{type:'appScreenshotSets',attributes:{screenshotDisplayType:type},relationships:{appStoreVersionLocalization:{data:{type:'appStoreVersionLocalizations',id:LOC}}}}});
    if(r.status>=300){console.log(type,'set fail',err(r));continue;} set=r.json.data; }
  const ex=await api('GET',`/v1/appScreenshotSets/${set.id}/appScreenshots`);
  for(const s of ex.json.data||[]) await api('DELETE',`/v1/appScreenshots/${s.id}`);
  for(const f of files){
    const buf=fs.readFileSync(dir+'/'+f);
    let c=await api('POST','/v1/appScreenshots',{data:{type:'appScreenshots',attributes:{fileName:f,fileSize:buf.length},relationships:{appScreenshotSet:{data:{type:'appScreenshotSets',id:set.id}}}}});
    if(c.status>=300){console.log(type,f,'reserve fail',err(c));continue;}
    const sh=c.json.data;
    for(const op of sh.attributes.uploadOperations){
      const h=Object.fromEntries(op.requestHeaders.map(x=>[x.name,x.value]));
      const pr=await fetch(op.url,{method:op.method,headers:h,body:buf.subarray(op.offset,op.offset+op.length)});
      if(!pr.ok) console.log(type,f,'chunk fail',pr.status);
    }
    const md5=crypto.createHash('md5').update(buf).digest('hex');
    const u=await api('PATCH',`/v1/appScreenshots/${sh.id}`,{data:{type:'appScreenshots',id:sh.id,attributes:{uploaded:true,sourceFileChecksum:md5}}});
    console.log(type,f,u.status,u.status>=300?err(u):u.json.data.attributes.assetDeliveryState?.state);
  }
  const fin=await api('GET',`/v1/appScreenshotSets/${set.id}/appScreenshots`);
  console.log(type,'states',JSON.stringify(fin.json.data?.map(s=>s.attributes.fileName+':'+s.attributes.assetDeliveryState?.state)));
}
