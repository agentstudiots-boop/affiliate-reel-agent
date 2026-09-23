export type HumanIntent={intent:"APPROVE"|"REJECT"|"REVISION_REQUEST"|"APPROVE_ONCE"|"APPROVE_PERMANENTLY"|"CLARIFY";target:string|null;instruction:string;approval:boolean};
const has=(value:string,pattern:RegExp)=>pattern.test(value);
export function interpretGermanMessage(raw:string,contextKind:"RENDER_COST"|"CONTENT_PUBLISH"|"CAPABILITY_PROPOSAL"):HumanIntent{
  const text=raw.trim(),value=text.toLocaleLowerCase("de-DE");
  if(!text)return {intent:"CLARIFY",target:null,instruction:"Leere Nachricht",approval:false};
  const reject=has(value,/\b(ablehnen|abgelehnt|verwerfen|stopp|stoppen)\b|nicht\s+(veröffentlichen|produzieren|freigeben)|lohnt sich nicht/);
  if(reject)return {intent:"REJECT",target:null,instruction:text,approval:false};
  const target=has(value,/caption|beschreibung/)?"caption":has(value,/hook|einstieg/)?"hook":has(value,/cta/)?"cta":has(value,/storyboard|motion|runway|renderer/)?"renderer":has(value,/cent|euro|€|teuer|kosten|budget/)?"budget":has(value,/video/)?"video":null;
  const revision=!!target || has(value,/\b(änder|aender|neu(er|en)? entwurf|zweite variante|direkter|kürzer|kuerzer|weniger werblich|statt)\b/);
  if(revision)return {intent:"REVISION_REQUEST",target,instruction:text,approval:false};
  const approve=has(value,/\b(freigeben|freigegeben|genehmigen|genehmigt|zustimmen|passt|okay|ok)\b/);
  if(approve&&contextKind==="CAPABILITY_PROPOSAL"&&has(value,/dauerhaft|permanent|immer/))return {intent:"APPROVE_PERMANENTLY",target:null,instruction:text,approval:true};
  if(approve&&contextKind==="CAPABILITY_PROPOSAL")return {intent:"APPROVE_ONCE",target:null,instruction:text,approval:true};
  if(approve)return {intent:"APPROVE",target:null,instruction:text,approval:true};
  return {intent:"CLARIFY",target:null,instruction:text,approval:false};
}
