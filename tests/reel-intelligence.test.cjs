const { test } = require("node:test");
const assert = require("node:assert/strict");
const { selectReelPatterns, reelPatternBrief } = require("../.test-build/lib/content/reel-intelligence");
const example = {
  id: "example-one", sourceUrl: "https://www.instagram.com/reel/example/",
  observedAt: "2026-10-08T18:00:00.000Z", niche: "Home Living Haushalt",
  targetGroup: "Familien und Haushalt", hook: "Das hätte ich früher wissen müssen",
  overlayStructure: "Problem → sichtbare Lösung → Ergebnis",
  captionStructure: "Einstieg → Schritte → Frage",
  emotion: "curiosity", mechanism: "Wissenslücke mit konkreter Alltagslösung",
  views: 150000, followersAtObservation: null, rights: "analysis_only",
};
test("accepts relevant validated patterns and rejects malformed entries", () => {
  const selected = selectReelPatterns([example, { ...example, id: "duplicate" }, { ...example, id:"other", sourceUrl:"http://insecure.test" }], "Haushalt", "Familien");
  assert.equal(selected.length, 1);
  assert.equal(selected[0].id, "example-one");
  assert.equal(selectReelPatterns([example], "Garten", "Profis").length, 0);
});
test("brief uses mechanisms without promising viral performance", () => {
  const brief = reelPatternBrief([example]);
  assert.match(brief, /Wissenslücke/);
  assert.match(brief, /kein Erfolgsbeweis/);
  assert.doesNotMatch(brief, /150000/);
});
