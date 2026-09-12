"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  Layers,
  LoaderCircle,
  MapPin,
  Plus,
  TriangleAlert,
  Users,
} from "lucide-react";
import { AppHeader } from "@/components/app-header";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { roomBoundarySegments, type RoomBorder } from "@/lib/event";
import {
  workspacePath,
  type WorkspaceInput,
  type WorkspaceSummary,
} from "@/lib/workspaces";
function miniBorderPath(border: RoomBorder) {
  return border.side === "east" || border.side === "west"
    ? `M${border.coordinate * 20} ${border.start * 20}V${border.end * 20}`
    : `M${border.start * 20} ${border.coordinate * 20}H${border.end * 20}`;
}
function MiniPlan({ workspace }: { workspace: WorkspaceSummary }) {
  const mapWidth = workspace.width * 20;
  const mapHeight = workspace.height * 20;
  const boundary = roomBoundarySegments(workspace).map(miniBorderPath).join(" ");
  return (
    <div
      className={`mini-plan ${workspace.items.length ? "" : "blank"}`}
      aria-hidden="true"
    >
      <svg viewBox={`-18 -18 ${mapWidth + 36} ${mapHeight + 36}`}>
        <defs>
          <pattern
            id={`mini-${workspace.id}`}
            width="20"
            height="20"
            patternUnits="userSpaceOnUse"
          >
            <path d="M20 0H0V20" fill="none" stroke="#e1e8ee" strokeWidth="1" />
          </pattern>
          <clipPath id={`mini-room-${workspace.id}`}>
            {workspace.roomRectangles.map((room, index) => (
              <rect key={index} x={room.x * 20} y={room.y * 20}
                width={room.w * 20} height={room.h * 20} />
            ))}
          </clipPath>
        </defs>
        <g clipPath={`url(#mini-room-${workspace.id})`}>
          <rect width={mapWidth} height={mapHeight} fill="#fff" />
          <rect width={mapWidth} height={mapHeight} fill={`url(#mini-${workspace.id})`} />
        </g>
        <path d={boundary} fill="none" stroke="#aebed0" strokeWidth="2.5" />
        {workspace.items.map((i) => (
          <rect
            key={i.id}
            x={i.x * 20}
            y={i.y * 20}
            width={i.w * 20}
            height={i.h * 20}
            rx="6"
            fill={
              i.kind === "obstacle"
                ? "#dce3eb"
                : i.kind === "food"
                  ? "#f3d5a1"
                  : i.kind === "reception"
                    ? "#bde5d2"
                    : i.kind === "stairs"
                      ? "#cbd0ee"
                      : i.kind === "emergency_exit"
                        ? "#b6e4c9"
                        : i.kind === "stage"
                          ? "#d9c9eb"
                          : i.kind === "seating"
                            ? "#c9d5e9"
                            : i.kind === "restroom"
                              ? "#c5e6ec"
                  : i.company
                    ? "#c9d9f0"
                    : "#f0f4f9"
            }
            stroke={i.company ? "#9db7d9" : "#c5d0dd"}
            strokeDasharray={
              i.kind === "booth" && !i.company ? "5 4" : undefined
            }
          />
        ))}
        {!workspace.items.length && (
          <text
            x={mapWidth / 2}
            y={mapHeight / 2 + 8}
            textAnchor="middle"
            fill="#7a8ba1"
            fontSize="25"
          >
            Empty floor plan
          </text>
        )}
      </svg>
    </div>
  );
}
export function WorkspaceHub({ admin = false }: { admin?: boolean }) {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [venue, setVenue] = useState("");
  const [template, setTemplate] = useState<"blank" | "sample" | "reference">("blank");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [created, setCreated] = useState<WorkspaceSummary | null>(null);
  const [removing, setRemoving] = useState<WorkspaceSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [removeError, setRemoveError] = useState("");
  const [renaming, setRenaming] = useState<WorkspaceSummary | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renameError, setRenameError] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);
  const renameInFlight = useRef(false);
  const renameTrigger = useRef<HTMLButtonElement | null>(null);
  const saving = useRef(false);
  const attempt = useRef<{ payload: string; requestId: string } | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/workspaces", { cache: "no-store" });
      const data = (await r.json()) as {
        workspaces: WorkspaceSummary[];
        error?: string;
      };
      if (!r.ok) throw new Error(data.error || "Could not load workspaces");
      setWorkspaces(data.workspaces);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function create(values: {
    name: string;
    venue: string;
    template: "blank" | "sample" | "reference";
  }) {
    if (!admin) throw new Error("Open Admin to create a workspace.");
    if (saving.current)
      throw new Error("A workspace is already being created.");
    const normalized = {
      name: values.name.trim(),
      venue: values.venue.trim(),
      template: values.template,
    };
    if (
      !normalized.name ||
      normalized.name.length > 80 ||
      !normalized.venue ||
      normalized.venue.length > 100 ||
      !["blank", "sample", "reference"].includes(normalized.template)
    )
      throw new Error(
        "Enter a workspace name, venue, and a valid starting layout.",
      );
    const payload = JSON.stringify(normalized);
    if (attempt.current?.payload !== payload)
      attempt.current = { payload, requestId: crypto.randomUUID() };
    saving.current = true;
    setCreating(true);
    setCreateError("");
    try {
      const r = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...normalized,
          requestId: attempt.current.requestId,
        } satisfies WorkspaceInput),
      });
      const data = (await r.json()) as {
        workspace: WorkspaceSummary;
        error?: string;
      };
      if (!r.ok) throw new Error(data.error || "Could not create workspace");
      setWorkspaces((existing) => [
        data.workspace,
        ...existing.filter((w) => w.id !== data.workspace.id),
      ]);
      setCreated(data.workspace);
      setName("");
      setVenue("");
      setTemplate("blank");
      attempt.current = null;
      toast.success(`${data.workspace.name} is ready.`);
      return data.workspace;
    } catch (e) {
      setCreateError((e as Error).message);
      throw e;
    } finally {
      saving.current = false;
      setCreating(false);
    }
  }
  async function remove() {
    if (!admin || !removing || deleting) return;
    setDeleting(true);
    setRemoveError("");
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(removing.id)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error || "Could not remove the workspace.");
      }
      setWorkspaces((existing) => existing.filter((w) => w.id !== removing.id));
      setCreated((current) => current?.id === removing.id ? null : current);
      toast.success(`${removing.name} was removed.`);
      setRemoving(null);
    } catch (e) {
      setRemoveError((e as Error).message);
    } finally {
      setDeleting(false);
    }
  }
  async function rename() {
    if (!admin || !renaming || renameInFlight.current) return;
    const nextName = renameName.trim();
    if (!nextName || nextName.length > 80) {
      setRenameError("Enter a workspace name between 1 and 80 characters.");
      return;
    }
    renameInFlight.current = true;
    setRenameSaving(true);
    setRenameError("");
    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(renaming.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nextName, revision: renaming.revision }),
      });
      const data = await response.json() as { workspace: WorkspaceSummary; error?: string };
      if (!response.ok) {
        if (response.status === 409) {
          // Refresh the revision without discarding the user's draft name.
          const latest = await fetch("/api/workspaces", { cache: "no-store" });
          if (latest.ok) {
            const list = await latest.json() as { workspaces: WorkspaceSummary[] };
            setWorkspaces(list.workspaces);
            const current = list.workspaces.find(w => w.id === renaming.id);
            if (current) setRenaming(current);
          }
        }
        throw new Error(data.error || "Could not rename the workspace. Please retry.");
      }
      setWorkspaces(existing => existing.map(w => w.id === data.workspace.id ? data.workspace : w));
      setCreated(current => current?.id === data.workspace.id ? data.workspace : current);
      setRenaming(null);
      toast.success(`Workspace renamed to ${data.workspace.name}.`);
    } catch (e) {
      setRenameError((e as Error).message);
    } finally {
      renameInFlight.current = false;
      setRenameSaving(false);
    }
  }
  const action = useRef(create);
  action.current = create;
  useEffect(() => {
    if (!admin) return;
    const context = (
      document as unknown as {
        modelContext?: {
          registerTool: (
            tool: unknown,
            options: unknown,
          ) => void | Promise<void>;
        };
      }
    ).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    try {
      void Promise.resolve(
        context.registerTool(
          {
            name: "create_workspace",
            title: "Create workspace",
            description:
              "Create a saved event workspace from the Admin page and add it to the visible workspace list.",
            inputSchema: {
              type: "object",
              properties: {
                name: { type: "string", minLength: 1, maxLength: 80 },
                venue: { type: "string", minLength: 1, maxLength: 100 },
                template: { type: "string", enum: ["blank", "sample", "reference"] },
              },
              required: ["name", "venue", "template"],
              additionalProperties: false,
            },
            annotations: { readOnlyHint: false, untrustedContentHint: false },
            execute: async (input: unknown) => {
              const v = input as {
                name: string;
                venue: string;
                template: "blank" | "sample" | "reference";
              };
              if (
                !v ||
                typeof v.name !== "string" ||
                typeof v.venue !== "string" ||
                !["blank", "sample", "reference"].includes(v.template)
              )
                throw new Error(
                  "Provide a name, venue, and blank, sample, or reference template.",
                );
              const record = await action.current(v);
              return {
                id: record.id,
                name: record.name,
                url: workspacePath(record.id),
              };
            },
          },
          { signal: lifecycle.signal },
        ),
      ).catch(() => {});
    } catch {}
    return () => lifecycle.abort();
  }, [admin]);
  return (
    <div className="app-shell">
      <Toaster theme="light" position="bottom-center" />
      <AppHeader current={admin ? "admin" : "workspaces"} />
      <main className="hub-main">
        <div className="hub-heading">
          <div>
            <h1>{admin ? "Manage workspaces" : "Floor plans"}</h1>
          </div>
          {!admin && (
            <Button asChild variant="outline">
              <a href="/admin">
                <Plus /> Create a workspace
              </a>
            </Button>
          )}
        </div>
        <div className={admin ? "admin-layout" : ""}>
          <section aria-label="Workspaces" className="workspace-directory">
            <div className="directory-heading">
              <h2>
                {admin ? "All workspaces" : "Your workspaces"}
                <span className="count-badge">
                  {loading ? "…" : workspaces.length}
                </span>
              </h2>
            </div>
            {loading ? (
              <div className="hub-empty" role="status">
                <LoaderCircle className="spin" />
                Loading workspaces…
              </div>
            ) : error ? (
              <div className="hub-empty" role="alert">
                <TriangleAlert />
                <p>{error}</p>
                <Button onClick={() => void load()} variant="outline">
                  Try again
                </Button>
              </div>
            ) : workspaces.length === 0 ? (
              <div className="hub-empty">
                <Layers />
                <h3>No workspaces yet</h3>
                <p>Create your first workspace in Admin to get started.</p>
                {!admin && (
                  <Button asChild>
                    <a href="/admin">Open Admin</a>
                  </Button>
                )}
              </div>
            ) : (
              <div
                className={admin ? "admin-workspace-list" : "workspace-cards"}
              >
                {workspaces.map((w) => {
                  const details = (
                    <div className="workspace-card-body">
                      <div className="workspace-card-heading">
                        <h3>{w.name}</h3>
                        {w.id === "main" && (
                          <span className="sample-badge">Sample</span>
                        )}
                      </div>
                      <p>{!admin && <MapPin size={14} />}{w.venue}</p>
                      <div className="workspace-card-meta">
                        <span>{!admin && <GridIcon />}{w.booths} booths</span>
                        <span>{!admin && <Users size={14} />}{w.booked} booked</span>
                      </div>
                    </div>
                  );
                  const open = (
                    <div className="workspace-card-open">
                      Open {!admin && <ArrowRight size={17} />}
                    </div>
                  );
                  return admin ? (
                    <div className="admin-workspace-row" key={w.id}>
                      <a className="admin-workspace-link" href={workspacePath(w.id)} aria-label={`Open ${w.name}`}>
                        {details}{open}
                      </a>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        aria-label={`Rename ${w.name}`}
                        onClick={(e) => {
                          renameTrigger.current = e.currentTarget;
                          setRenameError(""); setRenameName(w.name); setRenaming(w);
                        }}
                      >
                        Rename
                      </Button>
                      {w.id !== "main" && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="admin-remove-button"
                          onClick={() => { setRemoveError(""); setRemoving(w); }}
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                  ) : (
                    <a className="workspace-card" key={w.id} href={workspacePath(w.id)} aria-label={`Open ${w.name}`}>
                      <MiniPlan workspace={w} />{details}{open}
                    </a>
                  );
                })}
              </div>
            )}
          </section>
          {admin && (
            <aside className="create-workspace-panel">
              <h2>Create workspace</h2>
              <form
                className="edit-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void create({ name, venue, template }).catch((e) =>
                    setCreateError((e as Error).message),
                  );
                }}
              >
                <label>
                  Workspace name
                  <Input
                    required
                    maxLength={80}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Robotics Expo 2026"
                    disabled={creating}
                  />
                </label>
                <label>
                  Venue
                  <Input
                    required
                    maxLength={100}
                    value={venue}
                    onChange={(e) => setVenue(e.target.value)}
                    placeholder="e.g. University Center, Main hall"
                    disabled={creating}
                  />
                </label>
                <label>
                  Starting layout
                  <Select
                    value={template}
                    onValueChange={(v) => setTemplate(v as "blank" | "sample" | "reference")}
                    disabled={creating}
                  >
                    <SelectTrigger
                      aria-label="Starting layout"
                      className="w-full"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="blank">Blank hall</SelectItem>
                      <SelectItem value="sample">Sample exhibition</SelectItem>
                      <SelectItem value="reference">Café &amp; stage floor plan</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
                {template === "reference" && <p className="reference-layout-note">Inspired by the supplied floor plan: stepped hall, café, stage, restrooms, and lounge. Dimensions are approximate and editable.</p>}
                {createError && (
                  <p role="alert" className="form-error">
                    {createError}
                  </p>
                )}
                <Button
                  type="submit"
                  className="full-button"
                  disabled={creating || !name.trim() || !venue.trim()}
                >
                  {creating ? <LoaderCircle className="spin" /> : <Plus />}
                  {creating ? "Creating…" : "Create workspace"}
                </Button>
              </form>
              {created && (
                <div className="workspace-created" role="status">
                  <Check size={18} />
                  <div>
                    <b>{created.name} is ready</b>
                    <a href={workspacePath(created.id)}>
                      Open workspace <ArrowRight size={14} />
                    </a>
                  </div>
                </div>
              )}
            </aside>
          )}
        </div>
        <div className="brand-signature" aria-hidden="true">
          <span className="brand-signature-word"><strong>travel</strong><em>space</em></span>
          <span className="brand-signature-rule" />
        </div>
      </main>
      <Dialog open={!!renaming} onOpenChange={(open) => {
        if (!open && !renameInFlight.current) setRenaming(null);
      }}>
        <DialogContent
          showCloseButton={!renameSaving}
          onCloseAutoFocus={(e) => { e.preventDefault(); renameTrigger.current?.focus(); }}
        >
          <DialogHeader>
            <DialogTitle>Rename workspace</DialogTitle>
            <DialogDescription className="break-words">Current name: {renaming?.name}</DialogDescription>
          </DialogHeader>
          <form className="edit-form" onSubmit={(e) => { e.preventDefault(); void rename(); }}>
            <label htmlFor="rename-workspace-name">
              Workspace name
              <Input
                id="rename-workspace-name"
                required
                maxLength={80}
                value={renameName}
                disabled={renameSaving}
                onFocus={(e) => e.target.select()}
                onChange={(e) => { setRenameName(e.target.value); setRenameError(""); }}
                aria-invalid={!!renameError}
                aria-describedby={renameError ? "rename-workspace-error" : undefined}
              />
            </label>
            {renameError && <p id="rename-workspace-error" role="alert" className="form-error">{renameError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={renameSaving} onClick={() => setRenaming(null)}>Cancel</Button>
              <Button type="submit" disabled={renameSaving || !renameName.trim() || renameName.trim() === renaming?.name}>
                {renameSaving && <LoaderCircle className="spin" />}
                {renameSaving ? "Saving…" : "Save name"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={!!removing}
        onOpenChange={(open) => { if (!open && !deleting) setRemoving(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removing?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the workspace, its floor plan, and its bookings. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {removeError && <p role="alert" className="form-error">{removeError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <Button type="button" variant="destructive" disabled={deleting} onClick={() => void remove()}>
              {deleting ? "Removing…" : "Remove workspace"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
function GridIcon() {
  return <Layers size={14} />;
}
