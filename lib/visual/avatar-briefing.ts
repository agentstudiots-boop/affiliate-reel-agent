import { z } from "zod";
import type { ContentJob } from "../content/schema";

// Production briefing for an avatar product video with the brand avatar "Mia" (HeyGen). Built deterministically by Jarvis
// from an APPROVED video job: the script, scenes and product facts come from the existing video agent and the verified
// Amazon product page – nothing is invented here. Spoken text, movement/gesture directions, scene descriptions and product
// references are separate structured fields so that each can be checked and later mapped onto the provider's API.
//
// No network, no provider call, no cost. Rendering stays behind HEYGEN_ENABLED, the monthly limit and the explicit
// WhatsApp cost approval (lib/visual/avatar-preflight.ts lists what is still missing).

export const MIA = {
  name: "Mia",
  role: "Markenavatar von „Alltäglich leichter“",
  appearance: "freundliche, natürliche Frau Anfang 30, gepflegt und alltagsnah, kein Studio-Glamour",
  wardrobe: "schlichte, helle Alltagskleidung ohne Logos",
  voice: "deutsche Stimme, warm, ruhig, deutlich, natürliches Sprechtempo",
  demeanor: "erklärt wie eine Freundin: ehrlich, ohne Übertreibung, ohne Verkaufsdruck",
} as const;

export type ProductInteraction = "hold_in_hand" | "show_next_to" | "cutaway_product_shot" | "none";

export const productReferenceSchema = z.object({
  url: z.string().url(),
  // Only images the operator uploaded with confirmed usage rights (no Amazon catalogue images: the Associates licence does
  // not cover using them as input for generated video).
  source: z.literal("operator_upload"),
  rightsConfirmed: z.literal(true),
  view: z.enum(["front", "side", "detail", "in_use", "packaging"]),
});
export type ProductReference = z.infer<typeof productReferenceSchema>;

const line = z.string().min(1).max(600);
export const avatarSceneSchema = z.object({
  index: z.number().int().min(1),
  durationSeconds: z.number().int().min(2).max(15),
  spokenText: line,                       // exactly what Mia says (lip sync)
  sceneDescription: line,                 // what the picture shows (setting, situation)
  camera: z.enum(["medium_close_up", "close_up", "product_close_up", "medium_shot"]),
  gesture: z.string().max(300),           // movement/gesture/mimic direction for Mia
  productInteraction: z.enum(["hold_in_hand", "show_next_to", "cutaway_product_shot", "none"]),
  closeUp: z.string().max(300).nullable(), // desired close-up of a real product detail, null if none
  subtitle: z.string().max(120),          // on-screen subtitle / overlay
});
export type AvatarScene = z.infer<typeof avatarSceneSchema>;

export const avatarBriefingSchema = z.object({
  version: z.literal(1),
  jobId: z.string().uuid(),
  product: z.object({ name: z.string().min(2), asin: z.string().nullable(), verifiedFacts: z.array(z.string()).max(12), detailPageUrl: z.string().url().nullable() }).strict(),
  audience: z.string().min(3),
  goal: z.string().min(3),
  hook: z.string().min(5),
  avatar: z.object({ name: z.literal("Mia"), role: z.string(), appearance: z.string(), wardrobe: z.string(), voice: z.string(), demeanor: z.string() }).strict(),
  look: z.object({ lighting: z.string(), background: z.string() }).strict(),
  scenes: z.array(avatarSceneSchema).min(2).max(8),
  callToAction: z.string().min(3),
  disclosure: z.string().min(5),
  durationSeconds: z.number().int().min(10).max(60),
  aspectRatio: z.literal("9:16"),
  productReferences: z.array(productReferenceSchema).max(5),
  quality: z.array(z.string()).min(3),
  limits: z.array(z.string()),
}).strict();
export type AvatarBriefing = z.infer<typeof avatarBriefingSchema>;

// Handheld only for small, light product types where holding them looks plausible; big appliances are shown next to Mia
// or as a separate product shot. Without a real reference image the product is never "held" (it would be invented).
const HANDHELD = /(buerste|bürste|reibe|schaeler|schäler|schere|flasche|dose|box|tube|creme|clip|lampe|kerze|zange|loeffel|löffel|messbecher|organizer|abzieher|gadget|lichterkette|backform|spiel|karten|deko)/i;
export function interactionFor(productName: string, references: ProductReference[], sceneIndex: number, sceneCount: number): ProductInteraction {
  if (!references.length) return sceneIndex === 1 || sceneIndex === sceneCount ? "none" : "cutaway_product_shot";
  if (HANDHELD.test(productName)) return sceneIndex === 1 ? "show_next_to" : "hold_in_hand";
  return sceneIndex === 1 ? "none" : "show_next_to";
}

