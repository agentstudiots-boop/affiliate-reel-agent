export const MAX_VIDEO_PROMPT_LENGTH = 1000;

function clip(text: string, max: number) {
  // Iterate code points so truncation never splits an emoji/surrogate pair;
  // count UTF-16 units conservatively for the provider's string validator.
  let result = "";
  for (const character of text) {
    if (result.length + character.length > max) break;
    result += character;
  }
  return result.trimEnd();
}

export function buildVideoPrompt(productName: string, visual: string) {
  const name = clip(productName.replace(/\s+/g, " ").trim(), 160);
  const prefix = `Vertical generic lifestyle advertisement for ${name}. `;
  const suffix = " Original unbranded visualization, not an Amazon listing or exact manufacturer model. Natural realistic motion, clean lighting. No text, logos, packaging, people, prices, medical or unsupported claims.";
  const available = MAX_VIDEO_PROMPT_LENGTH - prefix.length - suffix.length;
  return prefix + clip(visual.replace(/\s+/g, " ").trim(), available) + suffix;
}
