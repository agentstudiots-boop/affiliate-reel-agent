import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Anmeldung – Affiliate Content Studio",
  robots: { index: false, follow: false },
};

const MESSAGES: Record<string, string> = {
  invalid: "Anmeldung fehlgeschlagen. Bitte den Zugangscode prüfen.",
  limited: "Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen.",
  origin: "Anmeldung nur direkt über diese Seite möglich.",
  expired: "Die Sitzung ist abgelaufen. Bitte erneut anmelden.",
};

// Operator login for the internal studio and command center. Plain form post (no JavaScript needed); the
// server sets an HttpOnly session cookie. Public pages (/produkte, /impressum, /datenschutz) need no login.
export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const error = typeof params.error === "string" ? MESSAGES[params.error] : undefined;
  const next = typeof params.next === "string" ? params.next : "/";
  return (
    <main>
      <section className="panel" style={{ maxWidth: 440, margin: "10vh auto 0" }}>
        <div className="panelTitle"><span>🔒</span><div><h2>Content Studio – Anmeldung</h2><p>Interner Bereich für den Betreiber.</p></div></div>
        {params.loggedOut && <p className="success">Abgemeldet.</p>}
        {error && <p className="error" role="alert">{error}</p>}
        <form method="post" action="/api/auth/login">
          <input type="hidden" name="next" value={next} />
          <label>Zugangscode<input name="password" type="password" required autoComplete="current-password" maxLength={256} autoFocus /></label>
          <button className="primary" type="submit">Anmelden</button>
        </form>
        <small>Die Sitzung gilt 12 Stunden und endet mit „Abmelden“. Der Zugangscode wird nicht im Browser gespeichert.</small>
      </section>
    </main>
  );
}
