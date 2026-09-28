import type { ContentJob } from "../content/schema";

// The first approval and the later publication request must display the same
// public copy. The disclosure follows a natural opening line.
export function facebookCaption(job: ContentJob): string {
  if (!job.content || job.content.format === "video") throw new Error("Bild- oder Textentwurf fehlt.");
  let source: URL;
  try { source = new URL(job.opportunity.product.affiliateUrl); }
  catch { throw new Error("Affiliate-Link fehlt."); }
  if (source.protocol !== "https:" || source.username || source.password) throw new Error("Affiliate-Link ist nicht sicher.");
  const base = job.content.format === "text" ? job.content.body : job.content.caption;
  const lead = job.content.hook.trim().replace(/^Werbung\s*(?:\|\s*Affiliate-Link)?\s*[|:·–-]?\s*/i, "").trim();
  if (!lead || /^Werbung\b/i.test(lead)) throw new Error("Für den Beitrag fehlt ein natürlicher Einstieg.");
  const body = base.trim().replace(/^Werbung\s*(?:\|\s*Affiliate-Link)?\s*[|:·–-]?\s*/i, "").trim();
  const detail = body.startsWith(lead) ? body.slice(lead.length).trim() : body;
  return `${lead}\nWerbung | Affiliate-Link\nProdukt direkt ansehen: ${source}\n\n${detail}\n\n${job.content.cta}`;
}
