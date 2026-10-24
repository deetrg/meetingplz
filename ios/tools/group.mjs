import {api} from './asc.mjs';
const APP='6826636360';
let r=await api('GET',`/v1/apps/${APP}/betaGroups`);
console.log(r.status,JSON.stringify(r.json.data?.map(d=>({id:d.id,n:d.attributes.name,i:d.attributes.isInternalGroup}))));
let g=r.json.data?.find(d=>d.attributes.name==='Team');
if(!g){
 r=await api('POST','/v1/betaGroups',{data:{type:'betaGroups',attributes:{name:'Team',isInternalGroup:true,hasAccessToAllBuilds:true},relationships:{app:{data:{type:'apps',id:APP}}}}});
 console.log(r.status,JSON.stringify(r.json).slice(0,600)); g=r.json.data;
}
const gid=g.id; console.log('group',gid);
r=await api('GET','/v1/users?filter[roles]=ADMIN&limit=50');
console.log(r.status,JSON.stringify(r.json.data?.map(d=>({id:d.id,u:d.attributes.username,e:d.attributes.email,r:d.attributes.roles}))));
