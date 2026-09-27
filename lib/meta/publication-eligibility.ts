import { jobProductError } from "../content/product-contract";
import type { ContentJob } from "../content/schema";
import { imageCreativePublicationError } from "../content/creative-quality";
import { pumpkinCreativeIssues } from "../content/category";

export function facebookPagePublicationError(job: ContentJob): string | null {
  const productError = jobProductError(job);
  if (productError) return productError;
  if (job.status !== "approved") return "Dieser Content-Plan ist noch nicht freigegeben.";
  if (!job.content || !["image", "text"].includes(job.content.format)) return "Für diesen Job liegt kein freigegebener Bild- oder Textentwurf vor.";
  if (job.content.format === "image") {
    const creativeError = imageCreativePublicationError(job.content);
    if (creativeError) return creativeError;
    const pumpkinError = pumpkinCreativeIssues(job.opportunity,job.content,job.marketing)[0];
    if (pumpkinError) return pumpkinError;
  }
  if (job.opportunity.targetPlatform !== "facebook") return "Dieser Job wurde nicht für Facebook geplant. Lege für einen Seitenbeitrag einen neuen Plan mit Zielplattform Facebook an und gib ihn frei.";
  if (job.marketing?.primary !== "Facebook Post") return `Dieser Job ist als „${job.marketing?.primary || "ohne Marketingplan"}“ geplant. Für eine Facebook-Seite brauchst du einen neuen Plan mit Zielplattform Facebook und Ziel „Kaufinteresse“ oder „Erklären & informieren“. Gib diesen Plan anschließend frei.`;
  return null;
}
