import { z } from "zod";
import { loadEvent, saveEvent } from "@/db/event-store";
import { workspaceSummary } from "@/lib/workspaces";

const schema = z.object({
  name: z.string().trim().min(1).max(80),
  revision: z.number().int().min(0),
}).strict();

export async function renameWorkspaceResponse(request: Request, id: string) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return Response.json({ error: "Request origin is not allowed" }, { status: 403 });
  if (Number(request.headers.get("content-length")) > 4096)
    return Response.json({ error: "Workspace details are too long" }, { status: 413 });
  try {
    const raw = await request.text();
    if (raw.length > 4096)
      return Response.json({ error: "Workspace details are too long" }, { status: 413 });
    let details: unknown;
    try { details = JSON.parse(raw); }
    catch {
      return Response.json({ error: "Invalid workspace details" }, { status: 400 });
    }
    const parsed = schema.safeParse(details);
    if (!parsed.success)
      return Response.json({ error: "Enter a workspace name between 1 and 80 characters and a valid revision." }, { status: 400 });
    const current = await loadEvent(id);
    if (!current)
      return Response.json({ error: "Workspace not found" }, { status: 404 });
    const { name, revision } = parsed.data;
    const event = { ...current.event, name };
    if (current.revision !== revision || !(await saveEvent(event, revision, id)))
      return Response.json({ error: "This workspace changed in another window. Review the latest name and try again." }, { status: 409 });
    return Response.json({ workspace: workspaceSummary({ id, event, revision: revision + 1 }) });
  } catch (error) {
    console.error("Rename workspace failed", error);
    return Response.json({ error: "Could not rename the workspace. Your name is still here; please retry." }, { status: 503 });
  }
}
