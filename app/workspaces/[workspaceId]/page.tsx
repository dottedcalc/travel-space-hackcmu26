import { notFound } from "next/navigation";
import { loadEvent } from "@/db/event-store";
import {
  WorkspaceGateway,
  WorkspaceUnavailable,
} from "@/components/workspace-gateway";
export const dynamic = "force-dynamic";
export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  let workspace;
  try {
    workspace = await loadEvent(workspaceId);
  } catch {
    return <WorkspaceUnavailable />;
  }
  if (!workspace) notFound();
  return <WorkspaceGateway workspace={workspace} />;
}
