import { randomBytes } from "node:crypto";

export function newContentId(now: Date = new Date()): string {
  const day = now.toISOString().slice(0, 10).replaceAll("-", "");
  return `cnt_${day}_${randomBytes(16).toString("hex")}`;
}
