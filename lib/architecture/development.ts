import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

// Development status for the Command Center (task D-06): the state of the roadmap tasks from the hand-over files
// (docs/ai-business/coordination/tasks/<ID>/task.json, traced into the deployment, i.e. the state of the build). Only the task
// id, phase and status are read – titles, logs, file lists and every other field stay out of the response. A file that does
// not fit (wrong name, unknown status, too large, broken JSON) is counted as skipped, never guessed. Missing folder ⇒ the view
// says so instead of showing an empty project.

export const TASK_STATUSES = ["planned", "ready", "in_progress", "waiting_capacity", "waiting_review", "waiting_operator", "in_review",
  "changes_requested", "approved_by_reviewer", "merged", "deployed", "verified", "blocked", "cancelled", "superseded"] as const;
const PHASES = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"] as const;
const MAX_FILES = 200;
const MAX_BYTES = 64 * 1024;
export const DEVELOPMENT_SOURCE = "docs/ai-business/coordination/tasks/*/task.json";

// The only fields taken from a hand-over file.
const handOver = z.object({ task_id: z.string().regex(/^[A-J]-[0-9]{2}$/), phase: z.enum(PHASES), status: z.enum(TASK_STATUSES) });
const developmentTaskSchema = z.object({ id: z.string(), phase: z.enum(PHASES), status: z.enum(TASK_STATUSES) });
export const developmentViewSchema = z.object({
  available: z.boolean(),
  reason: z.string().nullable(),
  source: z.literal(DEVELOPMENT_SOURCE),
  tasks: z.array(developmentTaskSchema),
  byStatus: z.record(z.string(), z.number().int().nonnegative()),
  skipped: z.number().int().nonnegative(),
});
export type DevelopmentView = z.infer<typeof developmentViewSchema>;
export type HandOverFile = { folder: string; content: string };

export function buildDevelopmentView(files: readonly HandOverFile[] | null, reason: string | null = null): DevelopmentView {
  if (!files) return { available: false, reason: reason ?? "Übergabedateien nicht im Build enthalten", source: DEVELOPMENT_SOURCE, tasks: [], byStatus: {}, skipped: 0 };
  const tasks: DevelopmentView["tasks"] = [];
  let skipped = 0;
  for (const file of files) {
    let parsed: z.infer<typeof handOver> | null = null;
    try {
      const checked = handOver.safeParse(JSON.parse(file.content));
      parsed = checked.success && checked.data.task_id === file.folder && checked.data.task_id.startsWith(checked.data.phase) ? checked.data : null;
    } catch { parsed = null; }
    if (!parsed || tasks.some(task => task.id === parsed!.task_id)) { skipped++; continue; }
    tasks.push({ id: parsed.task_id, phase: parsed.phase, status: parsed.status });
  }
  tasks.sort((a, b) => a.id.localeCompare(b.id));
  const byStatus: Record<string, number> = {};
  for (const task of tasks) byStatus[task.status] = (byStatus[task.status] ?? 0) + 1;
  return developmentViewSchema.parse({ available: tasks.length > 0, reason: tasks.length ? null : reason ?? "keine lesbare Übergabedatei", source: DEVELOPMENT_SOURCE, tasks, byStatus, skipped });
}

// Never throws: any file system error leaves the view unavailable with a reason.
export function readDevelopmentView(dir = path.join(process.cwd(), "docs", "ai-business", "coordination", "tasks")): DevelopmentView {
  try {
    if (!existsSync(dir)) return buildDevelopmentView(null);
    const files: HandOverFile[] = [];
    let skipped = 0;
    for (const folder of readdirSync(dir).sort().slice(0, MAX_FILES)) {
      const file = path.join(dir, folder, "task.json");
      if (!existsSync(file) || statSync(file).size > MAX_BYTES) { skipped++; continue; }
      files.push({ folder, content: readFileSync(file, "utf8") });
    }
    const view = buildDevelopmentView(files);
    return { ...view, skipped: view.skipped + skipped };
  } catch {
    return buildDevelopmentView(null, "Übergabedateien nicht lesbar");
  }
}
