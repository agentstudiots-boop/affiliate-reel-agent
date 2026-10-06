import { capabilityOf } from "../../capabilities";
import { facebookPageGraph } from "../../meta/facebook-page";
import { InstagramPublishFailure, instagramGraph } from "../../meta/instagram-publisher";
import { FacebookPublishFailure, publishFacebookPhoto } from "../../meta/publisher";
import { PlatformPublishError, type PlatformPublisher, type RemoteStatus } from "../publish";
import { assetOf, jpegCopy, sleep as defaultSleep, type MediaDeps } from "./media";

// Instagram and Facebook publishers. They reuse the existing Meta infrastructure (connection check, page token,
// graph helpers, failure types) instead of a parallel client.

type InstagramGraph = Awaited<ReturnType<typeof instagramGraph>>;
type FacebookGraph = Awaited<ReturnType<typeof facebookPageGraph>>;
const missingOf = (id: string) => { const capability = capabilityOf(id); return { ok: capability.missing.length === 0, missing: capability.missing }; };

// Nothing is visible before the final publish call (containers, unpublished photos): failures there are definite.
// The final call itself is definite only on a 4xx rejection; network errors and 5xx there are unknown.
const finalDefinite = (httpStatus: number) => httpStatus >= 400 && httpStatus < 500;
function instagramError(error: unknown, beforePublish: boolean): PlatformPublishError {
  if (error instanceof PlatformPublishError) return error;
  if (error instanceof InstagramPublishFailure) {
    return new PlatformPublishError(beforePublish || error.phase === "connection" || finalDefinite(error.httpStatus), `${error.phase}:${error.detail}${error.code ? ` code ${error.code}` : ""}`, error.httpStatus);
  }
  return new PlatformPublishError(beforePublish, "Ergebnis unklar");
}
function facebookError(error: unknown, beforePublish: boolean): PlatformPublishError {
  if (error instanceof PlatformPublishError) return error;
  if (error instanceof FacebookPublishFailure) {
    return new PlatformPublishError(beforePublish || error.phase === "image" || error.phase === "connection" || finalDefinite(error.httpStatus), `${error.phase}:${error.detail}`, error.httpStatus);
  }
  return new PlatformPublishError(beforePublish, "Ergebnis unklar");
}

export type InstagramDeps = MediaDeps & { graph?: () => Promise<InstagramGraph>; sleep?: (ms: number) => Promise<void>; pollAttempts?: number; pollIntervalMs?: number };

