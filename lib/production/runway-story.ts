import { head, put } from "@vercel/blob";
import { assertEffectAllowed } from "../security/runtime-guard";
import type { ContentJob } from "../content/schema";
import { getRunwayClient, RUNWAY_DURATION_SECONDS, RUNWAY_ESTIMATED_CREDITS, RUNWAY_MODEL, RUNWAY_RATIO } from "../runway";

export function runwayPrompt(job: ContentJob) {
  if (job.status !== "approved" || job.content?.format !== "video" || job.content.durationSeconds !== 30) throw new Error("Ein freigegebenes 30-Sekunden-Drehbuch fehlt.");
  const outline = job.content.scenes.map((scene, i) => `${i + 1}. ${scene.visual} (${scene.durationSeconds} Sekunden). Gesprochener Text: ${scene.audio}. Sichtbare Einblendung: ${scene.overlay || "keine"}`).join("\n");
  return `Vertikales 30-Sekunden-Video als zusammenhängende Geschichte. Ein optionales Referenzbild zeigt nur die Atmosphäre und Ausgangssituation, nicht zwingend das beworbene Produkt. Geschichte und sichtbare Handlungen haben Vorrang vor einer Produktaufnahme. Hook: ${job.content.hook}. Trendkontext: ${job.opportunity.trend}. Kategorie: ${job.opportunity.category}. Gezeigte Anwendung: ${job.opportunity.useCase}. Produktrolle: ${job.content.productIntegration}. Zeige nur eine neutrale Produktkategorie, falls konkrete Modellmerkmale nicht belegt sind; keine erfundenen Eigenschaften oder Markenlogos. Kinder dürfen beim Kürbisschnitzen zeichnen und ausschöpfen; Schneidwerkzeuge führt eine erwachsene Person. Sprich natürliches Deutsch in ruhigem Tempo: kurze Sätze, passende Pausen, keine Regieanweisungen, keine ausgesprochenen ASINs oder Webadressen. Die sichtbaren Einblendungen sind Vorgaben für die Abnahme; falls Schrift nicht zuverlässig erzeugt wird, vor Veröffentlichung im Videoschnitt einfügen. Die Schlussblende lautet „Mehr dazu: Produktinfos im Beitrag“ und darf keinen anklickbaren Button vortäuschen. Videobild, Szenenfolge, Sprache und Schlussblende müssen vor Veröffentlichung kontrolliert werden.\n${outline}`.slice(0, 3800);
}

export function runwaySceneBrief(job: ContentJob) {
  if (job.status !== "approved" || job.content?.format !== "video" || job.content.durationSeconds !== 30) throw new Error("Ein freigegebenes 30-Sekunden-Drehbuch fehlt.");
  const pumpkin = /(?:kürbis|kuerbis|pumpkin).{0,40}(?:schnitz|carving)|(?:schnitz|carving).{0,40}(?:kürbis|kuerbis|pumpkin)/i.test(job.opportunity.product.name);
  return [
    `Eigenständige, fotorealistische Hochformat-Szene als Startbild für die freigegebene Videogeschichte: ${job.content.hook}`,
    `Ausgangsszene: ${job.content.scenes[0]?.visual}. Trend und Jahreszeit: ${job.opportunity.trend}.`,
    pumpkin ? "Halloween-Bastelabend mit erkennbarem echten orangefarbenen Kürbis als Hauptmotiv, herbstlicher Atmosphäre und menschlicher Vorfreude. Neutrale kleine Schnitzwerkzeuge nur als Teil der Handlung. Ein Kind darf ein Gesicht vorzeichnen; eine erwachsene Person führt scharfe Werkzeuge." : `Alltagssituation und Anwendung: ${job.opportunity.useCase}. Ein menschlicher Moment und die Umgebung stehen im Mittelpunkt.`,
    "Kein Amazon- oder Händlerfoto kopieren oder als Vorlage benutzen. Keine Markenlogos, Verpackungen, eingebrannten Texte oder erfundenen Modellmerkmale. Dieses Bild ist ein Story-Startbild und kein Beleg für die konkrete Ausführung des verlinkten Produkts.",
  ].join("\n");
}

export function runwayStoryClient(client = getRunwayClient()) {
  return {
    async quote() {
      const balance = (await client.organization.retrieve()).creditBalance;
      if (!Number.isFinite(balance) || balance < 0) throw new Error("Runway-Guthaben nicht lesbar.");
      return { credits: RUNWAY_ESTIMATED_CREDITS, balance, durationSeconds: RUNWAY_DURATION_SECONDS, model: RUNWAY_MODEL, estimatedUsd: RUNWAY_ESTIMATED_CREDITS / 100 };
    },
    async create(job: ContentJob, imageUrl: string) {
      // SDK retries are disabled. A lost POST response may already have spent credits.
      const shared = {model:RUNWAY_MODEL, promptText:runwayPrompt(job), ratio:RUNWAY_RATIO, duration:RUNWAY_DURATION_SECONDS, audio:true} as const;
      const task = imageUrl
        ? await client.imageToVideo.create({...shared,promptImage:[{uri:imageUrl}]})
        : await client.textToVideo.create(shared);
      return { id: task.id };
    },
    async status(id: string) { return client.tasks.retrieve(id); },
    async archive(id: string, url: string) {
      const pathname=`reels/${id}.mp4`;
      try { const existing=await head(pathname); return existing.url; } catch { /* First archive attempt. */ }
      const source = await fetch(url);
      if (!source.ok || !source.body) throw new Error("Runway-MP4 ist nicht abrufbar; keinen zweiten Videostart auslösen.");
      assertEffectAllowed("storage_write");
      const blob = await put(pathname,source.body,{access:"public",addRandomSuffix:false,allowOverwrite:false,contentType:"video/mp4"});
      return blob.url;
    },
  };
}
