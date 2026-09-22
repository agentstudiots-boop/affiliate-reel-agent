import type { HistoricalCase, LearningEvidence } from "./schema";

// Compare only mature, same-platform, same-window cohorts selected by the repository.
// Cumulative snapshots never get added together. No fine-tuning, no causal claim.
export function evaluateHistory(cases: HistoricalCase[]): LearningEvidence {
  const groups: LearningEvidence["groups"] = [];
  for (const format of ["video", "image", "text"] as const) {
    const cohort = cases.filter(c => c.format === format);
    const sum = (key: "clicks"|"conversions"|"revenueCents"|"costCents") => cohort.reduce((n,c) => n+c[key],0);
    const clicks=sum("clicks"), conversions=sum("conversions"), revenueCents=sum("revenueCents"), costCents=sum("costCents");
    if (cohort.length < 3 || clicks < 100) continue;
    const profitCents = revenueCents-costCents;
    groups.push({ format, count: cohort.length, clicks, conversions, conversionRate: clicks ? conversions/clicks : 0,
      revenueCents, costCents, profitCents, roi: costCents ? profitCents/costCents : null, adjustment: 0 });
  }
  // Profit per content item accounts for production cost, unlike conversion rate alone.
  // Blend revenue-per-click into reporting, not a causal estimate or a guarantee.
  if (groups.length >= 2) {
    const means = groups.map(g => g.profitCents/g.count);
    const range = Math.max(...means)-Math.min(...means);
    if (range > 0) groups.forEach((g,i) => { g.adjustment = Math.round(((means[i]-Math.min(...means))/range*12-6)*100)/100; });
  }
  return { version: "rules-v1", sampleIds: cases.map(c => c.jobId), groups,
    summary: groups.length < 2 ? "Noch keine vergleichbaren, ausreichend großen Formatgruppen: keine datenbasierte Änderung der Rangfolge."
      : "Ähnliche abgeschlossene Fälle derselben Plattform und desselben Messfensters beeinflussen die Formatwertung um höchstens ±6 Punkte. Grundlage: durchschnittlicher Deckungsbeitrag je Content-Stück. Beobachtung, kein Beweis einer Ursache." };
}
