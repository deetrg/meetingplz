import {api} from './asc.mjs';
for (const c of ['USERNOTIFICATIONS_TIME_SENSITIVE','PUSH_NOTIFICATIONS']) {
const r=await api('POST','/v1/bundleIdCapabilities',{data:{type:'bundleIdCapabilities',attributes:{capabilityType:c},relationships:{bundleId:{data:{type:'bundleIds',id:'684VAL342Z'}}}}});
console.log(c,r.status,JSON.stringify(r.json).slice(0,400));
}
const r=await api('GET','/v1/bundleIds/684VAL342Z/bundleIdCapabilities');
console.log(JSON.stringify(r.json.data?.map(d=>d.attributes.capabilityType)));
