import { createHash } from "node:crypto";
import type { StyleBrief } from "./style";
import type { GeneratedAsset } from "./types";

// Local, deterministic text graphic (SVG, 1080×1350) for slides that do not need a generated picture.
// No provider, no cost. The orchestrator may rasterize/upload it later; in dry-run it stays an SVG.

const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function wrap(text: string, maxChars: number, maxLines: number) {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if ((line ? `${line} ${word}` : word).length > maxChars && line) { lines.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && text.split(/\s+/).join(" ").length > lines.join(" ").length) lines[maxLines - 1] = `${lines[maxLines - 1].replace(/[\s.,;:!?]+$/, "")}…`;
  return lines;
}

export function renderTextGraphic(input: { headline: string; text?: string; slide?: { number: number; total: number }; style: StyleBrief; variant?: "text" | "cta" | "icon" }): GeneratedAsset {
  const { palette } = input.style;
  const headline = wrap(input.headline, 22, 4);
  const body = input.text ? wrap(input.text, 38, 6) : [];
  const head = headline.map((line, index) => `<text x="96" y="${300 + index * 92}" font-size="76" font-weight="700">${escape(line)}</text>`).join("");
  const top = 300 + headline.length * 92 + 60;
  const copy = body.map((line, index) => `<text x="96" y="${top + index * 58}" font-size="44">${escape(line)}</text>`).join("");
  const number = input.slide ? `<text x="984" y="1270" font-size="34" text-anchor="end">${input.slide.number}/${input.slide.total}</text>` : "";
  const accent = input.variant === "cta" ? `<rect x="96" y="1080" width="888" height="110" rx="24" fill="${palette.accent}"/>` : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350"><rect width="1080" height="1350" fill="${palette.background}"/>`
    + `<rect x="96" y="160" width="140" height="14" rx="7" fill="${palette.accent}"/>${accent}<g font-family="Inter, Helvetica, Arial, sans-serif" fill="${palette.text}">${head}${copy}${number}</g></svg>`;
  return { kind: "text_graphic", url: null, sha256: createHash("sha256").update(svg).digest("hex"), mediaType: "image/svg+xml", provider: "local_svg", svg, width: 1080, height: 1350 };
}
