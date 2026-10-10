import { createHash } from "node:crypto";
import { put } from "../security/guarded-blob";
import type { GeneratedAsset } from "./types";

// Text graphics are rendered locally as SVG; platforms need raster images. Live production converts them to PNG
// (sharp, already a dependency) and stores them in the Blob store. Dry runs never call this.
export type Rasterizer = (asset: GeneratedAsset, contentId: string, role: string) => Promise<GeneratedAsset>;

export function blobRasterizer(deps: { upload?: typeof put; toPng?: (svg: string) => Promise<Buffer> } = {}): Rasterizer {
  return async (asset, contentId, role) => {
    if (asset.kind !== "text_graphic" || !asset.svg || asset.url) return asset;
    const toPng = deps.toPng ?? (async (svg: string) => { const sharp = (await import("sharp")).default; return sharp(Buffer.from(svg)).png().toBuffer(); });
    const png = await toPng(asset.svg);
    const sha256 = createHash("sha256").update(png).digest("hex");
    const blob = await (deps.upload ?? put)(`generated/topics/${contentId.replace(/[^a-zA-Z0-9_-]/g, "")}/${role}-${sha256}.png`, png, { access: "public", addRandomSuffix: false, contentType: "image/png" });
    return { ...asset, url: blob.url, sha256, mediaType: "image/png", svg: undefined };
  };
}
