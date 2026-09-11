import {sha256} from './knowledgeLive.js';
// Stateless Responses include opaque reasoning ciphertext. Photo Select never
// replays it. Omit only this typed API field; source/tool text and reasoning
// summaries still pass through the normal credential scanner.
export function omitEncryptedReasoning(response) {
  const omittedEncryptedReasoning=[];
  if(!Array.isArray(response?.output))return {response,omittedEncryptedReasoning};
  const output=response.output.map((item,index)=>{
    if(item?.type!=='reasoning'||typeof item.encrypted_content!=='string')return item;
    const {encrypted_content,...visible}=item;
    omittedEncryptedReasoning.push({path:['output',index,'encrypted_content'],sha256:sha256(encrypted_content),bytes:Buffer.byteLength(encrypted_content)});
    return visible;
  });
  return {response:{...response,output},omittedEncryptedReasoning};
}
