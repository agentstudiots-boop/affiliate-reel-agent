import { reelAgent } from "@/lib/agent";
import { productSchema } from "@/lib/schema";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const product = productSchema.parse(await request.json());
    const { output } = await reelAgent.generate({
      prompt: `Erstelle das Reel-Konzept für dieses Produkt:\n${JSON.stringify(product, null, 2)}`,
    });

    return Response.json(output);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unbekannter Fehler";
    return Response.json({ error: message }, { status: 400 });
  }
}

