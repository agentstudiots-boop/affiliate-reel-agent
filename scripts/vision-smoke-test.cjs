// Reproducible smoke test for the Image Quality Manager's vision model (audit P-03). It runs offline checks by default
// and NEVER spends money unless explicitly told to.
//
//   npx tsc -p tsconfig.test.json                        (compiles lib/ to .test-build)
//   node scripts/vision-smoke-test.cjs                   offline: configuration + failure-handling self-checks, no network
//   REPLICATE_API_TOKEN=... node scripts/vision-smoke-test.cjs --metadata   free GET: does the model exist, does it declare image_input?
//   REPLICATE_API_TOKEN=... VISION_SMOKE_APPROVED=1 node scripts/vision-smoke-test.cjs --live
//                                                        EXACTLY ONE paid vision call (≈ a few cents, max_completion_tokens 900)
//
// The live call sends a synthetic 64x64 image (a red square on white) and a briefing that demands a BLUE CIRCLE.
// A model that really looks at the image reports the red square and the gate must NOT approve it. A text-only or blind
// model cannot produce that answer. Secrets are never printed.
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const path = require('node:path');

const build = rel => require(path.resolve('.test-build', rel));
const { checkGeneratedImage, decide, replicateObserve, visionSchema, QUALITY_MODEL } = build('lib/content/image-quality/gate');
const { topicImageSpec } = build('lib/content/image-quality/spec');
const { ROUTER_MODEL } = build('lib/whatsapp/route-llm');

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` – ${detail}` : ''}`); };

// Minimal dependency-free RGB PNG encoder (deterministic). pixel(x, y) -> [r, g, b].
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const body = Buffer.concat([Buffer.from(type), data]); const out = Buffer.alloc(8 + data.length + 4); out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc(body), 8 + data.length); return out; };
function encodePng(width, height, pixel) {
  const rows = [];
  for (let y = 0; y < height; y++) { const row = Buffer.alloc(1 + width * 3); for (let x = 0; x < width; x++) row.set(pixel(x, y), 1 + x * 3); rows.push(row); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}
// 64x64: red 32x32 square centred on white (live call). 40x50 (4:5) grey: only for the offline technical check.
const syntheticPng = () => encodePng(64, 64, (x, y) => (x >= 16 && x < 48 && y >= 16 && y < 48 ? [220, 20, 20] : [255, 255, 255]));
const syntheticPngPortrait = () => encodePng(40, 50, () => [200, 200, 200]);

const spec = topicImageSpec({ motif: 'blauer Kreis', title: 'Smoke-Test' });
const modelId = QUALITY_MODEL();

async function offline() {
  console.log(`Konfiguration: Vision-Modell = ${modelId} (${process.env.IMAGE_QUALITY_MODEL ? 'IMAGE_QUALITY_MODEL' : 'Standard = ROUTER_MODEL'}), Router-Modell = ${ROUTER_MODEL}`);
  check('Modellname hat das Format owner/name', /^[a-z0-9-]+\/[a-z0-9._-]+$/i.test(modelId), modelId);
  // Failure handling and "uncertain is never approved" – with injected observers, no network.
  const png = 'https://x.public.blob.vercel-storage.com/a.png';
  const fetchPng = async () => new Response(syntheticPngPortrait(), { headers: { 'content-type': 'image/png' } });
  const throwing = await checkGeneratedImage({ url: png, spec }, { request: fetchPng, observe: async () => { throw new Error('provider down'); } });
  check('Providerfehler => nicht freigegeben, unsicher', throwing.approved === false && throwing.uncertain === true && throwing.checked.vision === false);
  const garbage = await checkGeneratedImage({ url: png, spec }, { request: fetchPng, observe: async () => ({ hello: 'world' }) });
  check('Ungültiges Schema => nicht freigegeben', garbage.approved === false && garbage.uncertain === true);
  const lowConfidence = decide(spec, { depicted_main_subject: 'blauer Kreis', primary_object_visible: 'yes', primary_object_prominence: 'dominant', forbidden_objects_visible: [], product_category_match: 'yes',
    other_product_instead: null, visual_defects: [], severe_defects: false, text_or_logos_visible: false, unrealistic_product_use: [], concept_understandable: 'yes', confidence: 0.2 });
  check('Niedrige Sicherheit => nie freigegeben', lowConfidence.approved === false && lowConfidence.uncertain === true);
}
async function metadata() {
  const token = process.env.REPLICATE_API_TOKEN?.trim();
  if (!token) return check('REPLICATE_API_TOKEN gesetzt (für --metadata)', false);
  const response = await fetch(`https://api.replicate.com/v1/models/${modelId}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
  check('Modell existiert (kostenloser GET)', response.ok, `HTTP ${response.status}`);
  if (!response.ok) return;
  const model = await response.json();
  const input = model.latest_version?.openapi_schema?.components?.schemas?.Input?.properties ?? {};
  const names = Object.keys(input);
  check('Modell deklariert image_input', 'image_input' in input, `Eingaben: ${names.join(', ') || 'unbekannt'}`);
  for (const name of ['system_prompt', 'prompt', 'max_completion_tokens']) check(`Modell deklariert ${name}`, name in input);
}

async function live() {
  const token = process.env.REPLICATE_API_TOKEN?.trim();
  if (!token) return check('REPLICATE_API_TOKEN gesetzt', false);
  if (process.env.VISION_SMOKE_APPROVED !== '1') return check('Ausdrückliche Freigabe (VISION_SMOKE_APPROVED=1) für genau einen kostenpflichtigen Aufruf', false);
  console.log('>>> EIN kostenpflichtiger Vision-Aufruf wird ausgeführt.');
  const dataUri = `data:image/png;base64,${syntheticPng().toString('base64')}`;
  let seen;
  try { seen = await replicateObserve(dataUri, spec); }
  catch (error) { return check('Modell erreichbar und Bildeingabe akzeptiert', false, error && error.message ? error.message : 'Fehler'); }
  check('Modell erreichbar und Bildeingabe akzeptiert', true);
  check('Antwort entspricht dem Schema', visionSchema.safeParse(seen).success);
  const subject = String(seen.depicted_main_subject || '').toLowerCase();
  check('Modell hat das Bild wirklich gesehen (rot/Quadrat/Viereck benannt)', /rot|quadrat|viereck|square|red/.test(subject), `gemeldet: "${seen.depicted_main_subject}"`);
  check('Modell meldet das geforderte Motiv (blauer Kreis) als nicht sichtbar', seen.primary_object_visible === 'no' || seen.primary_object_prominence === 'absent');
  const decision = decide(spec, seen);
  check('Quality-Gate lässt das falsche Bild nicht durch', decision.approved === false, `harte Gründe: ${decision.hard_failures.length}`);
}

(async () => {
  const mode = process.argv.includes('--live') ? 'live' : process.argv.includes('--metadata') ? 'metadata' : 'offline';
  console.log(`Modus: ${mode}`);
  await offline();
  if (mode === 'metadata') await metadata();
  if (mode === 'live') { await metadata(); await live(); }
  const failed = results.filter(r => !r.ok).length;
  console.log(failed ? `\n${failed} Prüfung(en) fehlgeschlagen.` : '\nAlle ausgeführten Prüfungen bestanden.');
  if (mode !== 'live') console.log('Hinweis: Bildfähigkeit des Modells ist erst mit --live nachgewiesen.');
  process.exitCode = failed ? 1 : 0;
  assert.ok(true);
})().catch(() => { console.error('Smoke-Test abgebrochen.'); process.exitCode = 1; });