export function instagramPublisher(deps: InstagramDeps = {}): PlatformPublisher {
  const graph = deps.graph ?? (() => instagramGraph());
  const wait = deps.sleep ?? defaultSleep;
  async function untilFinished(api: InstagramGraph, containerId: string): Promise<"FINISHED" | "PROCESSING"> {
    for (let attempt = 0; attempt < (deps.pollAttempts ?? 10); attempt++) {
      const state = await api.status(containerId);
      if (state === "FINISHED") return state;
      if (state === "ERROR") throw new InstagramPublishFailure("status", "container_error", 400);
      await wait(deps.pollIntervalMs ?? 5000);
    }
    return "PROCESSING";
  }
  async function finish(api: InstagramGraph, containerId: string) {
    let mediaId: string;
    try { mediaId = await api.publish(containerId); }
    catch (error) { throw instagramError(error, false); }
    let url: string | null = null;
    try { url = await api.permalink(mediaId); } catch { /* published; link optional */ }
    return { state: "published" as const, externalId: mediaId, url };
  }
  return {
    platform: "instagram",
    configured: () => missingOf("instagram"),
    supports: variant => ["image", "carousel", "reel"].includes(variant.mediaFormat) && variant.assetRefs.length > 0,
    async publish(variant, master, context) {
      // 1. Upload/prepare: JPEG copies and containers. Nothing is visible yet; errors here are definite.
      let api: InstagramGraph, containerId: string;
      try {
        api = await graph();
        if (variant.mediaFormat === "reel") {
          const video = assetOf(master, variant.assetRefs[0]);
          if (!video?.url) throw new PlatformPublishError(true, "Video fehlt");
          containerId = await api.createTopicReel(video.url, variant.text);
        } else if (variant.mediaFormat === "carousel" && variant.assetRefs.length >= 2) {
          const children: string[] = [];
          for (const role of variant.assetRefs.slice(0, 10)) children.push(await api.createTopicImage(await jpegCopy(master, role, deps), "", true));
          for (const child of children) if (await untilFinished(api, child) !== "FINISHED") throw new PlatformPublishError(true, "Karussell-Element wird nicht fertig");
          containerId = await api.createTopicCarousel(children, variant.text);
        } else {
          containerId = await api.createTopicImage(await jpegCopy(master, variant.assetRefs[0], deps), variant.text);
        }
        await context.onRemoteId(`container:${containerId}`);
      } catch (error) { throw instagramError(error, true); }
      // 2. Wait for processing (reels can take minutes). Still processing → hand over to status() later, no second container.
      try { if (await untilFinished(api, containerId) !== "FINISHED") return { state: "processing", externalId: `container:${containerId}`, url: null }; }
      catch (error) { throw instagramError(error, true); }
      // 3. Publish exactly once.
      return finish(api, containerId);
    },
    async status(remoteId): Promise<RemoteStatus> {
      const api = await graph();
      if (remoteId.startsWith("container:")) {
        const containerId = remoteId.slice("container:".length);
        const state = await api.status(containerId);
        if (state === "ERROR") return { state: "failed", detail: "container_error" };
        if (state === "PROCESSING") return { state: "processing" };
        const done = await finish(api, containerId);
        return { state: "published", externalId: done.externalId, url: done.url };
      }
      return { state: "published", externalId: remoteId, url: await api.permalink(remoteId).catch(() => null) };
    },
  };
}

export type FacebookDeps = { graph?: () => Promise<FacebookGraph>; photo?: typeof publishFacebookPhoto };

export function facebookPublisher(deps: FacebookDeps = {}): PlatformPublisher {
  const graph = deps.graph ?? (() => facebookPageGraph());
  const photo = deps.photo ?? publishFacebookPhoto;
  return {
    platform: "facebook",
    configured: () => missingOf("facebook"),
    supports: variant => ["text", "image", "album", "video"].includes(variant.mediaFormat),
    async publish(variant, master, context) {
      if (variant.mediaFormat === "image") {
        const asset = assetOf(master, variant.assetRefs[0]);
        if (!asset?.url) throw new PlatformPublishError(true, "Bild fehlt");
        try { const posted = await photo(asset.url, variant.text); return { state: "published", externalId: posted.id, url: posted.permalink }; }
        catch (error) { throw facebookError(error, false); }
      }
      let api: FacebookGraph;
      try { api = await graph(); } catch (error) { throw facebookError(error, true); }
      if (variant.mediaFormat === "album") {
        const ids: string[] = [];
        try {
          for (const role of variant.assetRefs.slice(0, 10)) {
            const asset = assetOf(master, role);
            if (!asset?.url) throw new PlatformPublishError(true, `Bild ${role} fehlt`);
            const id = await api.uploadUnpublishedPhoto(asset.url);
            ids.push(id);
            await context.onRemoteId(`photo:${id}`);
          }
        } catch (error) { throw facebookError(error, true); }
        try { const posted = await api.albumPost(variant.text, ids); return { state: "published", externalId: posted.id, url: posted.permalink }; }
        catch (error) { throw facebookError(error, false); }
      }
      try {
        if (variant.mediaFormat === "video") {
          const asset = assetOf(master, variant.assetRefs[0]);
          if (!asset?.url) throw new PlatformPublishError(true, "Video fehlt");
          const posted = await api.videoPost(asset.url, variant.text);
          return { state: "published", externalId: posted.id, url: posted.permalink };
        }
        const posted = await api.textPost(variant.text, variant.links[0] ?? null);
        return { state: "published", externalId: posted.id, url: posted.permalink };
      } catch (error) { throw facebookError(error, false); }
    },
  };
}
