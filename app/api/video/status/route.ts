import { head, put } from "@vercel/blob";
import { getRunwayClient } from "@/lib/runway";
import { authorized, unauthorizedResponse } from "@/lib/memory/auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  // Reads provider tasks and writes to Blob storage: operator only.
  if (!authorized(request)) return unauthorizedResponse();
  const taskId = new URL(request.url).searchParams.get("taskId");
  if (!taskId || !/^[a-zA-Z0-9_-]{8,100}$/.test(taskId)) return Response.json({ error: "Ungültige Runway-Task-ID." }, { status: 400 });
  try {
    const task = await getRunwayClient().tasks.retrieve(taskId);
    if (task.status !== "SUCCEEDED") {
      return Response.json({
        status: task.status,
        progress: task.status === "RUNNING" ? task.progress : 0,
        error: task.status === "FAILED" ? "Runway konnte diesen Clip nicht erzeugen. Es wird nicht automatisch erneut versucht." : undefined,
        costCredits: "cost" in task ? task.cost.credits : undefined,
      });
    }
    const pathname = `reels/${taskId}.mp4`;
    try {
      const existing = await head(pathname);
      return Response.json({ status: task.status, videoUrl: existing.url, costCredits: task.cost.credits });
    } catch { /* Noch nicht dauerhaft archiviert. */ }
    const source = await fetch(task.output[0]);
    if (!source.ok || !source.body) throw new Error("Runway-Video konnte nicht gespeichert werden.");
    const blob = await put(pathname, source.body, {
      access: "public", addRandomSuffix: false, allowOverwrite: false, contentType: "video/mp4",
    });
    return Response.json({ status: task.status, videoUrl: blob.url, costCredits: task.cost.credits });
  } catch {
    console.error(JSON.stringify({ event: "video_status_failed" }));
    return Response.json({ error: "Video-Status konnte nicht geladen werden." }, { status: 502 });
  }
}
