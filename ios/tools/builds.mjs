import {api} from './asc.mjs';
const r=await api('GET','/v1/builds?filter[app]=6826636360&sort=-uploadedDate&limit=5');
console.log(r.status,JSON.stringify(r.json.data?.map(d=>({id:d.id,v:d.attributes.version,s:d.attributes.processingState,enc:d.attributes.usesNonExemptEncryption,exp:d.attributes.expired}))));
const id=r.json.data?.[0]?.id;
const g=await api('GET',`/v1/builds/${id}/buildBetaDetail`); console.log(JSON.stringify(g.json.data?.attributes));
const gr=await api('GET',`/v1/builds/${id}/betaGroups`); console.log(JSON.stringify(gr.json.data?.map(d=>d.attributes.name)));
