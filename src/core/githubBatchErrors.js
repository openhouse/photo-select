import {credentialLike} from './githubBridge.js';
// Raw API prose stays in private receipts; the terminal gets codes and fixed guidance.
export function batchDiagnostic(error={}, {customId=null,status=null}={}) {
  const text=value=>typeof value==='string'?(credentialLike(value)?'[credential-like diagnostic redacted]':value.slice(0,2000)):null;
  const label=value=>typeof value==='string'&&/^[a-zA-Z0-9_.[\]-]{1,100}$/.test(value)&&!credentialLike(value)?value:null;
  return {customId,status:Number.isInteger(status)?status:Number.isInteger(error.status)?error.status:null,
    code:label(error.code),type:label(error.type),param:label(error.param),message:text(error.message)};
}
export function batchFailureMessage(diagnostic,transport='Batch') {
  const code=diagnostic?.code||diagnostic?.type||'unknown_error';
  const guidance={
    context_length_exceeded:'The context exceeds the model window. Use a shorter brief with GitHub links.',
    insufficient_quota:'Check the OpenAI project budget and billing before retrying.',
    billing_hard_limit_reached:'Check the OpenAI project budget and billing before retrying.',
    invalid_api_key:'Check the OpenAI API credential.',
    resource_unavailable:'Flex capacity is temporarily unavailable; the service tier was not changed.',
    rate_limit_exceeded:'The API rate limit was reached.',
  }[code]||`See the private ${transport} receipt for details.`;
  return `GitHub ${transport} curation held (${code}${diagnostic?.status?`, HTTP ${diagnostic.status}`:''}). ${guidance}`;
}
export function failedBatchRow(row) {return Boolean(row?.error)||row?.response?.status_code!==200;}
export function batchRowDiagnostic(row) {
  return batchDiagnostic(row?.error||row?.response?.body?.error||{}, {customId:row?.custom_id??null,status:row?.response?.status_code});
}
