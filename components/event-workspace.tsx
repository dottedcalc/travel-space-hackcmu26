"use client";
import LayoutInsights from "@/components/layout-insights";
import { evaluateLayoutInsights, rateLayout } from "@/lib/layout-insights";
import ExhibitorReservation from "@/components/exhibitor-reservation";
import SimulationWorker from "@/lib/simulation-worker?worker";
import { startSimulationJob } from "@/lib/simulation-job";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Armchair,
  ArrowUpRight,
  Building2,
  Box,
  Coffee,
  DoorOpen,
  Info,
  Layers,
  LoaderCircle,
  MousePointer2,
  Pause,
  Play,
  Plus,
  Presentation,
  RotateCcw,
  Route,
  Save,
  TicketCheck,
  Toilet,
  Trash2,
  TriangleAlert,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { AppHeader, WorkspaceBack } from "@/components/app-header";
import {
  workspacePath,
  type WorkspaceRecord,
  type WorkspaceRole,
} from "@/lib/workspaces";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import FloorMap from "@/components/floor-map";
import { boothCategories, isBoothCategory } from "@/lib/event";
import { HEAT_LEVELS } from "@/lib/heat-surface";
import { gridMetersFor } from "@/lib/map-display";
import { MAX_MAP_SIZE, MAX_FOOD_WINDOWS, defaultFoodAvailability, foodAvailabilityFor, foodAvailabilityError, allAccessPoints, canPlaceAccessPoint, eventCompanies, eventEntrances, eventExits, objectPresets, processingRateFor, stageLingeringFor, stageSpotlightFor, onRoomBoundary, pointInRoom, rectInsideRoom, resizeRoom, roomRectangles, seedEvent, validRoomShape, withAccessPercentage, withAccessPoints, withoutRoomRectangle, type FairEvent, type FlowPoint, type Item } from "@/lib/event";
import {
  STEP,
  validPosition,
  visitorRoute,
  visitorCrowdCosts,
  gridFor,
  type Simulation,
} from "@/lib/simulation";