const CAMERA: AvatarScene["camera"][] = ["medium_close_up", "close_up", "product_close_up", "medium_shot"];
const DISCLOSURE = "Werbung · Affiliate-Link: Bei einem Kauf über den Link erhalten wir eine Provision.";

export type BriefingResult = { ok: true; briefing: AvatarBriefing } | { ok: false; errors: string[] };

export function buildAvatarBriefing(job: ContentJob, references: ProductReference[] = []): BriefingResult {
  const errors: string[] = [];
  if (job.status !== "approved") errors.push("Nur ein inhaltlich freigegebener Video-Entwurf wird zum Produktionsbriefing.");
  const content = job.content;
  if (!content || content.format !== "video") return { ok: false, errors: [...errors, "Kein Video-Drehbuch im Auftrag."] };
  const product = job.opportunity.product;
  if (!product.productVerifiedAt) errors.push("Produkt ist nicht über die Amazon-Detailseite verifiziert.");
  const refs = references.filter(item => productReferenceSchema.safeParse(item).success);
  if (refs.length !== references.length) errors.push("Mindestens ein Produktbild ohne bestätigte Nutzungsrechte wurde verworfen.");
  // Only facts with a source (opportunity.verifiedFacts); the source travels with the claim.
  const facts = job.opportunity.verifiedFacts.map(item => `${item.claim} (Quelle: ${item.source})`).slice(0, 12);
  const scenes: AvatarScene[] = content.scenes.map((scene, index) => {
    const interaction = interactionFor(product.name, refs, index + 1, content.scenes.length);
    return {
      index: index + 1,
      durationSeconds: scene.durationSeconds,
      spokenText: scene.audio.trim(),
      sceneDescription: scene.visual.trim(),
      camera: interaction === "cutaway_product_shot" ? "product_close_up" : CAMERA[index % 2],
      gesture: index === 0 ? "Blick in die Kamera, offenes Lächeln, kurze einladende Handbewegung" : interaction === "hold_in_hand"
        ? "Produkt ruhig auf Brusthöhe halten, Vorderseite zur Kamera, mit der freien Hand auf das gezeigte Detail deuten"
        : "natürliche, ruhige Handgesten passend zum Satz; keine übertriebene Mimik",
      productInteraction: interaction,
      closeUp: interaction === "none" ? null : refs.length ? `Echte Produktansicht (${refs[0].view}) – nur sichtbare Merkmale, keine erfundenen Bedienelemente` : null,
      subtitle: scene.overlay.trim().slice(0, 120),
    };
  });
  const duration = scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0);
  if (!job.marketing) errors.push("Marketing-Empfehlung (Plattform/CTA) fehlt.");
  if (errors.length) return { ok: false, errors };
  const briefing: AvatarBriefing = {
    version: 1, jobId: job.id,
    product: { name: product.name, asin: product.asin ?? null, verifiedFacts: facts, detailPageUrl: product.productUrl || product.sourceUrl || null },
    audience: product.targetGroup || job.marketing!.audience,
    goal: `${job.opportunity.goal}: ${job.opportunity.useCase}`.slice(0, 300),
    hook: content.scenes[0].audio.trim(),
    avatar: { ...MIA },
    look: { lighting: "weiches Tageslicht von der Seite, keine harten Schatten, natürliche Hauttöne",
      background: `aufgeräumte, reale Wohnumgebung passend zur Anwendung (${job.opportunity.category}); keine fremden Marken oder Logos` },
    scenes, callToAction: job.marketing!.linkPlacement, disclosure: DISCLOSURE, durationSeconds: duration, aspectRatio: "9:16",
    productReferences: refs,
    quality: [
      "Lippenbewegung synchron zum Sprechtext, natürliche Mimik ohne Verzerrungen",
      "Hände und Finger anatomisch korrekt; Produkt nicht verformt, richtige Proportionen und Bedienelemente",
      "Nur Merkmale zeigen oder nennen, die in verifiedFacts oder auf der Detailseite stehen",
      "Werbekennzeichnung im Bild oder in der Caption",
      "9:16, mindestens 1080 × 1920, klarer Ton ohne Rauschen",
    ],
    limits: [
      ...(refs.length ? [] : ["Ohne eigenes Produktbild mit Rechten wird das Produkt nicht in Mias Hand gezeigt (keine erfundene Produktdarstellung)."]),
      "Product Placement (Produkt in der Hand) ist laut HeyGen eine Funktion des Webstudios; ein API-Feld dafür ist nicht dokumentiert.",
    ],
  };
  const parsed = avatarBriefingSchema.safeParse(briefing);
  return parsed.success ? { ok: true, briefing: parsed.data } : { ok: false, errors: parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`) };
}

// Full spoken text for the provider and for the subtitle file.
export const spokenScript = (briefing: AvatarBriefing) => briefing.scenes.map(scene => scene.spokenText).join("\n\n");
