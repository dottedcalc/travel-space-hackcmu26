import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Shield,
  Users,
} from "lucide-react";
import { AppHeader } from "@/components/app-header";
import {
  workspacePath,
  workspaceRoles,
  type WorkspaceRecord,
} from "@/lib/workspaces";
export function WorkspaceGateway({
  workspace,
}: {
  workspace: WorkspaceRecord;
}) {
  const icons = { organizer: Shield, exhibitioner: Building2, visitor: Users };
  const labels = {
    organizer: { title: "Organizer", action: "Plan event" },
    exhibitioner: { title: "Exhibitor", action: "Book a booth" },
    visitor: { title: "Visitor", action: "Plan a visit" },
  };
  return (
    <div className="app-shell">
      <AppHeader
        current="workspace"
        workspace={{ id: workspace.id, name: workspace.event.name }}
      />
      <main className="hub-main gateway-main">
        <a href="/" className="workspace-back">
          <ArrowLeft size={15} />
          All workspaces
        </a>
        <div className="gateway-heading">
          <h1>{workspace.event.name}</h1>
        </div>
        <div className="role-cards">
          {workspaceRoles.map((role) => {
            const Icon = icons[role.id];
            const copy = labels[role.id];
            return (
              <a
                className={`role-card role-${role.id}`}
                key={role.id}
                href={workspacePath(workspace.id, role.id)}
                aria-label={`Enter as ${copy.title}`}
              >
                <div className="role-card-top">
                  <span className="role-symbol">
                    <Icon size={29} />
                  </span>
                </div>
                <h2>{copy.title}</h2>
                <div className="role-card-action">
                  {copy.action}
                  <ArrowRight size={18} />
                </div>
              </a>
            );
          })}
        </div>
        <div className="brand-signature" aria-hidden="true">
          <span className="brand-signature-word"><strong>travel</strong><em>space</em></span>
          <span className="brand-signature-rule" />
        </div>
      </main>
    </div>
  );
}
export function WorkspaceUnavailable() {
  return (
    <div className="app-shell">
      <AppHeader />
      <main className="hub-main">
        <div className="hub-empty" role="alert">
          <h1>This workspace is unavailable</h1>
          <p>We couldn’t connect to its saved layout. Please try again.</p>
          <a href="/" className="workspace-back">
            <ArrowLeft size={15} />
            Back to home
          </a>
        </div>
      </main>
    </div>
  );
}
