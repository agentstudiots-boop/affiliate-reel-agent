import type {ContentJob} from '../content/schema';
type Candidate={id:string;job:ContentJob};
type Previous={body:string;job_id?:unknown};
const words=(text:string):string[]=>text.toLocaleLowerCase('de-DE').match(/[\p{L}\p{N}]+/gu)||[];

// Resolve only among existing eligible jobs; no new product or identity is created.
function matches(body:string,candidates:Candidate[]) {
  const text=body.toLocaleLowerCase('de-DE'),tokens=words(body);
  const exact=candidates.filter(c=>text.includes(c.id.toLowerCase()) || (!!c.job.opportunity.product.asin && text.includes(c.job.opportunity.product.asin.toLowerCase())));
  if(exact.length)return exact;
  return candidates.filter(c=>words(c.job.opportunity.product.name).some(word=>word.length>=6
    && candidates.filter(other=>words(other.job.opportunity.product.name).includes(word)).length===1
    && tokens.some(token=>token===word || token.startsWith(word))));
}
export function resolveInstructionTarget(body:string,candidates:Candidate[],history:Previous[],hasCompetingFlow:boolean) {
  const direct=matches(body,candidates);
  if(direct.length)return direct.length===1?direct[0].id:null;
  for(const previous of history){
    if(previous.job_id)return candidates.some(c=>c.id===previous.job_id)?String(previous.job_id):null;
    const contextual=matches(previous.body,candidates);
    if(contextual.length)return contextual.length===1?contextual[0].id:null;
  }
  return candidates.length===1&&!hasCompetingFlow?candidates[0].id:null;
}
