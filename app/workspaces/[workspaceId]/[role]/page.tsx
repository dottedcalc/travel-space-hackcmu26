import { notFound } from "next/navigation";
import { loadEvent } from "@/db/event-store";
import { workspaceRoles, type WorkspaceRole } from "@/lib/workspaces";
import EventWorkspace from "@/components/event-workspace";
import { WorkspaceUnavailable } from "@/components/workspace-gateway";
export const dynamic = "force-dynamic";
export async function generateMetadata({ params }: { params: Promise<{ role: string }> }) {
  const { role } = await params;
  return { title: `${workspaceRoles.find(item => item.id === role)?.label || "Workspace"} — TravelSpace` };
}
export default async function RolePage({
  params,
}: {
  params: Promise<{ workspaceId: string; role: string }>;
}) {
  const { workspaceId, role } = await params;
  if (!workspaceRoles.some((r) => r.id === role)) notFound();
  let workspace;
  try {
    workspace = await loadEvent(workspaceId);
  } catch {
    return <WorkspaceUnavailable />;
  }
  if (!workspace) notFound();
  return (
    <EventWorkspace
      key={`${workspaceId}-${role}`}
      initialWorkspace={workspace}
      role={role as WorkspaceRole}
    />
  );
}
