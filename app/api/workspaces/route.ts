import { z } from "zod";
import { createWorkspace, listWorkspaces } from "@/db/event-store";
export const dynamic = "force-dynamic";
const schema = z
  .object({
    requestId: z.string().uuid(),
    name: z.string().trim().min(1).max(80),
    venue: z.string().trim().min(1).max(100),
    template: z.enum(["blank", "sample", "reference"]),
  })
  .strict();
export async function GET() {
  try {
    return Response.json(
      { workspaces: await listWorkspaces() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    console.error("List workspaces failed", e);
    return Response.json(
      { error: "Workspaces could not be loaded. Please retry." },
      { status: 503 },
    );
  }
}
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return Response.json(
      { error: "Request origin is not allowed" },
      { status: 403 },
    );
  try {
    const raw = await request.text();
    if (raw.length > 4096)
      return Response.json(
        { error: "Workspace details are too long" },
        { status: 413 },
      );
    const parsed = schema.safeParse(JSON.parse(raw));
    if (!parsed.success)
      return Response.json(
        { error: "Enter a workspace name, venue, and starting layout." },
        { status: 400 },
      );
    return Response.json(
      { workspace: await createWorkspace(parsed.data) },
      { status: 201 },
    );
  } catch (e) {
    if (e instanceof SyntaxError)
      return Response.json(
        { error: "Invalid workspace details" },
        { status: 400 },
      );
    console.error("Create workspace failed", e);
    return Response.json(
      {
        error:
          "We couldn’t create this workspace. Your details are still here; please retry.",
      },
      { status: 503 },
    );
  }
}
