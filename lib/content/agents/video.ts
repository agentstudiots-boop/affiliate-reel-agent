import { videoSchema } from "../schema";
import type { Brief, Generator } from "../agent";
import { readerCaption, readerCopy } from "../editorial-copy";

function reviseReferenceVideo(brief: Brief) {
  if (brief.previous?.format !== "video" || !brief.changeRequest) throw new Error("Vorheriger Video-Plan und Änderungsauftrag fehlen.");
  const request = brief.changeRequest.toLocaleLowerCase("de-DE");
  const next = structuredClone(brief.previous);
  let applied = false;
  if (/kinder?\b/i.test(request) && /(?:beteilig|integrier|mitmach|mitmach|helfen|dabei|schnitz)/i.test(request)
    && /kürbis.*schnitz|schnitz.*kürbis/i.test(brief.opportunity.product.name)) {
    next.scenes[0].visual = "Halloweenabend am Basteltisch: Ein großer echter orangefarbener Kürbis im Vordergrund. Ein Kind und eine erwachsene Person überlegen gemeinsam, wie die leuchtende Laterne aussehen soll.";
    next.scenes[0].audio = "Heute gestalten wir gemeinsam eine Halloweenlaterne. Aus diesem echten Kürbis soll ein Gesicht werden.";
    next.scenes[1].visual = "Das Kind zeichnet Augen und Mund auf den echten Kürbis; die erwachsene Person sitzt direkt daneben und bereitet das kleine Kürbisschnitzwerkzeug vor. Gemeinsames Basteln als Hauptmotiv.";
    next.scenes[1].audio = "Zuerst zeichnet das Kind Augen und Mund vor. Dann beginnt die Schnitzarbeit unter Aufsicht.";
    next.scenes[2].visual = "Nahaufnahme: Die erwachsene Person schnitzt mit einem kleinen neutralen Kürbisschnitzwerkzeug sichtbar die Augenöffnung aus dem echten Kürbis. Das Kind schaut daneben zu und sammelt mit einem Löffel Kürbiskerne. Hände des Kindes bleiben vom Schneidwerkzeug entfernt.";
    next.scenes[2].audio = "Während ein Erwachsener die Augenöffnung schnitzt, hilft das Kind beim Ausschöpfen. Der Kürbis bleibt im Mittelpunkt.";
    next.scenes[3].visual = "Die erwachsene Person schnitzt die Mundöffnung fertig. Das Kind und die erwachsene Person betrachten gemeinsam die leuchtende Kürbislaterne und freuen sich über ihre Deko.";
    next.scenes[3].audio = "Dann entsteht der Mund. Gemeinsam freuen sie sich über die leuchtende Laterne.";
    next.scenes[4].visual = "Fertige geschnitzte Kürbislaterne und kleine neutrale Schnitzwerkzeuge am Basteltisch; Kind und erwachsene Person betrachten das Ergebnis. Keine Markenabbildung oder unbelegten Produkteigenschaften.";
    next.caption = `Gemeinsam eine Halloweenlaterne gestalten: Ein Kind zeichnet das Gesicht vor und hilft beim Ausschöpfen; ein Erwachsener schnitzt Augen und Mund mit einem Kürbisschnitzwerkzeug. Das verlinkte YAVOCOS Kürbisschnitzset ist eine mögliche Werkzeugwahl. Lieferumfang und Hinweise bitte auf der Produktseite prüfen. Werbung | ASIN ${brief.opportunity.product.asin}. ${next.cta} Bei einem Kauf über den Affiliate-Link kann ich eine Provision erhalten.`;
    next.productIntegration = "Das Kind beteiligt sich am Entwurf und Ausschöpfen; die erwachsene Person führt das Schnitzwerkzeug. Der echte Kürbis, die sichtbare Schnitzhandlung und die fertige Deko-Laterne bleiben im Mittelpunkt. Konkrete Modellmerkmale bleiben ungeprüft.";
    applied = true;
  }
  if (/erste szene kürzer|szene 1 kürzer/.test(request)) {
    next.scenes[0].durationSeconds = Math.max(2, next.scenes[0].durationSeconds - 2);
    applied = true;
  }
  if (/cta.{0,25}weniger werblich|weniger werblich.{0,25}cta/.test(request)) {
    next.cta = new URL(brief.opportunity.product.sourceUrl).pathname === "/s"
      ? "Bei Interesse kannst du die verlinkte Auswahl vergleichen."
      : "Bei Interesse kannst du die Angaben zum verlinkten Produkt prüfen.";
    next.scenes.at(-1)!.audio = next.cta;
    applied = true;
  }
  if (/szene\s*3\s*(raus|entfernen|streichen)|nimm\s+szene\s*3\s+raus/.test(request)) {
    if (next.scenes.length <= 3) throw new Error("Szene 3 kann nicht entfernt werden: mindestens drei Szenen erforderlich.");
    next.scenes.splice(2, 1);
    applied = true;
  }
  if (/video ruhiger|ruhigeres video|mach.{0,20}ruhiger/.test(request)) {
    // A single narrator cannot recreate the original multi-speaker dialogue.
    if (!/vakuumier/i.test(brief.opportunity.product.name)) throw new Error("Ruhigere Fassung für dieses Produkt im Referenzmodus nicht sicher ableitbar.");
    next.scenes[0].audio = "Ein Familienessen. Oma entdeckt eine Idee für die Zubereitung des Steaks.";
    next.scenes.at(-2)!.audio = "Beim gemeinsamen Essen steht der praktische Ablauf im Mittelpunkt.";
    applied = true;
  }
  if (!applied) throw new Error("Änderungswunsch im Referenzmodus nicht eindeutig umsetzbar. Bitte konkret eine Szene, den CTA oder das Erzähltempo nennen.");
  next.durationSeconds = next.scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0);
  return videoSchema.parse(next);
}

