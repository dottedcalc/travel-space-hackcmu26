import {
  getWorkspaceResponse,
  updateWorkspaceResponse,
} from "@/lib/workspace-api";
import { removeWorkspace } from "@/db/event-store";
import { renameWorkspaceResponse } from "@/lib/workspace-rename";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ workspaceId: string }> };
export async function GET(_request: Request, { params }: Context) {
  return getWorkspaceResponse((await params).workspaceId);
}
export async function PUT(request: Request, { params }: Context) {
  return updateWorkspaceResponse(request, (await params).workspaceId);
}
export async function PATCH(request: Request, { params }: Context) {
  return renameWorkspaceResponse(request, (await params).workspaceId);
}
export async function DELETE(request: Request, { params }: Context) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return Response.json({ error: "Request origin is not allowed" }, { status: 403 });
  try {
    const result = await removeWorkspace((await params).workspaceId);
    if (result === "protected")
      return Response.json({ error: "The built-in sample workspace cannot be removed." }, { status: 403 });
    if (result === "missing")
      return Response.json({ error: "Workspace not found" }, { status: 404 });
    return new Response(null, { status: 204 });
  } catch (e) {
    console.error("Remove workspace failed", e);
    return Response.json({ error: "Could not remove the workspace. Please retry." }, { status: 503 });
  }
}
