import {api} from './asc.mjs';
let r=await api('GET','/v1/devices'); console.log(r.status,JSON.stringify(r.json.data?.map(d=>d.attributes.name)));
if(!r.json.data?.length){
 r=await api('POST','/v1/devices',{data:{type:'devices',attributes:{name:'CI placeholder iPhone',platform:'IOS',udid:'00008120-001A2B3C4D5E6F78'}}});
 console.log(r.status,JSON.stringify(r.json).slice(0,400));
}