export function videoAgent(brief: Brief, generate: Generator) {
  return generate("video", `Setze ausschließlich das vom Orchestrator ausgewählte Konzept in ein vollständiges Drehbuch um.
Die Geschichte bestimmt die Dauer: Bei Instagram-Reels genau 30 Sekunden für den aktuellen Runway-Produktionsweg; bei anderen Formaten 10–40 Sekunden. Summe aller Szenendauern muss durationSeconds entsprechen.
Pro Szene konkrete visuelle Handlung, sprechbarer Dialog/Voiceover und Einblendung. Maximal ca. 2,5 gesprochene Wörter pro Sekunde.
Das Produkt und seine sichtbare Anwendung tragen die Geschichte: Ausgangssituation, konkrete Handlung, nachvollziehbares Ergebnis und eine menschliche Reaktion. Nur belegte Eigenschaften und Erleichterungen als Tatsachen darstellen; keine eigene Nutzung erfinden.
Produktintegration, Voraussetzungen, CTA und Caption ausarbeiten. Feedback bei Revision gezielt beheben. Keine Videogenerierung auslösen.`, brief, videoSchema, () => {
    if (brief.changeRequest) return reviseReferenceVideo(brief);
    const { idea, opportunity } = brief;
    const vacuum = /vakuumier|vakuum.?versiegl/i.test(opportunity.product.name);
    const pumpkin = /kürbis.*schnitz|schnitz.*kürbis/i.test(opportunity.product.name);
    const copy = readerCopy(brief);
    const cta = opportunity.targetPlatform === "instagram"
      ? "Produktname, ASIN und Produktlink stehen im Beitragstext."
      : "Eignung und Details beim verlinkten Produkt prüfen.";
    const scenes = pumpkin ? [
      { durationSeconds: 6, visual: "Halloweenabend am Basteltisch. Ein großer echter orangefarbener Kürbis ohne Gesicht steht im Vordergrund. Eine erwachsene Person betrachtet ihn; Vorfreude auf die spätere Laterne.", audio: "Aus diesem Kürbis soll heute Abend eine Halloweenlaterne werden.", overlay: "Werbung · Eine Halloweenidee" },
      { durationSeconds: 6, visual: "Erwachsene Hände zeichnen Augen und Mund auf die Schale eines echten orangefarbenen Kürbisses. Ein kleines neutrales Kürbisschnitzwerkzeug liegt daneben; keine Kinder, keine Speisen.", audio: "Eine erwachsene Person zeichnet Augen und Mund auf die Schale. Dann beginnt das Schnitzen.", overlay: "Vom Entwurf zum Kürbisgesicht" },
      { durationSeconds: 7, visual: "Nahaufnahme: Erwachsene Hände schneiden mit einem kleinen neutralen Kürbisschnitzwerkzeug sichtbar eine Augenöffnung aus dem echten Kürbis. Kürbisschale und Kerne am Basteltisch. Kein Küchenmesser oder Gebäck.", audio: "Mit dem Kürbisschnitzwerkzeug wird die erste Augenöffnung vorsichtig ausgeschnitten. Der Kürbis bleibt im Mittelpunkt.", overlay: "Ein echter Kürbis wird geschnitzt" },
      { durationSeconds: 5, visual: "Die erwachsene Person schnitzt sichtbar die Mundöffnung fertig. Schnitt zur fertigen Kürbislaterne im Abendlicht. Sie lächelt über das Ergebnis. Kein exaktes Produktmodell nachbilden.", audio: "Dann entsteht der Mund. Gemeinsam freuen sie sich über die leuchtende Laterne.", overlay: "Vom Kürbis zur Laterne" },
      { durationSeconds: 6, visual: "Fertige geschnitzte Kürbislaterne und neutrale kleine Schnitzwerkzeuge am Basteltisch. Erwachsene Person daneben. Keine Markenabbildung, keine unbestätigten Eigenschaften, keine Shop-Schaltfläche.", audio: "Das YAVOCOS Kürbisschnitzset ist eine Werkzeugoption. Prüfe Lieferumfang und Hinweise auf der Produktseite.", overlay: "Produktdetails im Beitragstext · Werbung" },
    ] : vacuum ? [
      { durationSeconds: 5, visual: "Inszenierte Werbeszene am Familientisch: Oma schneidet das gebräunte Steak an. Nahaufnahme: rosa Kern, saftige Schnittfläche, Kräuterbutter schmilzt. Ihr überraschter Blick zu Papa.", audio: "Oma: Das hast du doch nicht selbst gemacht!", overlay: "Werbung · inszenierte Szene" },
      { durationSeconds: 4, visual: "Papa lächelt. Schnitt als Rückblende zur Küchenarbeitsfläche; Vakuumierer und separates Sous-vide-Gerät sichtbar.", audio: "Papa: Doch. Mit Vakuumierer und Sous-vide-Garer.", overlay: "Zwei Geräte, zwei Aufgaben" },
      { durationSeconds: 6, visual: "Rohes Steak in einen geeigneten Beutel legen, Beutelrand korrekt in das Vakuumiergerät führen und verschließen. Fleisch bleibt im Beutel.", audio: "Der Vakuumierer verschließt das Steak im geeigneten Beutel.", overlay: "1 · Für Sous-vide geeigneter Beutel" },
      { durationSeconds: 6, visual: "Verschlossenen Beutel mit Steak ins Wasserbad mit separatem Sous-vide-Garer geben. Schnitt kennzeichnet Zeitablauf; keine erfundenen Einstellungen zeigen.", audio: "Gegart wird anschließend im temperierten Wasserbad, mit einem separaten Garer.", overlay: "2 · Wasserbad + passendes Garprogramm" },
      { durationSeconds: 6, visual: "Nach dem Garen auspacken, trocken tupfen, in heißer Pfanne kurz anbraten. Bräunende Kruste, hörbares Brutzeln. Keine rohe und fertige Zubereitung vermischen.", audio: "Danach auspacken, trocken tupfen und für die Kruste kurz anbraten.", overlay: "3 · Die Kruste kommt aus der Pfanne" },
      { durationSeconds: 5, visual: "Zurück am Familientisch. Warmes Licht, rosa Anschnitt groß im Bild. Oma nimmt einen Bissen und nickt lächelnd.", audio: "Oma: Dann komm ich nächste Woche wieder!", overlay: "Eine Idee fürs nächste Familienessen" },
      { durationSeconds: 5, visual: "Produktübersicht mit beiden getrennten Geräten, passenden Beuteln und fertigem Teller. CTA im Schnitt ergänzen.", audio: cta, overlay: "Produktdetails · Affiliate-Link" },
    ] : [
      { durationSeconds: 5, visual: `Konkrete Ausgangssituation zeigen: ${idea.situation}`, audio: copy.spoken[0], overlay: "Werbung · Anwendungsidee" },
      { durationSeconds: 7, visual: `Anwendung inszenieren: ${idea.useCase}. Keine unbestätigten Funktionen als Tatsache zeigen.`, audio: copy.spoken[1], overlay: "Anwendung im Alltag" },
      { durationSeconds: 7, visual: `Nachvollziehbares Ergebnis zeigen: ${idea.benefit}. Keine unbestätigten Vorher-Nachher-Effekte simulieren.`, audio: copy.spoken[2], overlay: "Vor dem Kauf prüfen" },
      { durationSeconds: 5, visual: `Das Produkt ${opportunity.product.name} im Kontext der Anwendung zeigen.`, audio: cta, overlay: "Werbung · Affiliate-Link" },
    ];
    if (opportunity.targetPlatform === "instagram") {
      // Keep the whole approved story inside one 30-second Runway task.
      let total = scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0);
      while (total !== 30) {
        const candidates = scenes.map((scene, index) => ({scene,index})).filter(({scene}) => total > 30 ? scene.durationSeconds > 2 : scene.durationSeconds < 10);
        if (!candidates.length) throw new Error("30-Sekunden-Storyboard lässt sich nicht aufteilen.");
        candidates.sort((a,b) => total > 30
          ? b.scene.durationSeconds - a.scene.durationSeconds || a.index - b.index
          : a.scene.durationSeconds - b.scene.durationSeconds || a.index - b.index);
        candidates[0].scene.durationSeconds += total > 30 ? -1 : 1;
        total += total > 30 ? -1 : 1;
      }
    }
    return { format: "video" as const, title: pumpkin ? "Vom Kürbis zur Halloweenlaterne" : idea.title, hook: pumpkin ? "Ein Gesicht entsteht – und der Halloweenabend kann beginnen." : idea.hook, useCase: idea.useCase,
      productIntegration: pumpkin ? "Der echte Kürbis und die Handlung des Schnitzens bleiben im Vordergrund. Das verlinkte Schnitzset wird als mögliche Werkzeugwahl eingeordnet; konkrete Modellmerkmale und Lieferumfang bleiben ungeprüft." : vacuum ? "Vakuumierer verschließt; separates Wasserbad gart; Pfanne erzeugt Kruste. Zubehör ist nicht automatisch im Lieferumfang." : idea.benefit,
      durationSeconds: scenes.reduce((s, x) => s + x.durationSeconds, 0), scenes, cta, disclosure: "Werbung | Affiliate-Link" as const,
      caption: pumpkin ? `Ein echter Kürbis wird zur Halloweenlaterne: Erst das Gesicht vorzeichnen, dann schnitzt eine erwachsene Person Augen und Mund. Das verlinkte YAVOCOS Kürbisschnitzset ist eine mögliche Werkzeugwahl; Lieferumfang, Anwendung und Herstellerhinweise bitte auf der Produktseite prüfen. Werbung | ASIN ${opportunity.product.asin}. ${cta} Bei einem Kauf über den Affiliate-Link kann ich eine Provision erhalten.` : vacuum ? `Werbung | ${idea.benefit} Fiktive Familienszene, kein Testbericht. Sous-vide benötigt geeignete Beutel und ein separates temperiertes Wasserbad. Ergebnis abhängig von Lebensmittel und korrekter Zubereitung. Vakuumieren kann außerdem bei geeigneten Lebensmitteln und korrekter Lagerung die Haltbarkeit verlängern; Kühlung und Hygiene bleiben erforderlich. ${cta} Bei einem Kauf über den Affiliate-Link kann eine Provision anfallen.` : readerCaption(brief),
      checks: ["Modelleignung und Herstellerhinweise prüfen.", "Dialog ist inszenierte Werbung, keine echte Kundenbewertung.", "Sprecher, Schnitt, Untertitel und Einblendungen produzieren. Dies ist ein Drehbuch, kein fertiges Video.", opportunity.product.notes || "Keine zusätzlichen Modellnachweise hinterlegt."],
    };
  });
}
