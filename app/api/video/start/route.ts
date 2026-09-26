export const runtime = "nodejs";

// Legacy requests contain only a name/prompt, with no saved product or WhatsApp cost approval.
// New production must use the existing content_jobs -> production_runs approval flow.
export function POST() {
  return Response.json({ error: "product_unresolved: Dieser alte Clip-Endpunkt hat keine gespeicherte ASIN-/Produktzuordnung. Bitte den freigegebenen Content-Job im Produktionsbereich verwenden.", notStarted: true }, { status: 410 });
}
