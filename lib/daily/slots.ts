// Daily slots are local time windows, not points in time. A cron invocation that
// arrives early, late or twice inside a window addresses the same (day, slot).
export type DailySlot = "morning" | "afternoon";
export const SLOT_TIME_ZONE = "Europe/Berlin";

// Local Berlin hours, [from, until). Vercel Hobby crons may fire anywhere inside
// their scheduled UTC hour, and CET/CEST shift the UTC hours by one; the windows
// are wide enough that at least two scheduled invocations fall into each of them
// in both seasons, so a failed first attempt has a retry.
export const SLOT_WINDOWS: Record<DailySlot, { from: number; until: number }> = {
  morning: { from: 9, until: 14 },
  afternoon: { from: 18, until: 23 },
};

export function berlinClock(now: Date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: SLOT_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now).map(part => [part.type, part.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), time: `${parts.hour}:${parts.minute}` };
}

// One instant yields day and slot together, so they can never disagree.
export function resolveSlot(now: Date) {
  const clock = berlinClock(now);
  const slot = (Object.keys(SLOT_WINDOWS) as DailySlot[])
    .find(name => clock.hour >= SLOT_WINDOWS[name].from && clock.hour < SLOT_WINDOWS[name].until) ?? null;
  return { slot, day: clock.day, localTime: clock.time, timeZone: SLOT_TIME_ZONE, utc: now.toISOString() };
}
