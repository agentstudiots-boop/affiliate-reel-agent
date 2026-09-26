import { put } from "@vercel/blob";
import { authorized } from "@/lib/memory/auth";

export const runtime = "nodejs";
const MAX_IMAGE_BYTES = 4_000_000;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(request: Request) {
  if (!authorized(request)) return Response.json({error:"Zugangscode erforderlich."},{status:401});
  try {
    const form = await request.formData();
    if (form.get("rightsConfirmed") !== "true") throw new Error("Nutzungsrecht für die Bearbeitung bei Runway bestätigen.");
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Bitte ein Produktfoto auswählen.");
    if (!ALLOWED_TYPES.has(file.type)) throw new Error("Erlaubt sind JPG, PNG und WebP.");
    if (file.size > MAX_IMAGE_BYTES) throw new Error("Das Bild darf höchstens 4 MB groß sein.");
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
    const blob = await put(`product-images/${Date.now()}-${safeName}`, file, {
      access: "public", addRandomSuffix: true, contentType: file.type,
    });
    return Response.json({ url: blob.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bild-Upload fehlgeschlagen.";
    return Response.json({ error: message }, { status: 400 });
  }
}
