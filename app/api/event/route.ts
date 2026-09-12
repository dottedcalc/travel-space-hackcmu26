import {
  getWorkspaceResponse,
  updateWorkspaceResponse,
} from "@/lib/workspace-api";
export const dynamic = "force-dynamic";
export async function GET() {
  return getWorkspaceResponse("main");
}
export async function PUT(request: Request) {
  return updateWorkspaceResponse(request, "main");
}
