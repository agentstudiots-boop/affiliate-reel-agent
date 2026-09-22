"use client";

import { FormEvent, useEffect, useState } from "react";
import { MetaConnection } from "@/app/meta-connection";
import { VideoStudio } from "@/app/video-studio";
import type { Product, ProductReview, ProjectState, ReelConcept, TrendCandidate, TrendReport, WorkflowStatus } from "@/lib/types";

const emptyProduct: Product = {
  name: "",
  sourceUrl: "",
  affiliateUrl: "",
  price: "",
  targetGroup: "",
  benefits: "",
  notes: "",
};

const initialState: ProjectState = {
  product: emptyProduct,
  concept: null,
  status: "draft",
  publishedUrl: "",
  clicks: 0,
  sales: 0,
  revenue: "0,00",
  updatedAt: new Date(0).toISOString(),
};

const statusLabels: Record<WorkflowStatus, string> = {
  draft: "Produkt",
  generated: "Entwurf",
  approved: "Freigegeben",
  published: "Veröffentlicht",
};

export default function Home() {
  const [state, setState] = useState<ProjectState>(initialState);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [scouting, setScouting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [trendReport, setTrendReport] = useState<TrendReport | null>(null);
  const [productReview, setProductReview] = useState<ProductReview | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const hydrate = window.setTimeout(() => {
      const saved = localStorage.getItem("affiliate-reel-agent-v1");
      if (saved) {
        try { setState(JSON.parse(saved) as ProjectState); } catch { /* neuer Start */ }
      }
      setReady(true);
    }, 0);
    return () => window.clearTimeout(hydrate);
  }, []);

  useEffect(() => {
    if (ready) localStorage.setItem("affiliate-reel-agent-v1", JSON.stringify(state));
  }, [ready, state]);

  function patch(next: Partial<ProjectState>) {
    setState((current) => ({ ...current, ...next, updatedAt: new Date().toISOString() }));
  }

  function updateProduct(field: keyof Product, value: string) {
    setProductReview(null);
    setState((current) => ({
      ...current,
      product: { ...current.product, [field]: value },
      status: "draft",
      updatedAt: new Date().toISOString(),
    }));
  }

  async function generate(event: FormEvent) {
    event.preventDefault();
    if (!productReview) {
      setError("Der Orchestrator benötigt zuerst die Freigabe der Produkt-Prüfung.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state.product),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Der Agent konnte keinen Entwurf erstellen.");
      patch({
        concept: data.concept,
        product: { ...state.product, affiliateUrl: data.affiliateUrl },
        status: "generated",
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unbekannter Fehler");
    } finally {
      setLoading(false);
    }
  }

  async function scoutTrends() {
    setScouting(true);
    setError("");
    try {
      const response = await fetch("/api/trends", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Der Trend-Scout konnte nicht recherchieren.");
      setTrendReport(data as TrendReport);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unbekannter Fehler");
    } finally {
      setScouting(false);
    }
  }

  async function chooseTrend(candidate: TrendCandidate) {
    setVerifying(true);
    setError("");
    try {
      const response = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(candidate),
      });
      const review = await response.json();
      if (!response.ok) throw new Error(review.error || "Die Produkt-Prüfung ist fehlgeschlagen.");
      const typedReview = review as ProductReview;
      if (!typedReview.approvalRecommendation) throw new Error("Die Prüfabteilung empfiehlt diesen Kandidaten derzeit nicht. Bitte einen anderen wählen.");

      setProductReview(typedReview);
    setState((current) => ({
      ...current,
      product: {
        ...emptyProduct,
        name: typedReview.normalizedName,
        sourceUrl: candidate.amazonUrl,
        affiliateUrl: candidate.affiliateUrl,
        price: "Aktueller Preis siehe Amazon",
        targetGroup: typedReview.targetGroup,
        benefits: typedReview.verifiedBenefits.join("; "),
        notes: `${typedReview.cautions.join("; ")} Keine erfundenen Tests, Preise, Rabatte oder Garantien behaupten.`,
      },
      concept: null,
      status: "draft",
      updatedAt: new Date().toISOString(),
    }));
      document.querySelector(".grid")?.scrollIntoView({ behavior: "smooth" });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unbekannter Fehler");
    } finally {
      setVerifying(false);
    }
  }

  async function verifyManualProduct() {
    const candidate: TrendCandidate = {
      name: state.product.name,
      category: "Manuell eingetragen",
      kind: "Dauerläufer",
      season: "Vom Nutzer ausgewählt",
      whyNow: "Manuelle Produktauswahl zur unabhängigen Prüfung",
      reelIdea: "Praktischen Nutzen demonstrieren",
      targetGroup: state.product.targetGroup || "Noch zu prüfen",
      benefitsToVerify: state.product.benefits ? [state.product.benefits, "Eignung für ein kurzes Demonstrationsvideo"] : ["Produkteigenschaften", "Eignung für ein kurzes Demonstrationsvideo"],
      searchQuery: state.product.name,
      confidence: 50,
      amazonUrl: state.product.sourceUrl,
      affiliateUrl: state.product.affiliateUrl,
    };
    await chooseTrend(candidate);
  }

  function reset() {
    if (window.confirm("Aktuellen Test wirklich zurücksetzen?")) {
      setProductReview(null);
      setState({ ...initialState, updatedAt: new Date().toISOString() });
    }
  }

  return (
    <main>
      <header className="hero">
        <div>
          <span className="eyebrow">AFFILIATE-AGENT · V0.1</span>
          <h1>Ein Produkt. Ein Reel.<br />Ein messbarer Test.</h1>
          <p>Vom Produktfund bis zur Auswertung – mit einer bewussten Freigabe vor der Veröffentlichung.</p>
        </div>
        <button className="ghost" onClick={reset}>Neuer Test</button>
      </header>

      <nav className="steps" aria-label="Workflow">
        {(Object.keys(statusLabels) as WorkflowStatus[]).map((item, index) => {
          const current = (Object.keys(statusLabels) as WorkflowStatus[]).indexOf(state.status);
          return <span className={index <= current ? "active" : ""} key={item}>{index + 1} {statusLabels[item]}</span>;
        })}
      </nav>

      <MetaConnection />

      <section className="scout panel">
        <div className="scoutHead">
          <div className="panelTitle"><span>00</span><div><h2>Trend-Scout</h2><p>Aktuelle Signale + Saisonkalender + Dauerläufer.</p></div></div>
          <button className="primary scoutButton" type="button" disabled={scouting} onClick={scoutTrends}>
            {scouting ? "Trends werden recherchiert …" : "Produkte finden"}
          </button>
        </div>
        {!trendReport ? <p className="scoutIntro">Der Scout sucht fünf Kandidaten für Deutschland und trennt aktuelle Trends, Saisonprodukte und ganzjährige Dauerläufer.</p> : <>
          <p className="scoutSummary">{trendReport.summary}</p>
          <div className="trendGrid">{trendReport.candidates.map((candidate) => <article className="trendCard" key={`${candidate.kind}-${candidate.name}`}>
            <div className="trendMeta"><span>{candidate.kind}</span><small>{candidate.confidence}% Signalstärke</small></div>
            <h3>{candidate.name}</h3>
            <p>{candidate.whyNow}</p>
            <small>{candidate.season} · {candidate.category}</small>
            <div className="trendActions">
              <a href={candidate.amazonUrl} target="_blank" rel="noopener">Bei Amazon prüfen ↗</a>
              <button type="button" disabled={verifying} onClick={() => chooseTrend(candidate)}>{verifying ? "Prüfung läuft …" : "Prüfen & übernehmen"}</button>
            </div>
          </article>)}</div>
          {trendReport.sources.length > 0 && <details className="sources"><summary>Recherchequellen anzeigen</summary>{trendReport.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noopener">{source.title || source.url}</a>)}</details>}
        </>}
      </section>

      <section className="grid">
        <form className="panel" onSubmit={generate}>
          <div className="panelTitle"><span>01</span><div><h2>Produkt erfassen</h2><p>Nur belegbare Angaben eintragen.</p></div></div>
          <label>Produktname<input required value={state.product.name} onChange={(e) => updateProduct("name", e.target.value)} placeholder="z. B. Microplane Premium Classic" /></label>
          <div className="two">
            <label>Amazon-Produktseite<input required type="url" value={state.product.sourceUrl} onChange={(e) => updateProduct("sourceUrl", e.target.value)} placeholder="https://www.amazon.de/…" /></label>
            <label>Affiliate-Link (automatisch)<input type="url" value={state.product.affiliateUrl} onChange={(e) => updateProduct("affiliateUrl", e.target.value)} placeholder="Wird aus der Produktseite erzeugt" /></label>
          </div>
          <div className="two">
            <label>Preis<input value={state.product.price} onChange={(e) => updateProduct("price", e.target.value)} placeholder="z. B. 24,90 €" /></label>
            <label>Zielgruppe<input required value={state.product.targetGroup} onChange={(e) => updateProduct("targetGroup", e.target.value)} placeholder="Für wen ist es relevant?" /></label>
          </div>
          <label>Belegbare Vorteile<textarea required value={state.product.benefits} onChange={(e) => updateProduct("benefits", e.target.value)} placeholder="Eigenschaften, eigener Eindruck, Nutzen …" /></label>
          <label>Hinweise / Einschränkungen<textarea value={state.product.notes} onChange={(e) => updateProduct("notes", e.target.value)} placeholder="Was darf der Agent nicht behaupten?" /></label>
          {productReview && <div className="reviewBox"><strong>✓ Produkt-Prüfung bestanden · {productReview.confidence}% Sicherheit</strong><p>{productReview.evidenceSummary}</p><small>Der Drehbuch-Agent verwendet nur die geprüften Nutzenargumente.</small></div>}
          {error && <p className="error">{error}</p>}
          {!productReview && <button className="secondary" type="button" disabled={verifying || !state.product.name || !state.product.sourceUrl} onClick={verifyManualProduct}>{verifying ? "Prüfabteilung arbeitet …" : "Produktangaben prüfen"}</button>}
          <button className="primary" disabled={loading || !productReview}>{loading ? "Drehbuch-Agent arbeitet …" : productReview ? "Reel-Entwurf erstellen" : "Erst Produkt prüfen"}</button>
        </form>

        <section className="panel result">
          <div className="panelTitle"><span>02</span><div><h2>Reel & Freigabe</h2><p>Menschen behalten die letzte Entscheidung.</p></div></div>
          {!state.concept ? <div className="empty"><b>Noch kein Entwurf</b><p>Links ein Produkt eintragen und den Agenten starten.</p></div> : <Concept concept={state.concept} />}
          {state.concept && state.status === "generated" && <button className="primary approve" onClick={() => patch({ status: "approved" })}>Entwurf freigeben</button>}
          {state.concept && (state.status === "approved" || state.status === "published") && <VideoStudio key={JSON.stringify([state.product, state.concept])} product={state.product} concept={state.concept} />}
          {state.status === "approved" && <div className="publish"><label>URL des veröffentlichten Reels<input value={state.publishedUrl} onChange={(e) => patch({ publishedUrl: e.target.value })} placeholder="https://instagram.com/…" /></label><button className="primary" onClick={() => patch({ status: "published" })}>Als veröffentlicht markieren</button></div>}
          {state.status === "published" && <div className="success">✓ Reel als veröffentlicht erfasst</div>}
        </section>
      </section>

      <section className="metrics panel">
        <div className="panelTitle"><span>03</span><div><h2>Ergebnis messen</h2><p>Ein kleiner Test braucht klare Zahlen.</p></div></div>
        <div className="metricGrid">
          <label>Klicks<input type="number" min="0" value={state.clicks} onChange={(e) => patch({ clicks: Number(e.target.value) })} /></label>
          <label>Verkäufe<input type="number" min="0" value={state.sales} onChange={(e) => patch({ sales: Number(e.target.value) })} /></label>
          <label>Provision (€)<input value={state.revenue} onChange={(e) => patch({ revenue: e.target.value })} /></label>
          <div className="rate"><small>Conversion</small><strong>{state.clicks ? ((state.sales / state.clicks) * 100).toFixed(1) : "0.0"}%</strong></div>
        </div>
        {state.product.affiliateUrl && <a className="track" href={state.product.affiliateUrl} target="_blank" rel="sponsored noopener" onClick={() => patch({ clicks: state.clicks + 1 })}>Affiliate-Link testen ↗</a>}
      </section>

      <footer>Daten bleiben in diesem Browser · KI-Ausgabe vor Veröffentlichung prüfen · Werbung klar kennzeichnen</footer>
    </main>
  );
}

function Concept({ concept }: { concept: ReelConcept }) {
  return <div className="concept">
    <h3>Hook</h3><blockquote>{concept.hook}</blockquote>
    <h3>Szenen</h3>{concept.scenes.map((scene, i) => <article className="scene" key={`${scene.seconds}-${i}`}><b>{scene.seconds}</b><div><strong>{scene.visual}</strong><p>{scene.voiceover}</p><em>Einblendung: {scene.overlay}</em></div></article>)}
    <h3>Caption</h3><p>{concept.caption}</p>
    <div className="tags">{concept.hashtags.map((tag) => <span key={tag}>{tag}</span>)}</div>
    <h3>CTA & Kennzeichnung</h3><p>{concept.cta}</p><p className="disclosure">{concept.disclosure}</p>
    <h3>Vor Veröffentlichung prüfen</h3><ul>{concept.checks.map((check) => <li key={check}>{check}</li>)}</ul>
  </div>;
}
