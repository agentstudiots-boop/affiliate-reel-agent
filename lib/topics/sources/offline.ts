import type { TopicSource } from "../resilience";
import type { RawSignal } from "../schema";

// Offline sources: computed locally, no network, no provider. They keep the scout useful when every
// network source is down. They make no factual claim beyond the calendar date itself.

type CalendarEvent = { key: string; title: string; date: Date; tags: string[]; angle: string };

const utc = (year: number, month: number, day: number) => new Date(Date.UTC(year, month - 1, day));
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 86_400_000);
const iso = (date: Date) => date.toISOString().slice(0, 10);

// Gauss / Anonymous Gregorian algorithm.
export function easterSunday(year: number) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return utc(year, month, day);
}
// n-th weekday (0=Sunday) of a month; n=-1 means the last one.
function nthWeekday(year: number, month: number, weekday: number, n: number) {
  if (n > 0) { const first = utc(year, month, 1); return addDays(first, ((weekday - first.getUTCDay() + 7) % 7) + (n - 1) * 7); }
  const last = utc(year, month + 1, 0);
  return addDays(last, -((last.getUTCDay() - weekday + 7) % 7));
}

export function germanCalendar(year: number): CalendarEvent[] {
  const easter = easterSunday(year);
  const christmas = utc(year, 12, 25);
  const firstAdvent = addDays(christmas, -((christmas.getUTCDay() || 7) + 21));
  const e = (key: string, title: string, date: Date, tags: string[], angle: string): CalendarEvent => ({ key, title, date, tags, angle });
  return [
    e("neujahr", "Neujahr", utc(year, 1, 1), ["feiertag", "vorsätze"], "gute Vorsätze alltagstauglich umsetzen"),
    e("valentinstag", "Valentinstag", utc(year, 2, 14), ["anlass", "geschenk"], "kleine Aufmerksamkeiten ohne Kitsch"),
    e("rosenmontag", "Rosenmontag", addDays(easter, -48), ["karneval"], "Kostüm und Feiern mit wenig Aufwand"),
    e("zeitumstellung-sommer", "Zeitumstellung auf Sommerzeit", nthWeekday(year, 3, 0, -1), ["zeitumstellung", "praktisch"], "an welche Uhren und Geräte man denken sollte"),
    e("fruehlingsanfang", "Frühlingsanfang", utc(year, 3, 20), ["jahreszeit", "frühjahrsputz"], "Frühjahrsputz in sinnvoller Reihenfolge"),
    e("karfreitag", "Karfreitag", addDays(easter, -2), ["feiertag"], "Feiertage und geschlossene Läden einplanen"),
    e("ostern", "Ostern", easter, ["feiertag", "familie"], "Ostervorbereitung mit Kindern und Familie"),
    e("tag-der-arbeit", "Tag der Arbeit", utc(year, 5, 1), ["feiertag", "brückentag"], "langes Wochenende entspannt planen"),
    e("muttertag", "Muttertag", nthWeekday(year, 5, 0, 2), ["anlass", "geschenk"], "persönliche Geschenkideen statt Standard"),
    e("himmelfahrt", "Christi Himmelfahrt / Vatertag", addDays(easter, 39), ["feiertag", "draußen"], "Ausflug und Grillen vorbereiten"),
    e("pfingsten", "Pfingsten", addDays(easter, 49), ["feiertag", "draußen"], "Kurzurlaub und Ausflug packen"),
    e("sommeranfang", "Sommeranfang", utc(year, 6, 21), ["jahreszeit", "hitze"], "Wohnung bei Hitze kühl halten"),
    e("herbstanfang", "Herbstanfang", utc(year, 9, 22), ["jahreszeit", "herbst"], "Wohnung auf Herbst und Heizsaison vorbereiten"),
    e("tag-der-deutschen-einheit", "Tag der Deutschen Einheit", utc(year, 10, 3), ["feiertag", "brückentag"], "langes Wochenende sinnvoll nutzen"),
    e("erntedank", "Erntedank", nthWeekday(year, 10, 0, 1), ["herbst", "küche"], "saisonale Ernte in der Küche verwerten"),
    e("zeitumstellung-winter", "Zeitumstellung auf Winterzeit", nthWeekday(year, 10, 0, -1), ["zeitumstellung", "praktisch"], "an welche Uhren und Geräte man denken sollte"),
    e("halloween", "Halloween", utc(year, 10, 31), ["anlass", "deko", "kinder"], "Deko und Kürbis mit wenig Aufwand"),
    e("st-martin", "St. Martin", utc(year, 11, 11), ["kinder", "laterne"], "Laternen basteln und Umzug vorbereiten"),
    e("black-friday", "Black Friday", addDays(nthWeekday(year, 11, 4, 4), 1), ["shopping", "verbraucher"], "überlegt kaufen statt Impulskäufe"),
    e("erster-advent", "Erster Advent", firstAdvent, ["advent", "deko"], "Adventsdeko und Vorbereitung ohne Stress"),
    e("nikolaus", "Nikolaus", utc(year, 12, 6), ["kinder", "geschenk"], "kleine Nikolausideen"),
    e("winteranfang", "Winteranfang", utc(year, 12, 21), ["jahreszeit", "winter"], "Wohnung im Winter warm und trocken halten"),
    e("weihnachten", "Weihnachten", utc(year, 12, 24), ["feiertag", "familie", "geschenk"], "Weihnachten entspannt vorbereiten"),
    e("silvester", "Silvester", utc(year, 12, 31), ["feiertag", "party"], "Silvesterabend zuhause vorbereiten"),
  ];
}

