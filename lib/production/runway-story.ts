import { head, put } from "@vercel/blob";
import type { ContentJob } from "../content/schema";
import { getRunwayClient, RUNWAY_DURATION_SECONDS, RUNWAY_ESTIMATED_CREDITS, RUNWAY_MODEL, RUNWAY_RATIO } from "../runway";

export function runwayPrompt(job: ContentJob) {
  if (job.status !== "approved" || job.content?.format !== "video" || job.content.durationSeconds !== 30) throw new Error("Ein freigegebenes 30-Sekunden-Drehbuch fehlt.");
  const outline = job.content.scenes.map((scene, i) => `${i + 1}. ${scene.visual} (${scene.durationSeconds} Sekunden). Erzählertext: ${scene.audio}`).join("\n");
  return `Vertikales 30-Sekunden-Produktvideo als zusammenhängende Geschichte. Produkt: ${job.opportunity.product.name}. Kategorie: ${job.opportunity.category}. Gezeigte Anwendung: ${job.opportunity.useCase}. Verwende das Referenzbild als visuelle Orientierung für das Produkt; keine erfundenen Eigenschaften, Markenlogos oder eingebrannte Schrift. Jede Szene zeigt Produkt und Handlungen klar. Sprich die deutschen Erzählertexte in Szenenfolge, sofern sprachlich möglich; Inhalt und Bild müssen vor Veröffentlichung kontrolliert werden.\n${outline}`.slice(0, 3800);
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
      const task = await client.imageToVideo.create({model:RUNWAY_MODEL, promptImage:[{uri:imageUrl}], promptText:runwayPrompt(job), ratio:RUNWAY_RATIO, duration:RUNWAY_DURATION_SECONDS, audio:true});
      return { id: task.id };
    },
    async status(id: string) { return client.tasks.retrieve(id); },
    async archive(id: string, url: string) {
      const pathname=`reels/${id}.mp4`;
      try { const existing=await head(pathname); return existing.url; } catch { /* First archive attempt. */ }
      const source = await fetch(url);
      if (!source.ok || !source.body) throw new Error("Runway-MP4 ist nicht abrufbar; keinen zweiten Videostart auslösen.");
      const blob = await put(pathname,source.body,{access:"public",addRandomSuffix:false,allowOverwrite:false,contentType:"video/mp4"});
      return blob.url;
    },
  };
}
