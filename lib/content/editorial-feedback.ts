// Route ordinary copy feedback to the content agent before asking for clarification.
// Match a named text field and a concrete readability complaint together; an
// unrelated complaint about the image or product must never rewrite the copy.
export function asksForNaturalCopy(message: string) {
  const text=message.toLocaleLowerCase("de-DE");
  return /(?:begleittext|beitragstext|posttext|caption|beschreibung|\btext\b)/i.test(text)
    && /(?:passt nicht|klingt|system.?intern|maschinell|automatisch|hölzern|unpersönlich|unverständlich|bürokratisch|natürlicher|menschlicher|lesbarer|verständlicher|überarbeiten|unpassend|holprig|schlecht formuliert|falsch formuliert)/i.test(text);
}