export function calendarSource(windowDays = 21): TopicSource {
  return {
    id: "calendar", offline: true, configured: () => true,
    async fetch({ now }) {
      const today = utc(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate());
      const events = [...germanCalendar(now.getUTCFullYear()), ...germanCalendar(now.getUTCFullYear() + 1)];
      return events.flatMap((event): RawSignal[] => {
        const days = Math.round((event.date.getTime() - today.getTime()) / 86_400_000);
        if (days < 0 || days > windowDays) return [];
        // Content needs lead time: strongest 3-10 days ahead, weaker on the day itself or far ahead.
        const strength = days >= 3 && days <= 10 ? 0.7 : days < 3 ? 0.55 : 0.4;
        return [{ source: "calendar", kind: "calendar", title: `${event.title} am ${event.date.toLocaleDateString("de-DE", { day: "numeric", month: "long", timeZone: "UTC" })}`,
          snippet: event.angle, url: null, publisher: null, publisherUrl: null, publishedAt: null, eventDate: iso(event.date), fetchedAt: now.toISOString(), strength,
          tags: [event.key, ...event.tags] }];
      });
    },
  };
}

// Curated practical everyday topics with the months in which they are most relevant. These are questions and
// problems, not claims; the content still has to be written without invented facts.
type Evergreen = { title: string; problem: string; months: number[]; tags: string[] };
export const EVERGREEN_TOPICS: Evergreen[] = [
  { title: "Beschlagene Fenster und feuchte Wände im Herbst", problem: "Kondenswasser an Fenstern, wenn es draußen kalt wird", months: [10, 11, 12, 1, 2], tags: ["lüften", "haushalt", "herbst"] },
  { title: "Richtig lüften in der Heizsaison", problem: "Unsicherheit, wie oft und wie lange man im Winter lüften sollte", months: [10, 11, 12, 1, 2, 3], tags: ["lüften", "heizen", "haushalt"] },
  { title: "Heizkosten im Alltag im Blick behalten", problem: "Heizen kostet, viele kennen einfache Stellschrauben nicht", months: [10, 11, 12, 1, 2], tags: ["heizen", "sparen", "haushalt"] },
  { title: "Kürbis verarbeiten ohne Kampf am Schneidebrett", problem: "Harte Kürbisschale ist schwer zu schneiden", months: [9, 10, 11], tags: ["küche", "herbst", "kochen"] },
  { title: "Laub und Herbstschmutz im Eingangsbereich", problem: "Nasses Laub und Schmutz werden in die Wohnung getragen", months: [10, 11], tags: ["reinigung", "ordnung", "herbst"] },
  { title: "Kleiderschrank auf Herbst und Winter umräumen", problem: "Sommerkleidung blockiert Platz für dicke Jacken", months: [9, 10, 11], tags: ["ordnung", "kleidung"] },
  { title: "Backofen reinigen ohne stundenlanges Schrubben", problem: "Eingebrannte Reste im Backofen", months: [11, 12, 1], tags: ["reinigung", "küche"] },
  { title: "Kühlschrank sinnvoll ordnen", problem: "Lebensmittel werden vergessen und verderben", months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], tags: ["ordnung", "küche", "lebensmittel"] },
  { title: "Reste vom Wochenende clever verwerten", problem: "Übrig gebliebenes Essen landet im Müll", months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], tags: ["küche", "lebensmittel"] },
  { title: "Kabelchaos am Schreibtisch und Fernseher", problem: "Kabel liegen sichtbar herum und stauben ein", months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], tags: ["ordnung", "technik"] },
  { title: "Kalkflecken in Bad und Küche", problem: "Kalk an Armaturen und Duschwand kommt immer wieder", months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], tags: ["reinigung", "bad"] },
  { title: "Wäsche trocknen in der Wohnung", problem: "Wäsche trocknet im Winter drinnen langsam und es wird feucht", months: [10, 11, 12, 1, 2, 3], tags: ["wäsche", "lüften", "haushalt"] },
  { title: "Frühjahrsputz in sinnvoller Reihenfolge", problem: "Großputz wirkt überwältigend", months: [3, 4], tags: ["reinigung", "frühjahr"] },
  { title: "Balkon und Garten startklar machen", problem: "Nach dem Winter ist der Balkon ungenutzt und unordentlich", months: [3, 4, 5], tags: ["garten", "draußen"] },
  { title: "Wohnung bei Hitze kühl halten", problem: "Räume heizen sich im Sommer stark auf", months: [6, 7, 8], tags: ["hitze", "sommer", "haushalt"] },
  { title: "Fruchtfliegen in der Küche", problem: "Obstfliegen tauchen im Spätsommer massenhaft auf", months: [7, 8, 9], tags: ["küche", "sommer"] },
  { title: "Koffer packen ohne Vergessen", problem: "Wichtiges bleibt beim Packen zuhause", months: [5, 6, 7, 8], tags: ["reise", "ordnung"] },
  { title: "Brotdose und Schulstart organisieren", problem: "Morgendliche Hektik vor Schule und Arbeit", months: [8, 9], tags: ["familie", "küche"] },
  { title: "Geschenke rechtzeitig und entspannt planen", problem: "Geschenke werden auf den letzten Drücker gekauft", months: [11, 12], tags: ["geschenk", "advent"] },
  { title: "Kleine Wohnung, mehr Stauraum", problem: "Zu wenig Platz für Alltagsdinge", months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], tags: ["ordnung", "wohnen"] },
  { title: "Mikrowelle und Wasserkocher sauber halten", problem: "Kleine Küchengeräte verschmutzen schnell", months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], tags: ["reinigung", "küche"] },
  { title: "Gemütliche Beleuchtung an dunklen Abenden", problem: "Früh dunkle Abende wirken trist", months: [10, 11, 12, 1, 2], tags: ["deko", "wohnen", "herbst"] },
];

