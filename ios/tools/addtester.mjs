import {api} from './asc.mjs';
const gid='3c8f170c-1f86-46fe-98ac-16965d6d21f9';
let r=await api('GET','/v1/betaTesters?filter[email]=mrdee3010@icloud.com');
console.log(r.status,JSON.stringify(r.json.data?.map(d=>d.id)));
let t=r.json.data?.[0];
if(!t){
 r=await api('POST','/v1/betaTesters',{data:{type:'betaTesters',attributes:{email:'mrdee3010@icloud.com',firstName:'Dai',lastName:'Truong'},relationships:{betaGroups:{data:[{type:'betaGroups',id:gid}]}}}});
 console.log(r.status,JSON.stringify(r.json).slice(0,500));
} else {
 r=await api('POST',`/v1/betaGroups/${gid}/relationships/betaTesters`,{data:[{type:'betaTesters',id:t.id}]});
 console.log(r.status,JSON.stringify(r.json).slice(0,500));
}
r=await api('GET',`/v1/betaGroups/${gid}/betaTesters`);
console.log(r.status,JSON.stringify(r.json.data?.map(d=>d.attributes)));
