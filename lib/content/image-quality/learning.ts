import type { Sql } from "../../memory/db";
import type { QualityResult } from "./gate";
import type { FeedbackItem, IssueCode } from "./feedback";
import { removedObjects, type ImageSpec } from "./spec";

// Long-term learning of the image quality system in the existing PostgreSQL memory (no extra database, no extra agent,
// no model call). Every assessed attempt is stored as a structured experience; before a new briefing, only relevant and
// sufficiently confirmed experience is turned into fixed guidance templates — never a copy of an old prompt.
//
// Safeguards against learning the wrong thing:
// - an automatic finding counts only if its cause is "likely"; uncertain causes are stored but never build a rule;
// - human decisions (rejection or change request on the publication approval) weigh double;
// - a rule needs a score of at least 3 from at least 2 different jobs, and either a successful correction or human evidence;
// - experience of the same product type applies fully, of the same category only for "product must dominate";
// - experience only adds guidance and exclusions; the product-specific briefing always wins.

export const PROMPT_VERSION = "flux-compact-v2";
const MIN_SCORE = 3, MIN_JOBS = 2, WINDOW_DAYS = 180;

export type Lessons = { guidance: string[]; forbidden: string[]; dominant: boolean; rules: { key: string; score: number; jobs: number }[] };

export async function recordExperience(db: Sql, input: { jobId: string; attemptNo: number; category: string; spec: ImageSpec; promptSha: string; imageUrl: string | null;
  quality: QualityResult; feedback: FeedbackItem[]; correction: FeedbackItem[] | null; generations: number; costUsd: number | null }) {
  const outcome = input.quality.findings.technical ? "technical" : input.quality.approved ? "passed" : input.quality.uncertain ? "uncertain" : "failed";
  const spec = { primary_object: input.spec.primary_object, product_type: input.spec.product_type, prominence: input.spec.primary_object_prominence,
    forbidden: input.spec.forbidden_objects, composition: input.spec.composition, identity_class: input.spec.identity_class, guidance: input.spec.learned_guidance };
  await db.query(`INSERT INTO image_quality_experiences(job_id,attempt_no,category,product_type,content_format,spec,prompt_version,prompt_sha256,image_url,outcome,issues,correction,correction_result,generations,cost_usd)
    VALUES($1,$2,$3,$4,'affiliate_image',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT DO NOTHING`,
    [input.jobId, input.attemptNo, input.category.slice(0, 40), (input.spec.product_type || "unbekannt").slice(0, 80), JSON.stringify(spec), PROMPT_VERSION, input.promptSha, input.imageUrl, outcome,
      JSON.stringify(input.feedback.map(item => ({ code: item.code, object: item.object ?? null, cause: item.cause, certainty: item.certainty }))),
      input.correction ? JSON.stringify(input.correction.map(item => ({ code: item.code, object: item.object ?? null, correction: item.correction }))) : null,
      input.correction ? (outcome === "passed" ? "success" : "failure") : null, input.generations, input.costUsd]);
}

const GENERAL: IssueCode[] = ["primary_missing", "primary_not_dominant"];
const PROMINENCE = /größer|vordergrund|kaum (?:zu )?(?:sehen|erkennen)|nicht (?:zu )?erkennen|zu klein|sichtbarer|im mittelpunkt|dominant/i;

// Human feedback on the publication approval, translated into the same issue keys.
function humanIssues(feedback: string, spec: { primary_object?: string }): string[] {
  const keys = removedObjects(feedback).map(object => `forbidden_object:${object}`);
  if (PROMINENCE.test(feedback) || (spec.primary_object && /fehlt|nicht drauf|nicht zu sehen/i.test(feedback))) keys.push("primary_not_dominant");
  return keys;
}

export async function lessonsFor(db: Sql, input: { category: string; productType: string }): Promise<Lessons> {
  const rows = (await db.query(`SELECT e.job_id,e.product_type,e.category,e.issues,e.correction,e.correction_result,e.spec,r.status AS human_status,r.feedback AS human_feedback
    FROM image_quality_experiences e
    LEFT JOIN LATERAL (SELECT status,feedback FROM publication_requests p WHERE p.job_id=e.job_id AND p.image_url=e.image_url ORDER BY revision DESC LIMIT 1) r ON true
    WHERE e.created_at>now()-make_interval(days => $3::int) AND (e.product_type=$1 OR e.category=$2)
    ORDER BY e.created_at DESC LIMIT 300`, [input.productType || "unbekannt", input.category, WINDOW_DAYS])).rows;
  const stats = new Map<string, { score: number; jobs: Set<string>; success: number; human: number }>();
  const add = (key: string, weight: number, job: string, human = false) => {
    const entry = stats.get(key) ?? { score: 0, jobs: new Set<string>(), success: 0, human: 0 };
    entry.score += weight; entry.jobs.add(job); if (human) entry.human += weight; stats.set(key, entry);
  };
  for (const row of rows) {
    const sameType = row.product_type === (input.productType || "unbekannt");
    const job = String(row.job_id);
    for (const issue of (row.issues as { code: IssueCode; object: string | null; certainty: string }[])) {
      if (!sameType && !GENERAL.includes(issue.code)) continue;
      if (issue.certainty !== "likely") continue; // uncertain causes never build rules
      add(issue.object ? `${issue.code}:${issue.object}` : issue.code, sameType ? 1 : 0.5, job);
    }
    if (row.correction_result === "success") for (const item of (row.correction as { code: string; object: string | null }[] ?? [])) {
      const key = item.object ? `${item.code}:${item.object}` : item.code;
      const entry = stats.get(key) ?? { score: 0, jobs: new Set<string>(), success: 0, human: 0 };
      entry.success++; stats.set(key, entry);
    }
    if (["rejected", "changes_requested"].includes(String(row.human_status ?? "")) && row.human_feedback)
      for (const key of humanIssues(String(row.human_feedback), row.spec as { primary_object?: string })) if (sameType || GENERAL.includes(key as IssueCode)) add(key, sameType ? 2 : 1, job, true);
  }
  const rules = [...stats.entries()].filter(([, entry]) => entry.score >= MIN_SCORE && entry.jobs.size >= MIN_JOBS && (entry.success > 0 || entry.human >= 2))
    .map(([key, entry]) => ({ key, score: entry.score, jobs: entry.jobs.size }));
  const guidance = new Set<string>(), forbidden = new Set<string>();
  let dominant = false;
  for (const { key } of rules) {
    if (key === "primary_missing" || key === "primary_not_dominant") { dominant = true; guidance.add("Erfahrung: Nahaufnahme wählen; das Produkt ist das größte, schärfste Objekt im Bild."); }
    else if (key.startsWith("forbidden_object:")) forbidden.add(key.slice("forbidden_object:".length));
    else if (key === "defects" || key === "unrealistic_use") guidance.add("Erfahrung: einfache, realistische Formen und ein ruhiger Bildaufbau.");
    else if (key === "wrong_product") guidance.add("Erfahrung: die Produktart eindeutig in ihrer typischen Form zeigen.");
  }
  return { guidance: [...guidance].slice(0, 3), forbidden: [...forbidden].slice(0, 6), dominant, rules };
}
