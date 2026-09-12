import { ArrowLeft, ChevronRight, Shield } from "lucide-react";
import { workspacePath } from "@/lib/workspaces";
export function AppHeader({
  current = "home",
  workspace,
}: {
  current?: "home" | "admin" | "workspace" | "workspaces";
  workspace?: { id: string; name: string };
}) {
  return (
    <header className="topbar hub-topbar">
      <a className="wordmark" href="/" aria-label="TravelSpace home">
        <span className="wordmark-travel">travel</span>
        <span className="wordmark-space">space</span>
      </a>
      <nav aria-label="Main navigation" className="main-nav">
        <a href="/" aria-current={current === "home" ? "page" : undefined}>
          Home
        </a>
        <a href="/workspaces" aria-current={current === "workspaces" ? "page" : undefined}>
          Workspaces
        </a>
        <a
          href="/admin"
          aria-current={current === "admin" ? "page" : undefined}
        >
          <Shield size={15} /> Admin
        </a>
      </nav>
      {workspace && (
        <div className="header-workspace">
          <ChevronRight size={14} />
          <a href={workspacePath(workspace.id)}>{workspace.name}</a>
        </div>
      )}
    </header>
  );
}
export function WorkspaceBack({ id }: { id: string }) {
  return (
    <a className="workspace-back" href={workspacePath(id)}>
      <ArrowLeft size={15} />
      All roles
    </a>
  );
}
