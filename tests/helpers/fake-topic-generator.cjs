// Offline stand-in for the editorial model of the topic pipeline (no network). Agent "text" answers with a schema-valid
// topic copy built from the given title, with concrete, claim-free everyday steps; every other agent (e.g. "video") falls
// back to the reference, exactly as the real generator's reference mode would. `calls` records the agents asked.
function fakeTopicGenerator(options = {}) {
  const calls = [];
  const generate = async (agent, instruction, input, schema, reference) => {
    calls.push(agent);
    if (agent !== 'text' || options.text === false) return schema.parse(reference());
    const title = String(input.title);
    return schema.parse(options.text ?? {
      hook: `${title}: so wird es heute leichter`,
      body: `Bei ${title} hilft eine feste Reihenfolge. Lege dir alles bereit, bevor du anfängst, und arbeite dich von oben nach unten vor.`,
      // An operator wish (tone) yields a visibly different text, as a real rewrite would.
      caption: `${title}: eine feste Reihenfolge spart Wege. Alles bereitlegen, dann von oben nach unten arbeiten.${input.tone?.length ? ' Ganz in Ruhe, Schritt für Schritt.' : ''}`,
      cta: 'Speichern für später',
      question: 'Wie gehst du das bei dir an?',
      points: [
        { headline: 'Vorher bereitlegen', text: 'Lege alles, was du brauchst, an einem Platz bereit, bevor du anfängst.' },
        { headline: 'Feste Reihenfolge', text: 'Arbeite dich von oben nach unten vor, dann musst du nichts doppelt machen.' },
      ],
      video_script: `${title}: Lege alles bereit und arbeite von oben nach unten.`,
    });
  };
  return { generate, calls };
}

module.exports = { fakeTopicGenerator };
