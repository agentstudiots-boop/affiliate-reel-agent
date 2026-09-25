import type { Brief } from "./agent";

// Reference mode has no language model. These sentences are deliberately grounded
// in the category and the supplied situation, without claiming first-hand use.
export function readerCopy(brief: Brief) {
  const { opportunity, inspiration } = brief;
  const situation = opportunity.useCase.toLocaleLowerCase("de-DE");
  const label = inspiration.categoryLabel;
  const category = opportunity.category;
  const blanket = /kuscheldecke|wohndecke|fleecedecke/i.test(label);
  const heated = /heizdecke|wärmedecke/i.test(label);
  const vacuum = /vakuumier|vakuum.?versiegl/i.test(label);
  const selection = inspiration.editorialMode === "category";
  const link = selection ? "Vergleiche die Angaben in der verlinkten Auswahl." : "Prüfe die Angaben auf der verlinkten Produktseite.";
  const disclosure = "Bei einem Kauf über den Affiliate-Link kann ich eine Provision erhalten.";

  if (heated) return {
    intro: "Kühle Abende zu Hause? Bei einer Heizdecke zählt neben der passenden Größe auch, wie sie verwendet und gepflegt werden darf.",
    advice: "Prüfe vor dem Kauf die Herstellerhinweise zur sicheren Nutzung und zur Pflege; Angaben einzelner Modelle können sich unterscheiden.",
    question: "Welche Größe brauchst du, und wo möchtest du die Decke verwenden?",
    spoken: ["Eine Heizdecke für kühle Abende?", "Welche Größe passt zu dir?", "Prüfe Pflege und sichere Nutzung laut Hersteller."],
    link, disclosure,
  };
  if (blanket) {
    const tea = /tee|tasse/.test(situation);
    const sofa = /sofa|couch/.test(situation);
    const bed = /bett|schlafzimmer/.test(situation);
    const intro = tea && sofa
      ? "Feierabend, Tee und ein Platz auf dem Sofa: Eine Kuscheldecke macht den ruhigen Abend ein bisschen gemütlicher."
      : bed ? "Abends im Bett noch ein paar Seiten lesen? Eine passende Decke kann es gemütlicher machen."
        : sofa ? "Abends aufs Sofa, Decke dazu und kurz zur Ruhe kommen." : "Eine Kuscheldecke gehört dorthin, wo du es dir gern gemütlich machst.";
    return {
      intro,
      advice: "Welche zu dir passt, hängt von Größe, Material und Pflege ab.",
      question: "Soll sie dich auf dem Sofa ganz einwickeln oder eher als leichte Decke dienen?",
      spoken: [tea && sofa ? "Feierabend, Tee und eine Decke fürs Sofa." : bed ? "Eine Decke für ruhige Abende im Bett?" : "Welche Decke passt zu deinem Alltag?", "Soll sie groß und weich sein?", "Achte auf Größe, Material und Pflege."],
      link, disclosure,
    };
  }
  if (vacuum) return {
    intro: "Ein größerer Einkauf? Portionen vorbereiten, verpacken und passend lagern kann den nächsten Kochabend erleichtern.",
    advice: "Dafür brauchst du passende Beutel; Vakuumieren ersetzt weder Kühlung noch Hygiene. Für Sous-vide ist zusätzlich ein temperiertes Wasserbad nötig.",
    question: "Würdest du eher Vorräte portionieren oder Sous-vide vorbereiten?",
    spoken: ["Ein Einkauf, mehrere Portionen für später.", "Mit passenden Beuteln verschließen und beschriften.", "Danach je nach Lebensmittel kühlen oder einfrieren."],
    link, disclosure,
  };
  if (category === "home_living") return {
    intro: `Beim Einrichten zählt, wie ${label} in deinen Raum und deinen Alltag passt.`,
    advice: "Schau dir Material, Maße und Pflege an, bevor du dich für eine Ausführung entscheidest.",
    question: "Sind dir bei der Auswahl die Maße oder die Pflege wichtiger?",
    spoken: ["Passt das auch in deinen Raum?", "Schau dir Material und Maße an.", "Und prüfe, wie du es pflegen kannst."],
    link, disclosure,
  };
  if (category === "kitchen") return {
    intro: `In der Küche zählt, ob ${label} zu dem passt, was du tatsächlich zubereitest.`,
    advice: "Prüfe die vorgesehene Anwendung, passendes Zubehör und die Pflegehinweise.",
    question: "Wofür würdest du es in deiner Küche am häufigsten nutzen?",
    spoken: ["Was willst du damit zubereiten?", "Prüfe, ob die Anwendung vorgesehen ist.", "Achte auch auf Zubehör und Pflege."],
    link, disclosure,
  };
  if (category === "technology") return {
    intro: `Bevor ${label} in den Warenkorb kommt: Passt es zu dem, was du schon nutzt?`,
    advice: "Vergleiche Kompatibilität, Abmessungen und die konkreten Herstellerangaben.",
    question: "Welche vorhandenen Geräte oder Anschlüsse müssen zusammenpassen?",
    spoken: ["Passt das zu deiner Ausstattung?", "Prüfe zuerst die Kompatibilität.", "Auch Maße und Anschlüsse können entscheiden."],
    link, disclosure,
  };
  if (category === "household") return {
    intro: `Im Haushalt ist ${label} dann interessant, wenn es zu deiner konkreten Aufgabe passt.`,
    advice: "Vergleiche Größe oder Ausführung sowie die Hinweise zur Anwendung und Pflege.",
    question: "Welche Aufgabe soll es dir im Alltag erleichtern?",
    spoken: ["Welche Aufgabe soll es übernehmen?", "Vergleiche die passende Ausführung.", "Prüfe Anwendung und Pflege vor dem Kauf."],
    link, disclosure,
  };
  if (category === "leisure") return {
    intro: `Ob zu Hause oder unterwegs: ${label} sollte zu dem passen, was du damit vorhast.`,
    advice: "Vergleiche Abmessungen, Handhabung und Herstellerhinweise für deinen Einsatzzweck.",
    question: "Wo würdest du es am häufigsten einsetzen?",
    spoken: ["Wo möchtest du es einsetzen?", "Prüfe die passende Größe.", "Und achte auf die Hinweise zur Nutzung."],
    link, disclosure,
  };
  const criteria = inspiration.purchaseCriteria.slice(0, 3).join(", ");
  return {
    intro: `Du suchst ${label} für deinen Alltag? Überlege zuerst, wofür du es brauchst.`,
    advice: `Vergleiche dafür ${criteria} anhand der konkreten Angaben.`,
    question: "Welche Eigenschaft ist für deine Anwendung entscheidend?",
    spoken: ["Wofür brauchst du es im Alltag?", "Sieh dir die Angaben zur Anwendung an.", "Vergleiche die Details vor dem Kauf."],
    link, disclosure,
  };
}

export function readerCaption(brief: Brief, subdued = false) {
  const copy = readerCopy(brief);
  return `Werbung | ${subdued ? `${copy.advice} ${copy.link}` : `${copy.intro} ${copy.advice} ${copy.link}`} ${copy.disclosure}`;
}