type Sync = "loading" | "saved" | "saving" | "error";
function Choice({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  label: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
const paletteObjects = [
  { kind: "booth", Icon: Building2 },
  { kind: "food", Icon: Coffee },
  { kind: "obstacle", Icon: Box },
  { kind: "reception", Icon: TicketCheck },
  { kind: "emergency_exit", Icon: DoorOpen },
  { kind: "stage", Icon: Presentation },
  { kind: "seating", Icon: Armchair },
  { kind: "restroom", Icon: Toilet },
] as const;
const visitorLevels = [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];
const compactVisitors = (count: number) =>
  new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(count);
const visitorLevelIndex = (count: number) =>
  visitorLevels.reduce((best, level, index) =>
    Math.abs(Math.log(level / count)) < Math.abs(Math.log(visitorLevels[best] / count)) ? index : best,
  0);
const clockMinutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
function formatTimeOfDay(value: string) {
  const minutes = clockMinutes(value);
  const hour = Math.floor(minutes / 60);
  return `${hour % 12 || 12}:${String(minutes % 60).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}
function formatPlaybackClock(startTime: string, elapsedSeconds: number) {
  const minutes = clockMinutes(startTime) + Math.floor(elapsedSeconds / 60);
  const hour = Math.floor(minutes / 60) % 24;
  return `${hour % 12 || 12}:${String(minutes % 60).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}
function ItemForm({
  item,
  onSave,
  disabled,
  startTime,
  endTime,
}: {
  startTime: string;
  endTime: string;
  item: Item;
  onSave: (item: Item) => void;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState(() => item.kind === "food"
    ? { ...item, foodAvailability: foodAvailabilityFor(item, { startTime, endTime }) } : item);
  const windows = draft.foodAvailability ?? [];
  const scheduleError = item.kind === "food" ? foodAvailabilityError(windows) : null;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (scheduleError) return;
        onSave(item.kind === "food" ? { ...draft, foodAvailableAt: undefined,
          foodAvailability: [...windows].sort((a, b) => a.start.localeCompare(b.start)) } : draft);
      }}
      className="edit-form"
    >
      {item.kind !== "booth" && (
        <label>
          Name
          <Input
            value={draft.name}
            maxLength={50}
            placeholder="Object name"
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>
      )}
      {["booth", "food", "reception"].includes(item.kind) && (
        <label>
          Average processing speed (people/min)
          <Input type="number" min={0.1} max={120} step={0.1} required
            value={draft.processingRate ?? processingRateFor(draft)}
            onChange={(e) => setDraft({ ...draft, processingRate: Number(e.target.value) })} />
        </label>
      )}
      {(item.kind === "booth" || item.kind === "seating") && (
        <label>
          {item.kind === "seating" ? "Average pause length (seconds)" : "Average visit length (seconds)"}
          <Input type="number" min={10} max={1800} step={1} required value={draft.dwell}
            onChange={(e) => setDraft({ ...draft, dwell: Number(e.target.value) })} />
        </label>
      )}
      {item.kind === "booth" && (
        <>
          <div className="grid gap-3">
            <label htmlFor={`popularity-${item.id}`}>Popularity · {draft.popularity < 1.67 ? "Low" : draft.popularity < 2.34 ? "Medium" : "High"}</label>
            <Slider id={`popularity-${item.id}`} aria-label="Popularity" min={1} max={3} step={0.02}
              aria-valuetext={draft.popularity < 1.67 ? "Low" : draft.popularity < 2.34 ? "Medium" : "High"}
              value={[draft.popularity]} onValueChange={([popularity]) => setDraft({ ...draft, popularity })} />
            <div className="flex justify-between text-xs text-muted-foreground"><span>Low</span><span>High</span></div>
          </div>
          <div>
            <span>Category</span>
            <Select value={isBoothCategory(draft.category) ? draft.category : ""}
              onValueChange={(category) => category && setDraft({ ...draft, category })}>
              <SelectTrigger aria-label="Booth category"><SelectValue placeholder={draft.category || "Choose a category"} /></SelectTrigger>
              <SelectContent>{boothCategories.map((category) =>
                <SelectItem key={category} value={category}>{category}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </>
      )}
      {item.kind === "stage" && (
        <>
          <label>Average lingering time (minutes)
            <Input type="number" min={1} max={120} step={1} required
              value={stageLingeringFor(draft) / 60}
              onChange={(e) => setDraft({ ...draft, stageLingering: Number(e.target.value) * 60 })} />
          </label>
          <div className="grid gap-3">
            <label htmlFor={`spotlight-${item.id}`}>Spotlight strength · {stageSpotlightFor(draft)}%</label>
            <Slider id={`spotlight-${item.id}`} aria-label="Stage spotlight strength" min={0} max={100} step={5}
              value={[stageSpotlightFor(draft)]}
              onValueChange={([stageSpotlight]) => setDraft({ ...draft, stageSpotlight })} />
            <div className="flex justify-between text-xs text-muted-foreground"><span>Off</span><span>Draws everyone</span></div>
          </div>
        </>
      )}
      {item.kind === "food" && (
        <fieldset className="food-availability" disabled={disabled}>
          <legend>Food availability</legend>
          {windows.map((window, index) => (
            <div className="food-window" key={index}>
              <label>From
                <Input type="time" required aria-label={`Food window ${index + 1} start`} value={window.start}
                  onChange={(e) => setDraft({ ...draft, foodAvailability: windows.map((entry, i) =>
                    i === index ? { ...entry, start: e.target.value } : entry) })} />
              </label>
              <label>Until
                <Input type="time" required aria-label={`Food window ${index + 1} end`} value={window.end}
                  onChange={(e) => setDraft({ ...draft, foodAvailability: windows.map((entry, i) =>
                    i === index ? { ...entry, end: e.target.value } : entry) })} />
              </label>
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove food window ${index + 1}`}
                onClick={() => setDraft({ ...draft, foodAvailability: windows.filter((_, i) => i !== index) })}>
                <Trash2 />
              </Button>
            </div>
          ))}
          {!windows.length && <p className="muted">No food service scheduled.</p>}
          <Button type="button" variant="outline" disabled={windows.length >= MAX_FOOD_WINDOWS}
            onClick={() => setDraft({ ...draft, foodAvailability: [...windows, { start: "", end: "" }] })}>
            <Plus /> Add time window
          </Button>
          {scheduleError && <p role="alert" className="text-destructive">{scheduleError}</p>}
        </fieldset>
      )}
      <Button disabled={disabled || !!scheduleError} type="submit" className="full-button">
        <Save /> Apply changes
      </Button>
    </form>
  );
}
function EventSettingsForm({ event, disabled, onSave }: {
  event: FairEvent;
  disabled: boolean;
  onSave: (next: FairEvent) => void;
}) {
  const [name, setName] = useState(event.name);
  const [venue, setVenue] = useState(event.venue || "");
  const [clearance, setClearance] = useState(event.clearance);
  const [startTime, setStartTime] = useState(event.startTime);
  const [endTime, setEndTime] = useState(event.endTime);
  const [timeError, setTimeError] = useState("");
  return (
    <form className="edit-form" onSubmit={(e) => {
      e.preventDefault();
      if (clockMinutes(endTime) - clockMinutes(startTime) < 60) {
        setTimeError("Closing time must be at least one hour after opening.");
        return;
      }
      setTimeError("");
      onSave({ ...event, name: name.trim(), venue: venue.trim(), clearance, startTime, endTime });
    }}>
      <label>Event name
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
      </label>
      <label>Venue
        <Input value={venue} onChange={(e) => setVenue(e.target.value)} maxLength={100} />
      </label>
      <div className="event-hours-fields">
        <label>Event opens
          <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
        </label>
        <label>Event closes
          <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required />
        </label>
      </div>
      {timeError && <p className="form-error" role="alert">{timeError}</p>}
      <label>Minimum gap target
        <Choice value={String(clearance)} label="Minimum gap target"
          options={[0.5, 1, 1.5, 2, 2.5, 3, 4].map((n) => ({
            value: String(n), label: `${n} m`,
          }))} onChange={(v) => setClearance(Number(v))} />
      </label>
      <Button disabled={disabled} className="full-button" type="submit">Save settings</Button>
    </form>
  );
}
function MapSizeForm({ event, disabled, onSave }: {
  event: FairEvent;
  disabled: boolean;
  onSave: (next: FairEvent) => void;
}) {
  const [width, setWidth] = useState(String(event.width));
  const [height, setHeight] = useState(String(event.height));
  const [error, setError] = useState("");
  useEffect(() => {
    setWidth(String(event.width));
    setHeight(String(event.height));
    setError("");
  }, [event.width, event.height]);
  const linkedSize = (value: string, from: number, to: number) =>
    value !== "" && Number.isFinite(Number(value))
      ? String(Math.round(Number(value) * to / from * 2) / 2)
      : "";
  return (
    <form className="map-size-form" onSubmit={(e) => {
      e.preventDefault();
      const next = resizeRoom(event, Number(width), Number(height));
      if (!next) {
        setError("That proportional size would make a room or object too small, overlap another, or cover a door. Choose a different size.");
        return;
      }
      setError("");
      if (next.width !== event.width || next.height !== event.height) onSave(next);
    }}>
      <div className="map-size-heading">
        <div><b>Map size</b></div>
        <div className="map-size-fields">
          <label>Width (m)
            <Input type="number" min="10" max={MAX_MAP_SIZE} step="0.5" required
              value={width} onChange={(e) => {
                setWidth(e.target.value);
                setHeight(linkedSize(e.target.value, event.width, event.height));
              }} disabled={disabled} />
          </label>
          <span aria-hidden="true">×</span>
          <label>Depth (m)
            <Input type="number" min="8" max={MAX_MAP_SIZE} step="0.5" required
              value={height} onChange={(e) => {
                setHeight(e.target.value);
                setWidth(linkedSize(e.target.value, event.height, event.width));
              }} disabled={disabled} />
          </label>
          <Button type="submit" size="sm" disabled={disabled}>Apply size</Button>
        </div>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
    </form>
  );
}
function AddExhibitorForm({ onAdd, disabled }: {
  onAdd: (name: string, category: string) => Promise<boolean>;
  disabled: boolean;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  return (
    <form className="company-add-form" onSubmit={async (e) => {
      e.preventDefault();
      if (await onAdd(name.trim(), category.trim())) {
        setName("");
        setCategory("");
      }
    }}>
      <label>Exhibitor or exhibit name
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={50} required placeholder="e.g. Interactive display" />
      </label>
      <div>
        <span>Category</span>
        <Select value={category} onValueChange={(value) => value && setCategory(value)}>
          <SelectTrigger aria-label="Exhibitor category"><SelectValue placeholder="Choose a category" /></SelectTrigger>
          <SelectContent>{boothCategories.map((value) =>
            <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <Button disabled={disabled || !name.trim() || !category.trim()} type="submit">Add exhibitor</Button>
    </form>
  );
}
function RenameExhibitorForm({ name, onRename, onCancel, disabled }: {
  name: string;
  onRename: (name: string) => Promise<boolean>;
  onCancel: () => void;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState(name);
  return (
    <form className="company-add-form" onSubmit={async (e) => {
      e.preventDefault();
      await onRename(draft.trim());
    }}>
      <label>Exhibit name
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={50} required autoFocus />
      </label>
      <Button type="submit" disabled={disabled || !draft.trim() || draft.trim() === name}>Save name</Button>
      <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
    </form>
  );
}
function DoorForm({
  kind,
  event,
  access,
  onSave,
  onRemove,
  disabled,
}: {
  kind: "entrance" | "exit";
  event: FairEvent;
  access: FlowPoint;
  onSave: (p: FlowPoint, percentage: number) => void;
  onRemove?: () => void;
  disabled: boolean;
}) {
  const [point, setPoint] = useState(access);
  const [error, setError] = useState("");
  const points = kind === "entrance" ? eventEntrances(event) : eventExits(event);
  const total = points.reduce((sum, entry) => sum + entry.flow, 0);
  const [percentage, setPercentage] = useState(Math.round(access.flow / total * 1000) / 10);
  return (
    <form
      className="edit-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (
          !Number.isFinite(percentage) || percentage < (points.length === 1 ? 100 : 0.1) ||
          percentage > (points.length === 1 ? 100 : 99.9) ||
          !canPlaceAccessPoint(event, point, access.id)
        ) {
          setError("Choose an open, unused cell and a valid percentage.");
          return;
        }
        setError("");
        onSave(point, percentage);
      }}
    >
      <div className="form-grid">
        {(["x", "y"] as const).map((key, i) => (
          <label key={key}>
            {key.toUpperCase()} position (m)
            <Input
              required
              type="number"
              min="0"
              max={i === 0 ? event.width - 0.5 : event.height - 0.5}
              step=".5"
              value={Number.isNaN(point[key]) ? "" : point[key]}
              onChange={(e) =>
                setPoint({
                  ...point,
                  [key]: e.target.value === "" ? NaN : Number(e.target.value),
                })
              }
            />
          </label>
        ))}
      </div>
      <label>
        Share of {kind === "entrance" ? "arrivals" : "departures"} (%)
        <Input required type="number" min={points.length === 1 ? 100 : 0.1}
          max={points.length === 1 ? 100 : 99.9} step="0.1" disabled={points.length === 1}
          value={Number.isNaN(percentage) ? "" : percentage}
          onChange={(e) => setPercentage(e.target.value === "" ? NaN : Number(e.target.value))} />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <Button disabled={disabled} className="full-button">
        Update {kind}
      </Button>
      {onRemove && <Button type="button" variant="outline" disabled={disabled} onClick={onRemove}>
        <Trash2 size={15} /> Remove {kind}
      </Button>}
    </form>
  );
}
function suggestAccessLocation(event: FairEvent): { x: number; y: number } | null {
  const points = allAccessPoints(event);
  const candidates: { x: number; y: number }[] = [];
  const snap = (value: number) => Math.round(value * 2) / 2;
  for (let index = 1; index < 20; index++) {
    const x = snap(event.width * index / 20);
    const y = snap(event.height * index / 20);
    candidates.push({ x, y: 0.5 }, { x, y: event.height - 0.5 },
      { x: 0.5, y }, { x: event.width - 0.5, y });
  }
  for (let row = 1; row < 10; row++) for (let column = 1; column < 10; column++)
    candidates.push({ x: snap(event.width * column / 10), y: snap(event.height * row / 10) });
  return candidates.filter((point) => canPlaceAccessPoint(event, point) &&
    points.every((other) => Math.hypot(other.x - point.x, other.y - point.y) >= 2))
    .sort((a, b) => Math.min(...points.map((p) => Math.hypot(p.x - b.x, p.y - b.y))) -
      Math.min(...points.map((p) => Math.hypot(p.x - a.x, p.y - a.y))))[0] ?? null;
}

export default function EventWorkspace({
  initialWorkspace,
  role,
}: {
  initialWorkspace: WorkspaceRecord;
  role: WorkspaceRole;
}) {
  const workspaceId = initialWorkspace.id;
  const apiUrl = `/api/workspaces/${encodeURIComponent(workspaceId)}`;
  const view = role === "exhibitioner" ? "exhibitor" : role;
  const [event, setEvent] = useState<FairEvent>(() => initialWorkspace.event);
  const [selectedCompany, setSelectedCompany] = useState("");
  const [addingCompany, setAddingCompany] = useState(false);
  const [renamingCompany, setRenamingCompany] = useState(false);
  const [visitorCount, setVisitorCount] = useState(
    initialWorkspace.event.visitors,
  );
  const [selected, setSelected] = useState(
    (role === "exhibitioner"
      ? initialWorkspace.event.items.find(
          (i) => i.kind === "booth" && !i.company,
        )?.id
      : undefined) ||
      initialWorkspace.event.items.find((i) => i.id === "b3")?.id ||
      initialWorkspace.event.items[0]?.id ||
      "entrance",
  );
  const [sync, setSync] = useState<Sync>("saved");
  const [saveError, setSaveError] = useState("");
  const [conflict, setConflict] = useState(false);
  const revision = useRef(initialWorkspace.revision);
  const [reservationRevision, setReservationRevision] = useState(initialWorkspace.revision);
  const dirty = useRef(false);
  const latest = useRef(event);
  const insightMapRef = useRef<HTMLElement>(null);
  const syncRef = useRef<Sync>("saved");
  const [history, setHistory] = useState<FairEvent[]>([]);
  const [result, setResult] = useState<Simulation | null>(null);
  const [running, setRunning] = useState(false);
  const [computing, setComputing] = useState(false);
  const [simulationProgress, setSimulationProgress] = useState(0);
  const simulationJob = useRef<ReturnType<typeof startSimulationJob> | null>(null);
  useEffect(() => () => simulationJob.current?.cancel(), []);
  const [time, setTime] = useState(0);
  const [speed, setSpeed] = useState("10");
  const [interests, setInterests] = useState<string[]>([]);
  const [routeShown, setRouteShown] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(true);
  const [eventLink, setEventLink] = useState("");
  const [placement, setPlacement] = useState<{
    item: Item;
    pointerId: number;
    startX: number;
    startY: number;
  } | null>(null);
  const [roomEditing, setRoomEditing] = useState(false);
  latest.current = event;
  syncRef.current = sync;
  useEffect(() => setVisitorCount(event.visitors), [event.visitors]);
  const applyLoaded = useCallback(
    (data: { event: FairEvent; revision: number }) => {
      const changed =
        JSON.stringify(latest.current) !== JSON.stringify(data.event);
      revision.current = data.revision;
      setReservationRevision(data.revision);
      dirty.current = false;
      setEvent(data.event);
      latest.current = data.event;
      setSync("saved");
      syncRef.current = "saved";
      setSaveError("");
      setConflict(false);
      if (changed) {
        setResult(null);
        setRunning(false);
        setHistory([]);
      }
    },
    [],
  );
  const load = useCallback(async () => {
    try {
      const response = await fetch(apiUrl, { cache: "no-store" });
      if (!response.ok)
        throw new Error(
          "Shared event is unavailable. Your layout is still visible; retry to reconnect.",
        );
      applyLoaded(await response.json());
    } catch (e) {
      setSync("error");
      syncRef.current = "error";
      setSaveError((e as Error).message);
    }
  }, [applyLoaded, apiUrl]);
  useEffect(() => {
    void load();
    const timer = setInterval(async () => {
      if (
        syncRef.current !== "saved" ||
        document.activeElement?.matches("input,[role=combobox]")
      )
        return;
      const before = revision.current;
      try {
        const response = await fetch(apiUrl, { cache: "no-store" });
        if (!response.ok) throw new Error();
        const data = (await response.json()) as {
          event: FairEvent;
          revision: number;
          error?: string;
        };
        if (
          data.revision !== before &&
          syncRef.current === "saved" &&
          revision.current === before
        ) {
          applyLoaded(data);
          toast.info("The shared layout was updated in another window.");
        }
      } catch {
        if (syncRef.current === "saved" && revision.current === before) {
          setSync("error");
          syncRef.current = "error";
          setSaveError(
            "Connection lost. Reconnect to continue editing the shared event.",
          );
        }
      }
    }, 4000);
    return () => clearInterval(timer);
  }, [load, applyLoaded, apiUrl]);
  async function commit(
    next: FairEvent,
    remember = true,
    retry = false,
  ): Promise<boolean> {
    if (role !== "organizer" || (!retry && syncRef.current !== "saved"))
      return false;
    const previous = latest.current;
    dirty.current = true;
    if (remember && !retry) setHistory((h) => [...h.slice(-19), previous]);
    setEvent(next);
    latest.current = next;
    setResult(null);
    setRunning(false);
    setTime(0);
    setSync("saving");
    syncRef.current = "saving";
    try {
      const response = await fetch(apiUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: next, revision: revision.current }),
      });
      const data = (await response.json()) as {
        event: FairEvent;
        revision: number;
        error?: string;
      };
      if (!response.ok) {
        setConflict(response.status === 409);
        throw new Error(data.error || "Saving failed. Please retry.");
      }
      revision.current = data.revision;
      setReservationRevision(data.revision);
      dirty.current = false;
      setSync("saved");
      syncRef.current = "saved";
      setSaveError("");
      setConflict(false);
      return true;
    } catch (e) {
      setSync("error");
      syncRef.current = "error";
      setSaveError((e as Error).message);
      toast.error((e as Error).message);
      return false;
    }
  }
  async function exhibitorChange(path: string, method: "POST" | "PATCH" | "DELETE", details: object) {
    if (role !== "exhibitioner" || syncRef.current !== "saved") return false;
    setSync("saving");
    syncRef.current = "saving";
    try {
      const response = await fetch(`${apiUrl}/${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...details, revision: revision.current }),
      });
      const data = (await response.json()) as WorkspaceRecord & { error?: string };
      if (!response.ok) {
        setConflict(response.status === 409 && !data.error?.includes("already listed"));
        throw new Error(data.error || "The change could not be saved.");
      }
      applyLoaded(data);
      return true;
    } catch (e) {
      setSync("error");
      syncRef.current = "error";
      setSaveError((e as Error).message);
      toast.error((e as Error).message);
      return false;
    }
  }
  const editable = sync === "saved";
  function removeRoomSection(index: number) {
    if (!editable || computing) return;
    const next = withoutRoomRectangle(event, index);
    if (!next) return;
    if (!validRoomShape(next)) {
      toast.error("This section connects other parts of the room. Remove those sections first.");
      return;
    }
    if (!allAccessPoints(next).every((p) => pointInRoom(next, p.x, p.y)) ||
      next.items.some((item) => !rectInsideRoom(next, item) ||
        (item.kind === "emergency_exit" && !onRoomBoundary(next, item)))) {
      toast.error("Move doors and objects out of this section before removing it.");
      return;
    }
    void commit(next).then((saved) => {
      if (saved) toast.success("Section removed. Undo is available.");
    });
  }
  async function addAccess(kind: "entrance" | "exit") {
    if (!editable || computing) return;
    const points = kind === "entrance" ? eventEntrances(event) : eventExits(event);
    if (points.length >= 12) return toast.error("A maximum of 12 entrances or exits is supported.");
    const location = suggestAccessLocation(event);
    if (!location) return toast.error("No open location is available for another access point.");
    const point = { id: `${kind}-${crypto.randomUUID()}`, ...location, flow: 50 };
    if (await commit(withAccessPoints(event, kind, [...points, point]))) {
      setSelected(`${kind}:${point.id}`);
      setRoomEditing(false);
      setSettingsOpen(false);
      setInspectorOpen(true);
      toast.success(`${kind === "entrance" ? "Entrance" : "Exit"} added. Set its position and flow weight here.`);
    }
  }
  const accessKind = selected === "entrance" || selected.startsWith("entrance:") ? "entrance" :
    selected === "exit" || selected.startsWith("exit:") ? "exit" : null;
  const selectedAccessPoints = accessKind === "entrance" ? eventEntrances(event) :
    accessKind === "exit" ? eventExits(event) : [];
  const selectedAccess = accessKind ?
    selected === accessKind ? selectedAccessPoints[0] : selectedAccessPoints.find((point) => `${accessKind}:${point.id}` === selected) : undefined;
  const booth = event.items.find((i) => i.id === selected);
  const booked = event.items.filter((i) => i.kind === "booth" && i.company);
  const spaces = event.items.filter((i) => i.kind === "booth");
  const companies = eventCompanies(event);
  const chosenCompany = companies.find((entry) => entry.name === selectedCompany);
  const myBooths = booked.filter((item) => item.company === chosenCompany?.name);
  const findings = useMemo(
    () => evaluateLayoutInsights(event, result),
    [event, result],
  );
  const layoutRating = useMemo(() => rateLayout(event, result, findings), [event, result, findings]);
  const guide = useMemo(
    () => visitorRoute(event, interests, result),
    [event, interests, result],
  );
  const visitorCongestion = useMemo(() => ({
    cell: gridFor(event).cell,
    peakLocalDensity: Array.from(visitorCrowdCosts(event, result)),
  }), [event, result]);
  function run() {
    if (!latest.current.items.some((item) => item.kind === "reception")) {
      toast.error("Add a reception desk so arriving visitors can check in.");
      return;
    }
    simulationJob.current?.cancel();
    setComputing(true);
    setSimulationProgress(0);
    setRunning(false);
    const input = latest.current;
    const signature = JSON.stringify(input);
    simulationJob.current = startSimulationJob(() => new SimulationWorker(), input, {
      onProgress: setSimulationProgress,
      onComplete: (next) => {
        setComputing(false);
        if (signature !== JSON.stringify(latest.current)) {
          toast.info("The layout changed. Run again to use the latest plan.");
          return;
        }
        setResult(next);
        setTime(next.agents.length ? Math.min(...next.agents.map((agent) => agent.start)) : 0);
        setRunning(true);
        toast.success("Simulation ready. Move a booth and compare another layout.");
      },
      onError: (message) => {
        setComputing(false);
        toast.error(message);
      },
    });
  }
  useEffect(() => {
    if (!running || !result) return;
    let frame = 0,
      last = 0;
    function tick(now: number) {
      if (!last) last = now;
      const elapsed = now - last;
      last = now;
      const steps = (elapsed / 1000) * Number(speed) / result!.stepSeconds;
      if (steps > 0) {
        setTime((t) => {
          const next = t + steps;
          if (next >= result!.duration) {
            setRunning(false);
            return result!.duration;
          }
          return next;
        });
      }
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running, result, speed]);
  function updateItem(next: Item) {
    void commit({
      ...event,
      items: event.items.map((i) => (i.id === next.id ? next : i)),
    }).then((saved) => {
      if (saved) setInspectorOpen(false);
    });
  }
  async function removeItem(item: Item) {
    if (
      item.kind === "booth" &&
      item.company &&
      !window.confirm(`Remove ${item.label} and its reservation for ${item.company}?`)
    ) return;
    const remaining = event.items.filter((i) => i.id !== item.id);
    if (!(await commit({ ...event, items: remaining }))) return;
    setSelected(remaining[0]?.id || "entrance");
    setInspectorOpen(false);
    toast.info(`${item.label} removed. Use Undo to restore it.`);
  }
  function newObject(kind: Item["kind"]): Item {
    const preset = objectPresets[kind];
    const number =
      Math.max(
        0,
        ...event.items.map((i) => Number(i.label.replace(/\D/g, "")) || 0),
      ) + 1;
    return {
      id: crypto.randomUUID(),
      kind,
      label: `${preset.prefix}${String(number).padStart(2, "0")}`,
      name: kind === "food" ? "Coffee bar" : preset.label,
      x: 0,
      y: 0,
      w: preset.w,
      h: preset.h,
      company: "",
      category: "",
      popularity: preset.popularity,
      dwell: kind === "seating" ? 120 : preset.dwell,
      ...(["booth", "food", "reception"].includes(kind) ? { processingRate: kind === "reception" ? 20 : 6 } : {}),
      ...(kind === "food" ? { foodAvailability: defaultFoodAvailability(event) } : {}),
    };
  }
  function placeObject(item: Item) {
    if (!editable || event.items.length >= 50 || !validPosition(event, item))
      return;
    void commit({ ...event, items: [...event.items, item] }).then((saved) => {
      if (saved) {
        setSelected(item.id);
        setSettingsOpen(false);
      }
    });
  }
  async function undo() {
    const previous = history[history.length - 1];
    if (!previous) return;
    if (await commit(previous, false)) setHistory((h) => h.slice(0, -1));
  }
  async function copyLink() {
    const url = new URL(
      workspacePath(workspaceId, "exhibitioner"),
      window.location.origin,
    );
    setEventLink(url.toString());
    setLinkOpen(true);
    try {
      await navigator.clipboard.writeText(url.toString());
      toast.success("Exhibitor link copied.");
    } catch {
      toast.info("Copy the event link below.");
    }
  }
  const api = useRef({ run, commit });
  api.current = { run, commit };
  useEffect(() => {
    const context = (
      document as unknown as {
        modelContext?: {
          registerTool: (
            tool: unknown,
            options: unknown,
          ) => Promise<void> | void;
        };
      }
    ).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    for (const tool of [
      {
        name: "read_event_layout",
        title: "Read event layout",
        description:
          "Read the current visible event layout and simulation inputs.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: () => ({
          workspaceId,
          role,
          event: latest.current,
          saveState: syncRef.current,
        }),
      },
      {
        name: "move_event_object",
        title: "Move a booth",
        description:
          "Move an existing object on the visible floor plan and save it to the shared event.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string" },
            x: { type: "number" },
            y: { type: "number" },
          },
          required: ["id", "x", "y"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: async (input: unknown) => {
          const p = input as { id: string; x: number; y: number };
          if (
            !p ||
            typeof p.id !== "string" ||
            !Number.isFinite(p.x) ||
            !Number.isFinite(p.y)
          )
            throw new Error("Provide an object ID and finite coordinates.");
          const item = latest.current.items.find((i) => i.id === p.id);
          if (!item) throw new Error("Object not found.");
          const next = { ...item, x: p.x, y: p.y };
          if (!validPosition(latest.current, next))
            throw new Error(
              "Position is outside the hall or overlaps another object or door.",
            );
          if (
            !(await api.current.commit({
              ...latest.current,
              items: latest.current.items.map((i) =>
                i.id === p.id ? next : i,
              ),
            }))
          )
            throw new Error(
              "Move was not saved. Check the connection and visible error.",
            );
          setSelected(p.id);
          return { id: p.id, x: p.x, y: p.y, saved: true };
        },
      },
    ].filter((_tool, index) => index === 0 || role === "organizer")) {
      try {
        void Promise.resolve(
          context.registerTool(tool, { signal: lifecycle.signal }),
        ).catch(() => {});
      } catch {}
    }
    return () => lifecycle.abort();
  }, [workspaceId, role]);
  const elapsed = time * (result?.stepSeconds ?? STEP);
  const clock = (n: number) => formatPlaybackClock(event.startTime, n);
  const InspectorSurface = view === "organizer" ? DialogContent : "aside";
  return (
    <div className="app-shell">
      <Toaster theme="light" position="bottom-center" />
      <AppHeader
        current="workspace"
        workspace={{ id: workspaceId, name: event.name }}
      />
      <main className={`workspace role-workspace role-page-${role}`}>
        <WorkspaceBack id={workspaceId} />
        <div className="page-heading">
          <div>
            <h1>
              {event.name}{" "}
              <span className="page-role">
                ({view === "organizer" ? "Organizer" : view === "exhibitor" ? "Exhibitor" : "Visitor"})
              </span>
            </h1>
          </div>
          <div className="heading-actions">
            {view === "organizer" && (
              <>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setSettingsOpen(true);
                    setInspectorOpen(true);
                  }}
                >
                  <Layers /> Event settings
                </Button>
                <Button variant="outline" onClick={copyLink}>
                  <ArrowUpRight /> Share booth link
                </Button>
              </>
            )}
          </div>
        </div>
        {linkOpen && (
          <div className="link-panel">
            <div>
              <b>Exhibitor link</b>
            </div>
            <Input
              readOnly
              aria-label="Exhibitor link"
              value={eventLink}
            />
            <Button variant="ghost" onClick={() => setLinkOpen(false)}>
              Close
            </Button>
          </div>
        )}
        {saveError && (
          <div className="save-error" role="alert">
            <TriangleAlert size={18} />
            <span>{saveError}</span>
            {!conflict && dirty.current && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void commit(event, false, true)}
              >
                Retry save
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => void load()}>
              {conflict ? "Reload latest" : "Reconnect"}
            </Button>
          </div>
        )}
        {view === "exhibitor" && (
          <section className="company-chooser" aria-labelledby="company-chooser-title">
            <div className="company-chooser-heading">
              <div>
                <h2 id="company-chooser-title">Your exhibit</h2>
                <p>Choose or add an exhibitor or exhibit before reserving a booth.</p>
              </div>
              <Button type="button" variant="outline" size="sm"
                onClick={() => { setRenamingCompany(false); setAddingCompany((current) => !current); }}
                aria-expanded={addingCompany}>
                {addingCompany ? "Cancel" : "Add an exhibitor"}
              </Button>
            </div>
            <div className="company-picker">
              <Choice value={chosenCompany?.name || "__choose"} label="Choose an exhibit"
                options={[{ value: "__choose", label: "Choose an exhibit" },
                  ...companies.map((entry) => ({ value: entry.name, label: entry.name }))]}
                onChange={(value) => {
                  setSelectedCompany(value === "__choose" ? "" : value);
                  setRenamingCompany(false);
                }} />
              {chosenCompany && <span>{chosenCompany.category} · {myBooths.length} {myBooths.length === 1 ? "booth" : "booths"} reserved</span>}
              {chosenCompany && <Button type="button" variant="outline" size="sm"
                onClick={() => { setAddingCompany(false); setRenamingCompany((current) => !current); }}
                aria-expanded={renamingCompany}>
                {renamingCompany ? "Cancel rename" : "Rename exhibit"}
              </Button>}
            </div>
            {renamingCompany && chosenCompany && <RenameExhibitorForm key={chosenCompany.name}
              name={chosenCompany.name} disabled={!editable}
              onCancel={() => setRenamingCompany(false)}
              onRename={async (name) => {
                const oldName = chosenCompany.name;
                const ok = await exhibitorChange("companies", "PATCH", { oldName, name });
                if (ok) {
                  setSelectedCompany(name);
                  setRenamingCompany(false);
                  toast.success(`${oldName} renamed to ${name}.`);
                }
                return ok;
              }} />}
            {addingCompany && <AddExhibitorForm disabled={!editable} onAdd={async (name, category) => {
              const ok = await exhibitorChange("companies", "POST", { name, category });
              if (ok) {
                setSelectedCompany(name);
                setAddingCompany(false);
                toast.success(`${name} added. Choose an available booth below.`);
              }
              return ok;
            }} />}
          </section>
        )}
        {view === "exhibitor" && <ExhibitorReservation event={event} revision={reservationRevision}
          apiUrl={apiUrl} company={chosenCompany} organizer={false} disabled={!editable}
          onSaved={applyLoaded} />}
        <div className={`planner${view === "organizer" && !insightsOpen ? " insights-folded" : ""}`}>
          {view === "organizer" && (
            <aside className="findings-section" aria-label="Planner sidebar" data-open={insightsOpen}>
              <div className="insights-rail">
                <nav className="insights-rail-actions" aria-label="Planner sections">
                  <button type="button" className="insights-rail-button" aria-expanded={insightsOpen}
                    aria-controls="layout-insights-content"
                    aria-label={insightsOpen ? "Collapse layout insights" : "Open layout insights"}
                    title="Layout insights" onClick={() => setInsightsOpen((open) => !open)}>
                    <Info size={20} />
                    {findings.length > 0 && <span className="insights-rail-count" aria-hidden="true">{findings.length}</span>}
                  </button>
                  <button type="button" className="insights-rail-button"
                    aria-label={computing ? `Simulating ${simulationProgress}%` : result ? "Run simulation again" : "Run simulation"}
                    title={result ? "Run simulation again" : "Run simulation"}
                    disabled={!editable || computing} onClick={run}>
                    {computing ? <LoaderCircle size={19} className="spin" /> : <Play size={19} />}
                  </button>
                </nav>
              </div>
              <div id="layout-insights-content" className="insights-panel" hidden={!insightsOpen}>
                <LayoutInsights findings={findings} rating={layoutRating} simulated={!!result} onSelect={(id) => {
                  setSelected(id);
                  setSettingsOpen(false);
                  setInspectorOpen(false);
                  setRoomEditing(false);
                  requestAnimationFrame(() => {
                    const object = insightMapRef.current?.querySelector<SVGGElement>(`[data-testid="map-${CSS.escape(id)}"]`);
                    object?.focus({ preventScroll: true });
                    object?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
                  });
                }} />
              </div>
            </aside>
          )}
          <div className="map-column">
            {view === "organizer" && (
              <section className={`simulation-panel${result ? " has-results" : ""}`} aria-labelledby="simulation-title">
                <div className="simulation-heading">
                  <div className="simulation-heading-copy">
                    <div>
                      <h2 id="simulation-title">Crowd simulation</h2>
                      <button type="button" className="simulation-hours-edit" onClick={() => {
                        setSettingsOpen(true);
                        setInspectorOpen(true);
                      }}>Event hours: {formatTimeOfDay(event.startTime)}–{formatTimeOfDay(event.endTime)} · Edit</button>
                    </div>
                  </div>
                </div>
                <div className="simulation-controls">
                  <div className="simulation-total">
                    <div className="simulation-total-head">
                      <label htmlFor="simulation-visitors">Total visitors in this run</label>
                      <strong title={`${visitorCount.toLocaleString()} visitors`}>{compactVisitors(visitorCount)}</strong>
                    </div>
                    <Slider
                      id="simulation-visitors"
                      aria-label="Total visitors in this run"
                      aria-valuetext={`${visitorCount.toLocaleString()} visitors`}
                      min={0}
                      max={visitorLevels.length - 1}
                      step={1}
                      value={[visitorLevelIndex(visitorCount)]}
                      disabled={!editable || computing}
                      onValueCommit={(v) => {
                        const visitors = visitorLevels[v[0]];
                        if (visitors !== event.visitors) void commit({ ...event, visitors });
                      }}
                      onValueChange={(v) => setVisitorCount(visitorLevels[v[0]])}
                    />
                    <div className="simulation-scale"><span>100</span><span>100K</span></div>
                  </div>
                  {!result && <div className="simulation-start">
                    <div className="simulation-speed">
                      <span>Playback speed</span>
                      <Choice
                        value={speed}
                        label="Playback speed"
                        onChange={setSpeed}
                        options={[
                          { value: "10", label: "10×" },
                          { value: "20", label: "20×" },
                          { value: "60", label: "1 min/s" },
                          { value: "300", label: "5 min/s" },
                        ]}
                      />
                    </div>
                    <Button className="simulation-run" onClick={run} disabled={!editable || computing}>
                      {computing ? <LoaderCircle className="spin" /> : <Play />}
                      {computing ? `Simulating… ${simulationProgress}%` : "Run simulation"}
                    </Button>
                  </div>}
                </div>
                {result && (
                  <div className="simulation-playback">
                    <div className="playback">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={running ? "Pause simulation" : "Play simulation"}
                        onClick={() => {
                          if (time >= result.duration) setTime(result.agents.length ?
                            Math.min(...result.agents.map((agent) => agent.start)) : 0);
                          setRunning(!running);
                        }}
                      >
                        {running ? <Pause /> : <Play />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Restart simulation"
                        onClick={() => {
                          setTime(result.agents.length ? Math.min(...result.agents.map((agent) => agent.start)) : 0);
                          setRunning(true);
                        }}
                      >
                        <RotateCcw />
                      </Button>
                      <span className="playback-time">{clock(elapsed)}</span>
                      <Slider
                        aria-label="Simulation timeline"
                        min={0}
                        max={result.duration}
                        step={1}
                        value={[time]}
                        onValueChange={(v) => {
                          setTime(v[0]);
                          setRunning(false);
                        }}
                      />
                      <span className="playback-time">{formatTimeOfDay(event.endTime)}</span>
                      <Button variant="outline" size="sm" className="simulation-rerun"
                        onClick={run} disabled={!editable || computing}>
                        {computing ? <LoaderCircle className="spin" /> : <Play />}
                        {computing ? `Simulating… ${simulationProgress}%` : "Run again"}
                      </Button>
                    </div>
                  </div>
                )}
                {computing && <Button variant="ghost" size="sm" onClick={() => {
                  simulationJob.current?.cancel();
                  simulationJob.current = null;
                  setComputing(false);
                }}>Cancel simulation</Button>}
                {result && (
                  <div className="simulation-live-stats" aria-live="off">
                    <div><span>Est. peak in 2 × 2 m</span><strong>{compactVisitors(result.peak)}</strong></div>
                    <div title="Average wait after joining a service queue, including visitors still waiting at closing">
                      <span>Avg. queue wait</span>
                      <strong>{result.queueWait < 60 ? `${result.queueWait} s` : `${Math.round(result.queueWait / 60)} min`}</strong>
                    </div>
                  </div>
                )}
              </section>
            )}
            <section className="map-panel" ref={insightMapRef}>
              <div className="map-toolbar">
                <div>
                  <h2>Floor plan</h2>
                  {view === "organizer" && (
                    <span className="map-mode">
                      {spaces.length} booths · {booked.length} booked
                    </span>
                  )}
                </div>
                {view === "organizer" ? (
                  <div className="toolbar-actions">
                    <Button variant="outline" size="sm" disabled={!editable || computing}
                      onClick={() => void addAccess("entrance")}>
                      <Plus size={15} /> Entrance
                    </Button>
                    <Button variant="outline" size="sm" disabled={!editable || computing}
                      onClick={() => void addAccess("exit")}>
                      <Plus size={15} /> Exit
                    </Button>
                    <Button variant={roomEditing ? "default" : "outline"} size="sm"
                      aria-pressed={roomEditing} disabled={!editable || computing}
                      onClick={() => {
                        setRoomEditing((current) => !current);
                        setPlacement(null);
                        setInspectorOpen(false);
                        setSettingsOpen(false);
                      }}>
                      <Layers size={15} /> {roomEditing ? "Done editing room" : "Edit room"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Undo last change"
                      disabled={!editable || !history.length}
                      onClick={() => void undo()}
                    >
                      <Undo2 />
                    </Button>
                  </div>
                ) : (
                  <span className="map-mode">
                    {view === "exhibitor"
                      ? `${spaces.length - booked.length} spaces available`
                      : `${interests.length} selected`}
                  </span>
                )}
              </div>
              {view === "organizer" && roomEditing &&
                <div className="room-edit-tools">
                  <MapSizeForm event={event} disabled={!editable || computing} onSave={(next) => {
                    void commit(next).then((saved) => {
                      if (saved) toast.success("Map size updated. Undo is available.");
                    });
                  }} />
                  {roomRectangles(event).length >= 12 &&
                    <p className="room-limit-note">Maximum of 12 rooms reached.</p>}
                  <div className="room-sections-table-wrap">
                    <table className="room-sections-table">
                      <caption className="sr-only">Room sections</caption>
                      <thead>
                        <tr><th scope="col">Room</th><th scope="col">Width</th><th scope="col">Depth</th>
                          <th scope="col">Area</th><th scope="col">Left</th><th scope="col">Top</th>
                          <th scope="col"><span className="sr-only">Actions</span></th></tr>
                      </thead>
                      <tbody>
                        {roomRectangles(event).map((section, index) => (
                          <tr key={index}>
                            <th scope="row">Room {index + 1}</th>
                            <td>{section.w} m</td><td>{section.h} m</td>
                            <td>{Number((section.w * section.h).toFixed(2)).toLocaleString()} m²</td>
                            <td>{section.x} m</td><td>{section.y} m</td>
                            <td>{index > 0 && <Button type="button" variant="ghost" size="sm"
                              disabled={!editable || computing}
                              aria-label={`Remove room ${index + 1}`}
                              onClick={() => removeRoomSection(index)}>
                              <Trash2 size={15} /> Remove
                            </Button>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>}
              <div className={view === "organizer" ?
                `organizer-map-layout${roomEditing ? " room-edit-layout" : ""}` : undefined}>
                <FloorMap
                event={event}
                selected={selected}
                onSelect={(id) => {
                  setSelected(id);
                  setSettingsOpen(false);
                }}
                onActivate={
                  view === "organizer"
                    ? (id) => {
                        setSelected(id);
                        setSettingsOpen(false);
                        setInspectorOpen(true);
                      }
                    : undefined
                }
                onChange={(next) => void commit(next)}
                editable={view === "organizer" && editable && !computing}
                roomEditing={view === "organizer" && roomEditing}
                placement={placement}
                onPlace={placeObject}
                onPlacementEnd={() => setPlacement(null)}
                simulation={result}
                time={time}
                congestion={view === "visitor" ? visitorCongestion : undefined}
                heat={true}
                people={true}
                route={view === "visitor" && routeShown ? guide.points : []}
                routeStops={view === "visitor" && routeShown ? guide.stops : []}
                routeExitReachable={guide.exitReachable}
                highlights={view === "visitor" ? interests : []}
                />
                {view === "organizer" && !roomEditing && (
                  <aside className="object-palette" aria-label="Objects to add">
                    <div className="object-palette-heading">
                      <b>Objects</b>
                      <span>Drag into map</span>
                    </div>
                    <div className="object-palette-items">
                      {paletteObjects.map(({ kind, Icon }) => (
                        <button
                          key={kind}
                          type="button"
                          className={`palette-item palette-item-${kind}`}
                          aria-label={`Drag ${objectPresets[kind].label} onto the map`}
                          title={`Drag ${objectPresets[kind].label} onto the map`}
                          disabled={!editable || computing || event.items.length >= 50}
                          onPointerDown={(e) => {
                            if (e.button !== 0) return;
                            setPlacement({
                              item: newObject(kind),
                              pointerId: e.pointerId,
                              startX: e.clientX,
                              startY: e.clientY,
                            });
                            e.currentTarget.setPointerCapture(e.pointerId);
                          }}
                        >
                          <Icon
                            size={kind === "emergency_exit" ? 14 : 25}
                            strokeWidth={1.7}
                            aria-hidden="true"
                          />
                        </button>
                      ))}
                    </div>
                  </aside>
                )}
              </div>
              <div className="map-footer">
                <span className="grid-scale-legend">
                  <i aria-hidden="true" />
                  Grid square = {gridMetersFor(event.width, event.height)} × {gridMetersFor(event.width, event.height)} m
                </span>
                <span>
                  <i className="legend-dot booked" />
                  Booked
                </span>
                <span>
                  <i className="legend-dot available" />
                  Available
                </span>
                <span><i className="legend-dot facility" />Facility</span>
                <span><i className="legend-dot selected" />Selected</span>
                {view === "organizer" && (
                  <span>
                    <i className="legend-dot obstacle" />
                    Obstacle
                  </span>
                )}
                {(result || view === "visitor") && <div className="heat-legend" aria-label="Peak crowd density in people per square metre">
                  <strong>{view === "visitor" ? "Congestion" : "Peak density · people/m²"}</strong>
                  {HEAT_LEVELS.map((level, index) => (
                    <span key={level.max}>
                      <i aria-hidden="true" style={{ backgroundColor: `rgba(${level.color.slice(0, 3).join(", ")}, ${level.color[3] / 255})` }} />
                      {view === "visitor" ? ["Low", "Moderate", "High", "Very high"][index] : index === 0 ? "<1" : index === 3 ? "4+" : `${HEAT_LEVELS[index - 1].max}–${level.max}`}
                    </span>
                  ))}
                </div>}
                {result && <span><i className="legend-dot" style={{ border: "2px solid #334155", background: "#f8fafc" }} />Estimated queue total</span>}
              </div>
            </section>

          </div>
          <Dialog
            open={view === "organizer" && inspectorOpen}
            onOpenChange={(open) => {
              setInspectorOpen(open);
              if (!open) setSettingsOpen(false);
            }}
          >
          {!(view === "exhibitor" && booth?.kind === "booth" && !booth.company) && <InspectorSurface
            className={view === "organizer" ? "inspector editor-dialog" : "inspector"}
          >
            {view === "organizer" && (
              <>
                <DialogTitle className="sr-only">
                  {settingsOpen
                    ? "Event settings"
                    : accessKind
                      ? `Edit ${accessKind}`
                      : `Edit ${booth?.kind === "booth" ? `booth ${booth.label}` : booth?.name || "space"}`}
                </DialogTitle>
                <DialogDescription className="sr-only">
                  {settingsOpen
                    ? "Edit the event name, venue, and minimum gap target."
                    : "Edit details here. Drag objects and their edges directly on the floor plan to move or resize them."}
                </DialogDescription>
              </>
            )}
            {view === "visitor" ? (
              <>
                <div className="visitor-planner-heading"><span className="visitor-eyebrow">YOUR VISIT</span>
                  <h2 className="panel-heading">Find your flow</h2>
                  <p>Choose your exhibits. We’ll balance quieter stops with walking distance.</p>
                </div>
                <details className="visitor-exhibit-picker" open={!routeShown}>
                <summary className="visitor-selection-heading"><span>Exhibits to visit</span><span>{interests.length} selected · {routeShown ? "Edit" : "Choose"}</span></summary>
                <div className="interest-list">
                  {booked.map((i) => (
                    <label key={i.id}>
                      <Checkbox
                        checked={interests.includes(i.id)}
                        onCheckedChange={(checked) => {
                          setInterests(
                            checked
                              ? [...interests, i.id]
                              : interests.filter((id) => id !== i.id),
                          );
                          setRouteShown(false);
                        }}
                        aria-label={`Visit ${i.company}`}
                      />
                      <span>
                        <b>{i.company}</b>
                        <small>{i.category}</small>
                      </span>
                      <span className="booth-tag">{i.label}</span>
                    </label>
                  ))}
                </div>
                {!booked.length && (
                  <p className="muted">
                    Exhibitors will appear here when booths are booked.
                  </p>
                )}
                <Button
                  className="full-button"
                  disabled={!interests.length}
                  onClick={() => setRouteShown(true)}
                >
                  <Route /> {routeShown ? "Update my route" : "Plan my route"}
                </Button>
                </details>
                {routeShown ? (
                  <section className="visitor-route-results" aria-live="polite" aria-label="Your route results">
                    <div className="visitor-route-title"><h3>Your route</h3><span>Quieter stops first</span></div>
                    <div className="visitor-route-metrics">
                      <div><strong>{guide.distance}<small> m</small></strong><span>Walking distance</span></div>
                      <div><strong>{guide.order.filter((item) => item.kind === "booth").length}<small> / {interests.length}</small></strong><span>Exhibits on route</span></div>
                      <div><strong>{guide.congestion === null ? "—" : guide.congestion >= 4 ? "Very high" : guide.congestion >= 2 ? "High" : guide.congestion >= 1 ? "Moderate" : "Low"}</strong><span>Route congestion</span></div>
                    </div>
                    {guide.points.length > 0 && <ol className="visitor-itinerary">
                      <li><span className="visitor-stop-marker endpoint">S</span><div><b>Entrance</b><small>Start here</small></div></li>
                      {guide.stops.map(({ item, crowd }, index) => (
                        <li key={item.id}>
                          <span className="visitor-stop-marker">{index + 1}</span>
                          <button type="button" onClick={() => setSelected(item.id)} aria-label={`Show stop ${index + 1}: ${item.company || item.name} on map`}>
                            <b>{item.company || item.name}</b><small>{item.label}{item.kind === "reception" ? " · Check in first" : ""}</small>
                          </button>
                          {item.kind !== "reception" && <span className={`visitor-crowd ${crowd >= 2 ? "busy" : crowd >= 1 ? "moderate" : "quiet"}`}>
                            {crowd >= 2 ? "Busier" : crowd >= 1 ? "Moderate" : "Quieter"}
                          </span>}
                        </li>
                      ))}
                      {guide.exitReachable && <li><span className="visitor-stop-marker endpoint">E</span><div><b>Exit</b><small>Finish here</small></div></li>}
                    </ol>}
                    {(guide.unreachable.length > 0 || !guide.exitReachable) && <p className="form-error">
                      {guide.unreachable.length ? `No accessible path to: ${guide.unreachable.join(", ")}. ` : ""}
                      {!guide.exitReachable ? "No accessible route to the exit. Ask the organizer for help." : ""}
                    </p>}
                  </section>
                ) : null}
              </>
            ) : settingsOpen && view === "organizer" ? (
              <>
                <h2 className="panel-heading">Event settings</h2>
                <EventSettingsForm event={event} disabled={!editable}
                  onSave={(next) => void commit(next).then((saved) => {
                    if (saved) setInspectorOpen(false);
                  })} />
                <hr />
                <Button
                  variant="outline"
                  className="full-button"
                  onClick={() => {
                    if (editable) {
                      void commit({
                        ...seedEvent(),
                        name: event.name,
                        venue: event.venue,
                        startTime: event.startTime,
                        endTime: event.endTime,
                      });
                      setSelected("b3");
                      setSettingsOpen(false);
                      setInspectorOpen(false);
                      toast.info("Sample restored. Undo is available.");
                    }
                  }}
                  disabled={!editable}
                >
                  <RotateCcw /> Restore sample layout
                </Button>
              </>
            ) : accessKind && selectedAccess ? (
              <>
                <h2>{accessKind === "entrance" ? "Entrance" : "Exit"} {selectedAccessPoints.findIndex((point) => point.id === selectedAccess.id) + 1}</h2>
                {view === "organizer" && (
                  <DoorForm
                    key={`${selected}-${selectedAccess.x}-${selectedAccess.y}-${selectedAccess.flow}`}
                    kind={accessKind}
                    event={event}
                    access={selectedAccess}
                    disabled={!editable}
                    onSave={(p, percentage) => {
                      const points = withAccessPercentage(selectedAccessPoints.map((point) => point.id === p.id ? p : point), p.id, percentage);
                      void commit(withAccessPoints(event, accessKind, points)).then((saved) => {
                        if (saved) setInspectorOpen(false);
                      });
                    }}
                    onRemove={selectedAccessPoints.length > 1 ? () => {
                      const points = selectedAccessPoints.filter((point) => point.id !== selectedAccess.id);
                      void commit(withAccessPoints(event, accessKind, points)).then((saved) => {
                        if (saved) {
                          setSelected(accessKind);
                          setInspectorOpen(false);
                          toast.info(`${accessKind === "entrance" ? "Entrance" : "Exit"} removed. Undo is available.`);
                        }
                      });
                    } : undefined}
                  />
                )}
              </>
            ) : booth ? (
              <>
                <div className="item-editor-header">
                  <h2>
                    {view === "organizer" && booth.kind === "booth"
                      ? `Booth ${booth.label}`
                      : booth.company ||
                        (booth.kind === "booth" ? "Available space" : booth.name)}
                  </h2>
                  {view === "organizer" && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="remove-button"
                      aria-label={`Remove ${booth.kind}`}
                      disabled={!editable}
                      onClick={() => void removeItem(booth)}
                    >
                      <Trash2 size={14} /> Remove
                    </Button>
                  )}
                </div>
                {view === "organizer" ? (
                  <>
                    {booth.kind === "booth" && booth.company && (
                      <p className="selection-hint">Reserved for {booth.company}</p>
                    )}
                    <ItemForm startTime={event.startTime} endTime={event.endTime}
                      key={JSON.stringify(booth)}
                      item={booth}
                      disabled={!editable}
                      onSave={updateItem}
                    />
                  </>
                ) : (
                  <>
                    {booth.kind === "booth" && (
                      <p className="selection-hint">
                        {booth.company === chosenCompany?.name
                          ? `Reserved for your exhibit · ${booth.company}`
                          : `Reserved for ${booth.company}. Select an available booth to book.`}
                      </p>
                    )}
                    {view === "exhibitor" && booth.kind === "booth" && booth.company === chosenCompany?.name && (
                      <Button variant="outline" className="full-button" disabled={!editable}
                        onClick={async () => {
                          if (!window.confirm(`Release ${booth.label} for ${booth.company}? It will become available to other exhibitors.`)) return;
                          if (await exhibitorChange("claims", "DELETE", { boothId: booth.id, company: booth.company }))
                            toast.success(`${booth.label} is available again.`);
                        }}>
                        Release {booth.label}
                      </Button>
                    )}
                  </>
                )}
              </>
            ) : (
              <div className="empty-selection">
                <MousePointer2 />
                <h2>Select a space</h2>
              </div>
            )}
          </InspectorSurface>}
          </Dialog>
        </div>
      </main>
    </div>
  );
}