export function evergreenSource(limit = 6): TopicSource {
  return {
    id: "evergreen", offline: true, configured: () => true,
    async fetch({ now }) {
      const month = now.getUTCMonth() + 1;
      const dayOfYear = Math.floor((now.getTime() - Date.UTC(now.getUTCFullYear(), 0, 1)) / 86_400_000);
      const seasonal = EVERGREEN_TOPICS.filter(topic => topic.months.length < 12 && topic.months.includes(month));
      const always = EVERGREEN_TOPICS.filter(topic => topic.months.length === 12);
      // Deterministic daily rotation so consecutive days do not propose the same evergreen topics.
      const rotate = <T,>(items: T[]) => items.map((_, index) => items[(index + dayOfYear) % items.length]);
      const picked = [...rotate(seasonal).slice(0, Math.ceil(limit * 0.66)), ...rotate(always)].slice(0, limit);
      return picked.map((topic): RawSignal => ({ source: "evergreen", kind: "evergreen", title: topic.title, snippet: topic.problem, url: null, publisher: null, publisherUrl: null,
        publishedAt: null, eventDate: null, fetchedAt: now.toISOString(), strength: topic.months.length < 12 ? 0.45 : 0.3,
        tags: topic.months.length === 12 ? [...topic.tags, "ganzjährig"] : topic.tags }));
    },
  };
}
