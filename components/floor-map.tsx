"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Armchair, Box, Building2, Coffee, DoorOpen, Presentation,
  Rows3, TicketCheck, Toilet, Scan, type LucideIcon,
} from "lucide-react";
import { MAX_MAP_SIZE, stageSpotlightFor, canPlaceAccessPoint, eventEntrances, eventExits, onRoomBoundary, roomBoundarySegments, roomRectangleFromDrag, roomRectangles, validRoomShape, withAccessPoints, withRoomRectangle,
  type FairEvent, type FlowPoint, type Item, type Rect, type RoomBorder } from "@/lib/event";
import { emergencyExitAt } from "@/lib/placement";
import { spacedRoute } from "@/lib/route-display";
import { doorwayFor, gridMetersFor } from "@/lib/map-display";
import { crowdFootprint, footprintFreeFraction } from "@/lib/crowd-footprint";
import { queuePeopleRemaining, queueCountsAtStep } from "@/lib/queue-display";
import {
  agentsAtStep,
  segmentIsWalkable,
  visitorProfiles,
  validPosition,
  type VisitorStop,
  type Point,
  type Simulation,
} from "@/lib/simulation";
import { toast } from "sonner";
import HeatSurface from "./heat-surface";
import CrowdTrace from "./crowd-trace";
import MapFurniture from "./map-furniture";
import MapPlants from "./map-plants";
type Props = {
  event: FairEvent;
  selected: string;
  onSelect: (id: string) => void;
  onActivate?: (id: string) => void;
  onChange: (event: FairEvent) => void;
  editable: boolean;
  roomEditing?: boolean;
  placement?: {
    item: Item;
    pointerId: number;
    startX: number;
    startY: number;
  } | null;
  onPlace?: (item: Item) => void;
  onPlacementEnd?: () => void;
  simulation: Simulation | null;
  time: number;
  congestion?: Pick<Simulation, "cell" | "peakLocalDensity">;
  heat: boolean;
  people: boolean;
  route?: Point[];
  routeStops?: VisitorStop[];
  routeExitReachable?: boolean;
  highlights?: string[];
};
type ResizeEdge = "north" | "east" | "south" | "west";
const snap = (value: number) => Math.round(value * 2) / 2;
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(value, max));
const crowdNumber = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const queueNumber = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });
const objectIcons: Record<Item["kind"], LucideIcon> = {
  booth: Building2,
  food: Coffee,
  obstacle: Box,
  reception: TicketCheck,
  stairs: Rows3,
  emergency_exit: DoorOpen,
  stage: Presentation,
  seating: Armchair,
  restroom: Toilet,
};
const facilityFill: Partial<Record<Item["kind"], string>> = {
  reception: "#def1ea",
  stairs: "#e5e8fa",
  emergency_exit: "#daf3e5",
  stage: "#eee6f7",
  seating: "#e5eaf5",
  restroom: "#dff2f5",
};
function borderPath(border: RoomBorder) {
  return border.side === "east" || border.side === "west"
    ? `M${border.coordinate * 20} ${border.start * 20}V${border.end * 20}`
    : `M${border.start * 20} ${border.coordinate * 20}H${border.end * 20}`;
}
function MapItemLabel({ item, screenScale, textScale }: { item: Item; screenScale: number; textScale: number }) {
  const shortLabels: Partial<Record<Item["kind"], string>> = { food: "Café", restroom: "WC", reception: "Desk", seating: "Seats", stage: "Stage" };
  const name = item.w * 20 * screenScale < 85
    ? item.kind === "booth" ? item.label : shortLabels[item.kind] || item.label
    : item.company || (item.kind === "booth" ? "Available" : item.name);
  const inset = 6 / textScale;
  const compact = item.h * 20 * screenScale < 40 || item.w * 20 * screenScale < 85;
  const top = (compact ? 4 : 23) / textScale;
  const width = Math.max(0, item.w * 20 - inset * 2);
  const height = Math.max(0, item.h * 20 - top - 2 / textScale);
  const label = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = label.current;
    if (!element) return;
    element.style.overflowWrap = "normal";
    let size = 14;
    element.style.fontSize = `${size / textScale}px`;
    while (
      size > 10.5 &&
      (element.scrollHeight > element.clientHeight + 1 ||
        element.scrollWidth > element.clientWidth + 1)
    ) {
      size -= 0.5;
      element.style.fontSize = `${size / textScale}px`;
    }
  }, [name, width, height, textScale]);

  if (width * screenScale < 24 || height * screenScale < 10) return null;
  return (
    <foreignObject x={inset} y={top} width={width} height={height} pointerEvents="none">
      <div ref={label} className={`map-item-label${item.kind !== "booth" ? " facility-label" : ""}`}>
        <span>{name}</span>
      </div>
    </foreignObject>
  );
}
function resizeFromEdge(item: Item, edge: ResizeEdge, point: Point, event: FairEvent): Item {
  const right = item.x + item.w;
  const bottom = item.y + item.h;
  if (edge === "east") return { ...item, w: clamp(snap(point.x - item.x), 0.5, event.width - item.x) };
  if (edge === "south") return { ...item, h: clamp(snap(point.y - item.y), 0.5, event.height - item.y) };
  if (edge === "west") {
    const x = clamp(snap(point.x), 0, right - 0.5);
    return { ...item, x, w: right - x };
  }
  const y = clamp(snap(point.y), 0, bottom - 0.5);
  return { ...item, y, h: bottom - y };
}
export default function FloorMap({
  event,
  selected,
  onSelect,
  onActivate,
  onChange,
  editable,
  roomEditing = false,
  placement,
  onPlace,
  onPlacementEnd,
  simulation,
  time,
  heat,
  people,
  congestion,
  route = [],
  routeStops = [],
  routeExitReachable = true,
  highlights = [],
}: Props) {
  const canvas = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const pan = useRef<{
    pointerId: number;
    x: number;
    y: number;
    scrollLeft: number;
    scrollTop: number;
    moved: boolean;
  } | null>(null);
  const suppressPanClick = useRef(false);
  const suppressAccessClick = useRef(false);
  const [panning, setPanning] = useState(false);
  const accessDrag = useRef<{
    pointerId: number;
    kind: "entrance" | "exit";
    id: string;
    startX: number;
    startY: number;
    offset: Point;
    candidate: FlowPoint;
    moved: boolean;
  } | null>(null);
  const [accessPreview, setAccessPreview] = useState<{
    kind: "entrance" | "exit";
    point: FlowPoint;
  } | null>(null);
  const drag = useRef<{
    id: string;
    offset: Point;
    original: Item;
    candidate: Item;
  } | null>(null);
  const resize = useRef<{
    edge: ResizeEdge;
    original: Item;
    candidate: Item;
  } | null>(null);
  const suppressClick = useRef(false);
  const [preview, setPreview] = useState<Item | null>(null);
  const [placementPreview, setPlacementPreview] = useState<Item | null>(null);
  const roomDrag = useRef<{ border: RoomBorder; anchor: Point } | null>(null);
  const [roomPreview, setRoomPreview] = useState<Rect | null>(null);
  const [roomPreviewValid, setRoomPreviewValid] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [screenScale, setScreenScale] = useState(1);
  useEffect(() => {
    setZoom(1);
    pan.current = null;
    accessDrag.current = null;
    setAccessPreview(null);
    setPanning(false);
    if (canvas.current) {
      canvas.current.scrollLeft = 0;
      canvas.current.scrollTop = 0;
    }
  }, [event.width, event.height]);
  useLayoutEffect(() => {
    const element = svg.current;
    if (!element) return;
    const updateScale = () => {
      const matrix = element.getScreenCTM();
      const next = matrix ? Math.hypot(matrix.a, matrix.b) : 1;
      if (Number.isFinite(next) && next > 0)
        setScreenScale((current) => Math.abs(current - next) > 0.001 ? next : current);
    };
    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(element);
    window.addEventListener("resize", updateScale);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateScale);
    };
  }, [zoom, event.width, event.height, roomEditing]);
  function positionFromClient(clientX: number, clientY: number) {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const point = new DOMPoint(clientX, clientY).matrixTransform(
      matrix.inverse(),
    );
    return { x: point.x / 20, y: point.y / 20 };
  }
  function position(e: React.PointerEvent) {
    return positionFromClient(e.clientX, e.clientY);
  }
  function accessCandidateAt(e: React.PointerEvent, current: NonNullable<typeof accessDrag.current>) {
    const point = position(e);
    return { ...current.candidate,
      x: snap(point.x - current.offset.x),
      y: snap(point.y - current.offset.y),
    };
  }
  useEffect(() => {
    if (!placement || !editable) return;
    const candidateAt = (e: PointerEvent) => {
      const point = positionFromClient(e.clientX, e.clientY);
      if (
        point.x < 0 || point.y < 0 ||
        point.x > event.width || point.y > event.height
      ) return null;
      if (placement.item.kind === "emergency_exit")
        return emergencyExitAt(placement.item, event, point);
      return {
        ...placement.item,
        x: clamp(snap(point.x - placement.item.w / 2), 0, event.width - placement.item.w),
        y: clamp(snap(point.y - placement.item.h / 2), 0, event.height - placement.item.h),
      };
    };
    const moved = (e: PointerEvent) =>
      Math.hypot(e.clientX - placement.startX, e.clientY - placement.startY) > 5;
    const movePlacement = (e: PointerEvent) => {
      if (e.pointerId !== placement.pointerId) return;
      setPlacementPreview(moved(e) ? candidateAt(e) : null);
    };
    const endPlacement = (e: PointerEvent) => {
      if (e.pointerId !== placement.pointerId) return;
      const dragged = moved(e);
      const candidate = dragged ? candidateAt(e) : null;
      setPlacementPreview(null);
      if (dragged && e.type === "pointerup") {
        if (!candidate)
          toast.error(
            placement.item.kind === "emergency_exit"
              ? "Place emergency exits on a hall boundary."
              : "Drop the item inside the floor plan.",
          );
        else if (!validPosition(event, candidate))
          toast.error("Keep objects inside the hall, clear of doors and other objects.");
        else onPlace?.(candidate);
      }
      onPlacementEnd?.();
    };
    window.addEventListener("pointermove", movePlacement);
    window.addEventListener("pointerup", endPlacement);
    window.addEventListener("pointercancel", endPlacement);
    return () => {
      window.removeEventListener("pointermove", movePlacement);
      window.removeEventListener("pointerup", endPlacement);
      window.removeEventListener("pointercancel", endPlacement);
    };
  }, [placement, editable, event, onPlace, onPlacementEnd]);
  function start(e: React.PointerEvent, item: Item) {
    suppressClick.current = false;
    if (!editable) return;
    onSelect(item.id);
    e.preventDefault();
    const p = position(e);
    drag.current = {
      id: item.id,
      offset: { x: p.x - item.x, y: p.y - item.y },
      original: item,
      candidate: item,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function startResize(e: React.PointerEvent, item: Item, edge: ResizeEdge) {
    e.stopPropagation();
    e.preventDefault();
    if (!editable || item.kind === "emergency_exit") return;
    suppressClick.current = true;
    onSelect(item.id);
    resize.current = { edge, original: item, candidate: item };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function startAccess(e: React.PointerEvent, kind: "entrance" | "exit", point: FlowPoint) {
    if (!editable || roomEditing || placement || e.button !== 0) return;
    e.preventDefault();
    suppressAccessClick.current = false;
    onSelect(kind === "entrance" && eventEntrances(event)[0].id === point.id ? "entrance" :
      kind === "exit" && eventExits(event)[0].id === point.id ? "exit" : `${kind}:${point.id}`);
    const cursor = position(e);
    accessDrag.current = { pointerId: e.pointerId, kind, id: point.id,
      startX: e.clientX, startY: e.clientY,
      offset: { x: cursor.x - point.x, y: cursor.y - point.y },
      candidate: point, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e: React.PointerEvent) {
    if (accessDrag.current?.pointerId === e.pointerId) {
      const current = accessDrag.current;
      if (!current.moved && Math.hypot(e.clientX - current.startX, e.clientY - current.startY) > 5)
        current.moved = true;
      if (current.moved) {
        current.candidate = accessCandidateAt(e, current);
        setAccessPreview({ kind: current.kind, point: current.candidate });
      }
      return;
    }
    if (pan.current?.pointerId === e.pointerId) {
      const current = pan.current;
      const dx = e.clientX - current.x;
      const dy = e.clientY - current.y;
      if (!current.moved && Math.hypot(dx, dy) > 5) {
        current.moved = true;
        setPanning(true);
        e.currentTarget.setPointerCapture(e.pointerId);
      }
      if (current.moved && canvas.current) {
        canvas.current.scrollLeft = current.scrollLeft - dx;
        canvas.current.scrollTop = current.scrollTop - dy;
      }
      return;
    }
    if (roomDrag.current) {
      const candidate = roomRectangleFromDrag(roomDrag.current.border, roomDrag.current.anchor,
        position(e), { minX: canvasMinX, minY: canvasMinY, width: canvasWidth, height: canvasHeight });
      setRoomPreview(candidate);
      setRoomPreviewValid(!!candidate && validRoomAddition(candidate));
      return;
    }
    if (resize.current) {
      const item = resizeFromEdge(
        resize.current.original,
        resize.current.edge,
        position(e),
        event,
      );
      resize.current.candidate = item;
      setPreview(item);
      return;
    }
    if (!drag.current) return;
    const p = position(e);
    if (drag.current.original.kind === "emergency_exit") {
      const candidate = emergencyExitAt(drag.current.original, event, p);
      drag.current.candidate = candidate || drag.current.original;
      setPreview(drag.current.candidate);
      return;
    }
    const item = {
      ...drag.current.original,
      x: clamp(snap(p.x - drag.current.offset.x), 0, event.width - drag.current.original.w),
      y: clamp(snap(p.y - drag.current.offset.y), 0, event.height - drag.current.original.h),
    };
    drag.current.candidate = item;
    setPreview(item);
  }
  function end(e: React.PointerEvent) {
    if (accessDrag.current?.pointerId === e.pointerId) {
      const current = accessDrag.current;
      accessDrag.current = null;
      setAccessPreview(null);
      if (!current.moved) return;
      suppressAccessClick.current = true;
      const candidate = accessCandidateAt(e, current);
      if (!canPlaceAccessPoint(event, candidate, current.id)) {
        toast.error("Place entrances and exits in an open, unused cell inside the venue.");
        return;
      }
      const points = current.kind === "entrance" ? eventEntrances(event) : eventExits(event);
      const original = points.find((point) => point.id === current.id);
      if (!original || candidate.x === original.x && candidate.y === original.y) return;
      onChange(withAccessPoints(event, current.kind,
        points.map((point) => point.id === current.id ? candidate : point)));
      return;
    }
    if (pan.current?.pointerId === e.pointerId) {
      suppressPanClick.current = pan.current.moved;
      pan.current = null;
      setPanning(false);
      return;
    }
    if (roomDrag.current) {
      const candidate = roomRectangleFromDrag(roomDrag.current.border, roomDrag.current.anchor,
        position(e), { minX: canvasMinX, minY: canvasMinY, width: canvasWidth, height: canvasHeight });
      roomDrag.current = null;
      if (candidate) {
        if (validRoomAddition(candidate)) {
          onChange(withRoomRectangle(event, candidate));
        } else toast.error("This section overlaps the room, covers an emergency exit, or exceeds the canvas.");
      }
      setRoomPreview(null);
      return;
    }
    const active = resize.current || drag.current;
    if (!active) return;
    const { candidate, original } = active;
    const wasResizing = !!resize.current;
    resize.current = null;
    drag.current = null;
    setPreview(null);
    if (
      candidate.x === original.x &&
      candidate.y === original.y &&
      candidate.w === original.w &&
      candidate.h === original.h
    ) return;
    suppressClick.current = true;
    if (!validPosition(event, candidate)) {
      toast.error(
        wasResizing
          ? "That size overlaps another object or goes outside the hall."
          : "Keep objects inside the hall, clear of doors and other objects.",
      );
      return;
    }
    onChange({
      ...event,
      items: event.items.map((i) => (i.id === candidate.id ? candidate : i)),
    });
  }
  function validRoomAddition(candidate: Rect) {
    const next = withRoomRectangle(event, candidate);
    return validRoomShape(next) && next.items.every((item) =>
      item.kind !== "emergency_exit" || onRoomBoundary(next, item));
  }
  function startRoom(e: React.PointerEvent<SVGPathElement>, border: RoomBorder) {
    if (!editable || !roomEditing || roomRectangles(event).length >= 12) return;
    e.preventDefault();
    roomDrag.current = { border, anchor: position(e) };
    setRoomPreview(null);
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function startPan(e: React.PointerEvent<SVGSVGElement>) {
    if (zoom === 1 || e.button !== 0 || placement || drag.current || resize.current || roomDrag.current || accessDrag.current) return;
    suppressPanClick.current = false;
    const viewport = canvas.current;
    if (!viewport) return;
    pan.current = {
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
      moved: false,
    };
  }
  function key(e: React.KeyboardEvent, item: Item) {
    if (roomEditing) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(item.id);
      onActivate?.(item.id);
      return;
    }
    if (!editable) return;
    if (e.shiftKey && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
      e.preventDefault();
      if (item.kind === "emergency_exit") return;
      const next = {
        ...item,
        w: item.w + (e.key === "ArrowRight" ? 0.5 : e.key === "ArrowLeft" ? -0.5 : 0),
        h: item.h + (e.key === "ArrowDown" ? 0.5 : e.key === "ArrowUp" ? -0.5 : 0),
      };
      if (next.w >= 0.5 && next.h >= 0.5 && validPosition(event, next))
        onChange({ ...event, items: event.items.map((i) => i.id === item.id ? next : i) });
      else toast.error("That size overlaps another object or goes outside the hall.");
      return;
    }
    const delta: { [key: string]: Point } = {
      ArrowUp: { x: 0, y: -0.5 },
      ArrowDown: { x: 0, y: 0.5 },
      ArrowLeft: { x: -0.5, y: 0 },
      ArrowRight: { x: 0.5, y: 0 },
    };
    if (!delta[e.key]) return;
    e.preventDefault();
    const p = delta[e.key],
      next = { ...item, x: item.x + p.x, y: item.y + p.y };
    if (validPosition(event, next))
      onChange({
        ...event,
        items: event.items.map((i) => (i.id === item.id ? next : i)),
      });
    else
      toast.error(
        "That position overlaps an object, a door, or the hall boundary.",
      );
  }
  const hallW = event.width * 20;
  const hallH = event.height * 20;
  const gridSize = gridMetersFor(event.width, event.height) * 20;
  // Preserve the fitted-map text size while allowing the map zoom to enlarge it.
  const textScale = screenScale / zoom;
  const displayedRoute = spacedRoute(route, 10 / (20 * textScale));
  const compactAccess = hallW * screenScale < 550;
  const accessMarkerWidth = (compactAccess ? 88 : 123.2) / textScale;
  const accessMarkerHeight = (compactAccess ? 28 : 44) / textScale;
  const accessMarkerFontSize = (compactAccess ? 10 : 12) / textScale;
  const accessMarkerFrame = (point: Point) => ({
    x: clamp(point.x * 20 - accessMarkerWidth / 2, 0, Math.max(0, hallW - accessMarkerWidth)),
    y: compactAccess ? point.y * 20 - accessMarkerHeight / 2 : clamp(
      point.y * 20 + (point.y < event.height / 2 ? 5 / textScale : -accessMarkerHeight - 5 / textScale),
      0,
      Math.max(0, hallH - accessMarkerHeight),
    ),
  });
  const entrances = eventEntrances(event), exits = eventExits(event);
  const entranceFlow = entrances.reduce((sum, point) => sum + point.flow, 0);
  const exitFlow = exits.reduce((sum, point) => sum + point.flow, 0);
  const accessMarkers = [
    ...entrances.map((point, index) => ({ kind: "entrance" as const, point, index,
      share: point.flow / entranceFlow * 100 })),
    ...exits.map((point, index) => ({ kind: "exit" as const, point, index,
      share: point.flow / exitFlow * 100 })),
  ];
  const liveAgents = simulation ? agentsAtStep(simulation, time) : [];
  const queueCounts = queueCountsAtStep(liveAgents, time);
  const canvasMinX = roomEditing ? -6 : 0;
  const canvasMinY = roomEditing ? -6 : 0;
  const canvasWidth = roomEditing ? Math.min(MAX_MAP_SIZE, Math.max(40, event.width + 8)) : event.width;
  const canvasHeight = roomEditing ? Math.min(MAX_MAP_SIZE, Math.max(28, event.height + 6)) : event.height;
  const zoomable = true;
  const borders = roomBoundarySegments(event);
  const displayed = event.items.map((i) =>
    preview?.id === i.id ? preview : i,
  );
  const PlacementIcon = objectIcons[placementPreview?.kind || "obstacle"];
  const placementIconSize = placementPreview?.kind === "emergency_exit" ? 14 : 24;
  return (
    <div ref={canvas} className={`map-canvas architectural-map${zoomable ? " zoomable" : ""}${zoom > 1 ? " zoomed" : ""}${panning ? " panning" : ""}`}>
      {zoomable && <div className="map-zoom-controls" role="group" aria-label="Map zoom">
        <button type="button" aria-label="Zoom out of map" disabled={zoom === 1}
          onClick={() => setZoom((value) => Math.max(1, value / 2))}>−</button>
        <span aria-live="polite">{zoom * 100}%</span>
        <button type="button" aria-label="Zoom in on map" disabled={zoom === 16}
          onClick={() => setZoom((value) => Math.min(16, value * 2))}>+</button>
        <button type="button" className="map-fit" aria-label="Fit map to view" title="Fit map to view"
          onClick={() => { setZoom(1); if (canvas.current) { canvas.current.scrollLeft = 0; canvas.current.scrollTop = 0; } }}><Scan size={16} /></button>
      </div>}
      <svg
        ref={svg}
        style={zoom > 1 ? { width: `${zoom * 100}%`, height: `${zoom * 100}%`, maxWidth: "none" } : undefined}
        viewBox={`${canvasMinX * 20 - 45} ${canvasMinY * 20 - 38} ${(canvasWidth - canvasMinX) * 20 + 90} ${(canvasHeight - canvasMinY) * 20 + 85}`}
        aria-label="Interactive event floor plan"
        onPointerDown={startPan}
        onPointerMove={move}
        onPointerUp={end}
        onClickCapture={(e) => {
          if (suppressPanClick.current) {
            e.preventDefault();
            e.stopPropagation();
            suppressPanClick.current = false;
          }
        }}
        onPointerCancel={() => {
          pan.current = null;
          setPanning(false);
          accessDrag.current = null;
          setAccessPreview(null);
          drag.current = null;
          resize.current = null;
          roomDrag.current = null;
          setPreview(null);
          setRoomPreview(null);
        }}
      >
        <title>
          {roomEditing ? "Room editor" :
            "Event floor plan. Drag the map to explore when zoomed in. In organizer view, drag entrances, exits, and objects to move them; drag a selected object edge to resize it."}
        </title>
        <defs>
          <radialGradient id="stage-spotlight-glow">
            <stop offset="0%" stopColor="#c5a2f0" stopOpacity=".6" />
            <stop offset="60%" stopColor="#c5a2f0" stopOpacity=".3" />
            <stop offset="100%" stopColor="#c5a2f0" stopOpacity="0" />
          </radialGradient>
          <clipPath id="room-floor-clip">
            {roomRectangles(event).map((r, i) => <rect key={i} x={r.x * 20} y={r.y * 20}
              width={r.w * 20} height={r.h * 20} />)}
          </clipPath>
          <mask id="crowd-floor-mask" maskUnits="userSpaceOnUse" x="0" y="0" width={hallW} height={hallH}>
            <rect width={hallW} height={hallH} fill="black" />
            {roomRectangles(event).map((r, i) => <rect key={i} x={r.x * 20} y={r.y * 20}
              width={r.w * 20} height={r.h * 20} fill="white" />)}
            {event.items.filter((item) => item.kind !== "stairs" && item.kind !== "emergency_exit").map((item) =>
              <rect key={item.id} x={item.x * 20} y={item.y * 20} width={item.w * 20} height={item.h * 20} fill="black" />)}
          </mask>
          <pattern
            id="floor-grid"
            width={gridSize}
            height={gridSize}
            patternUnits="userSpaceOnUse"
          >
            <path
              d={`M ${gridSize} 0 L 0 0 0 ${gridSize}`}
              fill="none"
              stroke="#e9edef"
              strokeWidth={Math.max(0.6, 0.8 / screenScale)}
            />
          </pattern>
          <pattern
            id="obstacle-hatch"
            width="6"
            height="6"
            patternTransform="rotate(45)"
            patternUnits="userSpaceOnUse"
          >
            <rect width="6" height="6" fill="#edf0f4" />
            <line y2="6" stroke="#dfe5ec" strokeWidth="1" />
          </pattern>
        </defs>
        {roomEditing && <g pointerEvents="none">
          <rect x={canvasMinX * 20} y={canvasMinY * 20}
            width={(canvasWidth - canvasMinX) * 20} height={(canvasHeight - canvasMinY) * 20} fill="#f1f7f4" />
          <rect x={canvasMinX * 20} y={canvasMinY * 20}
            width={(canvasWidth - canvasMinX) * 20} height={(canvasHeight - canvasMinY) * 20} fill="url(#floor-grid)" />
          <rect x={canvasMinX * 20} y={canvasMinY * 20}
            width={(canvasWidth - canvasMinX) * 20} height={(canvasHeight - canvasMinY) * 20} fill="none"
            stroke="#9bcab6" strokeWidth="2" strokeDasharray="7 6" />
        </g>}
        <g clipPath="url(#room-floor-clip)">
          <rect width={hallW} height={hallH} fill="#fff" />
          <rect width={hallW} height={hallH} fill="url(#floor-grid)" />
          <MapPlants event={event} items={placementPreview ? [...displayed, placementPreview] : displayed} />
        </g>
        <path d={borders.map(borderPath).join(" ")} fill="none" stroke="#27333d"
          strokeWidth="6" strokeLinejoin="miter" pointerEvents="none" />
        {accessMarkers.map(({ kind, point }) => {
          const actual = accessPreview?.kind === kind && accessPreview.point.id === point.id ? accessPreview.point : point;
          const door = doorwayFor(event, actual);
          if (!door) return null;
          const half = door.width * 10;
          return <g key={`door-${kind}-${point.id}`} pointerEvents="none" aria-hidden="true"
            transform={`translate(${door.x * 20} ${door.y * 20}) rotate(${door.rotation})`}>
            <path d={`M${-half} 0H${half}`} stroke="#fff" strokeWidth="8" />
            <path d={`M${-half} 0v${half} M${half} 0v${half}`} fill="none" stroke="#52616c" strokeWidth="1.5" />
            <path d={`M${-half} ${half}A${half} ${half} 0 0 0 0 0 A${half} ${half} 0 0 0 ${half} ${half}`}
              fill="none" stroke="#80909b" strokeWidth="1" strokeDasharray="3 3" />
          </g>;
        })}
        {roomPreview && <rect x={roomPreview.x * 20} y={roomPreview.y * 20}
          width={roomPreview.w * 20} height={roomPreview.h * 20}
          fill={roomPreviewValid ? "#bce8d3" : "#ffe0da"} fillOpacity=".8"
          stroke={roomPreviewValid ? "#23845c" : "#c64f3b"} strokeWidth="2"
          strokeDasharray="6 4" pointerEvents="none" />}
        {roomEditing && <>
          <text x={hallW / 2} y="-19" textAnchor="middle" className="dimension">
            Room width · {event.width} m
          </text>
          <text
            x="-18"
            y={hallH / 2}
            textAnchor="middle"
            transform={`rotate(-90 -18 ${hallH / 2})`}
            className="dimension"
          >
            Room depth · {event.height} m
          </text>
        </>}
        {!roomEditing && !(heat && simulation) && <g mask="url(#crowd-floor-mask)" pointerEvents="none" aria-hidden="true">
          {displayed.filter((item) => item.kind === "stage" && stageSpotlightFor(item) > 0).map((item) => (
            <ellipse key={item.id} data-testid={`stage-spotlight-${item.id}`}
              cx={(item.x + item.w / 2) * 20} cy={(item.y + item.h / 2) * 20}
              rx={(item.w / 2 + 4) * 20} ry={(item.h / 2 + 4) * 20}
              fill="url(#stage-spotlight-glow)" opacity={stageSpotlightFor(item) / 100} />
          ))}
        </g>}
        {heat && (congestion || simulation) && <HeatSurface event={event} simulation={(congestion || simulation)!} />}
        {displayed.map((item) => {
          const chosen = !roomEditing && selected === item.id,
            invalid = preview?.id === item.id && !validPosition(event, item),
            highlight = highlights.includes(item.id);
          const FacilityIcon = objectIcons[item.kind];
          return (
            <g
              key={item.id}
              pointerEvents={roomEditing ? "none" : undefined}
              data-testid={`map-${item.id}`}
              role="button"
              tabIndex={roomEditing ? -1 : 0}
              aria-label={`${item.label}: ${item.company || item.name}${item.kind === "booth" && !item.company ? ", available" : ""}`}
              aria-pressed={chosen}
              transform={`translate(${item.x * 20} ${item.y * 20})`}
              onPointerDown={(e) => start(e, item)}
              onClick={() => {
                if (suppressClick.current) {
                  suppressClick.current = false;
                  return;
                }
                onSelect(item.id);
                onActivate?.(item.id);
              }}
              onKeyDown={(e) => key(e, item)}
              className={`map-object ${editable && !roomEditing ? "draggable" : ""}`}
            >
              <title>{item.company || item.name || "Available space"}</title>
              <rect
                width={item.w * 20}
                height={item.h * 20}
                rx={item.kind === "stage" || item.kind === "restroom" ? 0 : 2}
                fill={
                  item.kind === "obstacle"
                    ? "url(#obstacle-hatch)"
                    : item.kind === "food"
                      ? "#fcf0dc"
                      : facilityFill[item.kind]
                        ? facilityFill[item.kind]
                      : highlight
                        ? "#e9f6ee"
                        : item.company
                          ? "#edf3ff"
                          : "#f9fbfc"
                }
                stroke="#647580"
                strokeWidth="0.65"
              />
              <MapFurniture item={item} detailed={item.w * 20 * screenScale >= 65 && item.h * 20 * screenScale >= 45} />
              {(invalid || chosen || highlight) && (
                <rect x="-3" y="-3" width={item.w * 20 + 6} height={item.h * 20 + 6}
                  rx="7" fill="none"
                  stroke={invalid ? "#ce3333" : chosen ? "#ed6a32" : "#bd4b2b"}
                  strokeWidth="1" pointerEvents="none" aria-hidden="true" />
              )}
              {item.kind === "stage" && stageSpotlightFor(item) > 0 && (
                <rect x="1" y="1" width={Math.max(0, item.w * 20 - 2)} height={Math.max(0, item.h * 20 - 2)}
                  rx="4" fill="url(#stage-spotlight-glow)" opacity={stageSpotlightFor(item) / 100}
                  pointerEvents="none" aria-hidden="true" />
              )}
              {item.h * 20 * screenScale >= 40 && item.w * 20 * screenScale >= 85 && <text x={7 / textScale} y={21 / textScale}
                className="booth-number" style={{ fontSize: 10 / textScale }}>
                {item.label}
              </text>}
              <MapItemLabel item={item} screenScale={screenScale} textScale={textScale} />
              {facilityFill[item.kind] && item.h * 20 * screenScale >= 40 && item.w * 20 * screenScale >= 85 && (
                <FacilityIcon
                  x={item.w * 20 - 17 / textScale}
                  y={4 / textScale}
                  width={12 / textScale}
                  height={12 / textScale}
                  style={{ width: 12 / textScale, height: 12 / textScale }}
                  color={item.kind === "emergency_exit" ? "#29805a" : "#536b83"}
                  strokeWidth={1.8}
                  pointerEvents="none"
                />
              )}
              {highlight && (
                <text
                  x={item.w * 20 - 12}
                  y={item.h * 20 - 9}
                  fill="#287759"
                  fontSize="11"
                >
                  ✓
                </text>
              )}
              {editable && !roomEditing && chosen && item.kind !== "emergency_exit" && (["north", "east", "south", "west"] as const).map((edge) => (
                <rect
                  key={edge}
                  className={`resize-handle resize-${edge}`}
                  x={edge === "east" ? item.w * 20 - 5 : edge === "west" ? -5 : item.w * 10 - 9}
                  y={edge === "south" ? item.h * 20 - 5 : edge === "north" ? -5 : item.h * 10 - 9}
                  width={edge === "east" || edge === "west" ? 10 : 18}
                  height={edge === "north" || edge === "south" ? 10 : 18}
                  rx="3"
                  aria-hidden="true"
                  onPointerDown={(e) => startResize(e, item, edge)}
                  onClick={(e) => e.stopPropagation()}
                />
              ))}
            </g>
          );
        })}
        {placementPreview && (
          <g
            className="placement-preview"
            aria-hidden="true"
            pointerEvents="none"
            transform={`translate(${placementPreview.x * 20} ${placementPreview.y * 20})`}
          >
            <rect
              width={placementPreview.w * 20}
              height={placementPreview.h * 20}
              rx="5"
              fill={
                !validPosition(event, placementPreview)
                  ? "#fff1ed"
                  : placementPreview.kind === "booth"
                    ? "#cfe2fa"
                  : placementPreview.kind === "food"
                      ? "#fce4bb"
                      : facilityFill[placementPreview.kind] || "#d9e0e8"
              }
              stroke="#000"
              strokeOpacity=".65"
              strokeWidth="1"
            />
            <rect x="-3" y="-3" width={placementPreview.w * 20 + 6}
              height={placementPreview.h * 20 + 6} rx="7" fill="none"
              stroke={validPosition(event, placementPreview) ? "#ed6a32" : "#ce3333"}
              strokeWidth="1" />
            <PlacementIcon
              x={placementPreview.w * 10 - placementIconSize / 2}
              y={placementPreview.h * 10 - placementIconSize / 2}
              width={placementIconSize}
              height={placementIconSize}
              color="#526b83"
              strokeWidth={1.7}
            />
          </g>
        )}
        {simulation && heat && (
          <rect
            x={simulation.hotspot.x * 20}
            y={simulation.hotspot.y * 20}
            width="40"
            height="40"
            rx="20"
            fill="none"
            stroke="#c7472e"
            strokeDasharray="4 3"
            strokeWidth="1.5"
            pointerEvents="none"
          />
        )}
        {accessMarkers.map(({ kind, point, index, share }) => {
          const displayedPoint = accessPreview?.kind === kind && accessPreview.point.id === point.id
            ? accessPreview.point : point;
          const frame = accessMarkerFrame(displayedPoint);
          const invalid = displayedPoint !== point && !canPlaceAccessPoint(event, displayedPoint, point.id);
          const selectionId = index === 0 ? kind : `${kind}:${point.id}`;
          return <g key={`${kind}-${point.id}`}
            className={`map-access-marker${editable && !roomEditing ? " draggable" : ""}`}
            pointerEvents={roomEditing ? "none" : undefined}
            role="button" tabIndex={roomEditing ? -1 : 0}
            aria-label={`${kind === "entrance" ? "Entrance" : "Exit"} ${index + 1} location, ${share.toFixed(0)}% of ${kind === "entrance" ? "arrivals" : "departures"}`}
            onPointerDown={(e) => startAccess(e, kind, point)}
            onClick={() => {
              if (suppressAccessClick.current) {
                suppressAccessClick.current = false;
                return;
              }
              onSelect(selectionId);
              onActivate?.(selectionId);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(selectionId);
                onActivate?.(selectionId);
              }
            }}>
            <rect x={frame.x} y={frame.y} width={accessMarkerWidth} height={accessMarkerHeight}
              rx={5 / textScale} fill={invalid ? "#ffe5de" : kind === "entrance" ? "#e1f3eb" : "#e7eff9"}
              fillOpacity=".96"
              stroke={invalid ? "#c53f29" : kind === "entrance" ? "#4a8c76" : "#6685a3"}
              strokeWidth={selected === selectionId ? 2 : 1.5} />
            <text x={frame.x + accessMarkerWidth / 2} y={frame.y + (compactAccess ? 14 : 16) / textScale}
              textAnchor="middle" dominantBaseline="central" className="entrance-label"
              style={{ fontSize: accessMarkerFontSize, letterSpacing: 0.4 / textScale,
                fill: kind === "entrance" ? "#2e7760" : "#315e8c" }}>
              {kind === "entrance" ? "ENTRANCE" : "EXIT"} {index + 1}
            </text>
            {!compactAccess && <text x={frame.x + accessMarkerWidth / 2} y={frame.y + 33 / textScale}
              textAnchor="middle" dominantBaseline="central" className="entrance-label"
              style={{ fontSize: 10 / textScale, letterSpacing: 0,
                fill: kind === "entrance" ? "#2e7760" : "#315e8c" }}>
              {share.toFixed(0)}% of {kind === "entrance" ? "arrivals" : "departures"}
            </text>}
          </g>;
        })}
        {people && simulation && <g mask="url(#crowd-floor-mask)" pointerEvents="none" aria-hidden="true">
          {liveAgents.map(({ agent, point, pathIndex, queueVisit }) => {
            const before = agent.path[Math.max(0, pathIndex - 1)], after = agent.path[pathIndex + 1] ?? point;
            const heading = { x: after.x - before.x, y: after.y - before.y };
            const count = queueVisit ? queuePeopleRemaining(agent.weight, queueVisit, time) : agent.weight;
            const initial = crowdFootprint(count, !!queueVisit, heading);
            const free = footprintFreeFraction(point, initial, (p) => segmentIsWalkable(event, point, p));
            const shape = crowdFootprint(count, !!queueVisit, heading, free);
            return <ellipse key={`footprint-${agent.id}`} cx={point.x * 20} cy={point.y * 20}
              rx={shape.along * 20} ry={shape.across * 20}
              transform={`rotate(${Math.atan2(shape.direction.y, shape.direction.x) * 180 / Math.PI} ${point.x * 20} ${point.y * 20})`}
              fill={visitorProfiles[agent.type].color} fillOpacity={Math.min(0.12, 0.045 * shape.pressure)}
              stroke={visitorProfiles[agent.type].color} strokeOpacity=".16" strokeWidth={1 / textScale} />;
          })}
        </g>}
        {people && simulation && simulation.queues.filter((queue) => queueCounts.has(queue.itemId)).map((queue) => (
          <polyline key={`queue-${queue.itemId}`} pointerEvents="none"
            points={[queue.points[0], ...liveAgents.filter((entry) => entry.queueVisit?.itemId === queue.itemId)
              .map((entry) => entry.point).sort((a, b) => a.y - b.y)].filter(Boolean)
              .map((point) => `${point.x * 20},${point.y * 20}`).join(" ")}
            fill="none" stroke="#334155" strokeWidth={2 / textScale}
            strokeDasharray={`${4 / textScale} ${3 / textScale}`} opacity=".65" />
        ))}
        {people && simulation && <g clipPath="url(#room-floor-clip)">
          {liveAgents.map(({ agent, point, pathIndex }) => <CrowdTrace key={`trace-${agent.id}`}
            agent={agent} point={point} pathIndex={pathIndex} textScale={textScale} />)}
        </g>}
        {people && simulation && liveAgents.map(({ agent, point, queueVisit }) => {
          const count = agent.weight;
          const profile = visitorProfiles[agent.type];
          const radius = (count === 1 ? 3.5 : Math.min(17, 5 + Math.log10(count) * 3)) / textScale;
          return (
            <g key={agent.id} pointerEvents="none" aria-hidden="true">
              <g transform={`translate(${point.x * 20} ${point.y * 20})`}>
                {count > 1 && <circle r={radius + 3 / textScale} fill={profile.color} opacity=".15" />}
                <circle r={radius} fill={profile.color} stroke="#fff" strokeWidth={1.5 / textScale} />
                {queueVisit && <circle r={radius + 2 / textScale} fill="none" stroke="#334155"
                  strokeWidth={1.5 / textScale} strokeDasharray={queueVisit.serviceStart === null || time < queueVisit.serviceStart ?
                    `${3 / textScale} ${2 / textScale}` : undefined} />}
                {count > 1 && !queueVisit && <text fill="#172838" fontSize={10 / textScale} fontWeight="700"
                  textAnchor="middle" dominantBaseline="central">
                  {crowdNumber.format(count)}
                </text>}
              </g>
            </g>
          );
        })}
        {people && simulation && simulation.queues.map((queue) => {
          const total = queueCounts.get(queue.itemId), point = queue.points[0];
          if (!total || total.count <= 0 || !point) return null;
          const label = queueNumber.format(total.count);
          const radius = Math.max(12 + Math.log10(Math.max(1, total.remaining)) * 3,
            7 + label.length * 2.5) / textScale;
          const name = event.items.find((item) => item.id === queue.itemId)?.label ?? "Booth";
          return <g key={`queue-count-${queue.itemId}`} pointerEvents="none"
            transform={`translate(${point.x * 20} ${point.y * 20})`} role="img"
            aria-label={`${name}: estimated queue ${label} visitors`}>
            <circle r={radius} fill="#f8fafc" stroke="#334155" strokeWidth={2 / textScale} />
            <text fill="#172838" fontSize={11 / textScale} fontWeight="700"
              textAnchor="middle" dominantBaseline="central">{label}</text>
          </g>;
        })}
        {route.length > 0 && <g className="visitor-map-route" pointerEvents="none" role="img" aria-label="Suggested walking route with numbered stops, from entrance to exit">
          <polyline points={displayedRoute.map((p) => `${p.x * 20},${p.y * 20}`).join(" ")}
            fill="none" stroke="white" strokeWidth={8 / textScale} strokeLinejoin="round" strokeLinecap="round" />
          <polyline points={displayedRoute.map((p) => `${p.x * 20},${p.y * 20}`).join(" ")}
            fill="none" stroke="#157b69" strokeWidth={4 / textScale} strokeLinejoin="round" strokeLinecap="round" />
          {displayedRoute.map((point, index) => {
            const next = displayedRoute[index + 1];
            const spacing = Math.max(2, Math.round(48 / (20 * textScale * (route[1] ? Math.hypot(route[1].x - route[0].x, route[1].y - route[0].y) : 1))));
            if (!next || Math.hypot(next.x - point.x, next.y - point.y) < .01 || index % spacing !== Math.floor(spacing / 2)) return null;
            const angle = Math.atan2(next.y - point.y, next.x - point.x) * 180 / Math.PI;
            return <path key={index} d="M -3 -3 L 1 0 L -3 3" fill="none" stroke="white" strokeWidth="1.6"
              transform={`translate(${point.x * 20} ${point.y * 20}) rotate(${angle}) scale(${1 / textScale})`} />;
          })}
          {[
            { point: route[0], label: "S", name: "Entrance", active: false },
            ...routeStops.map((stop, index) => ({ point: stop.point, label: String(index + 1), name: stop.item.company || stop.item.name, active: selected === stop.item.id })),
            ...(routeExitReachable ? [{ point: route[route.length - 1], label: "E", name: "Exit", active: false }] : []),
          ].map((stop, index) => <g key={index} transform={`translate(${stop.point.x * 20} ${stop.point.y * 20}) scale(${1 / textScale})`}>
            <title>{stop.label}: {stop.name}</title>
            {stop.active && <circle r="18" fill="#157b69" fillOpacity=".18" />}
            <circle r="12" fill={stop.active ? "#0e5046" : "#157b69"} stroke="white" strokeWidth="2.5" />
            <text fill="white" fontSize="12" fontWeight="750" textAnchor="middle" dominantBaseline="central">{stop.label}</text>
          </g>)}
        </g>}
        {roomEditing && roomRectangles(event).length < 12 && borders.filter((border) => {
          if ((border.side === "east" || border.side === "west") && event.width >= MAX_MAP_SIZE) return false;
          if ((border.side === "north" || border.side === "south") && event.height >= MAX_MAP_SIZE) return false;
          return border.side === "east" ? border.coordinate < canvasWidth :
            border.side === "south" ? border.coordinate < canvasHeight :
            border.side === "west" ? border.coordinate > canvasMinX :
            border.coordinate > canvasMinY;
        }).map((border, index) => (
          <g key={`${border.side}-${border.coordinate}-${border.start}-${index}`}>
            <path d={borderPath(border)} fill="none" stroke="#3aa879" strokeWidth="3"
              pointerEvents="none" />
            <path d={borderPath(border)} className="room-add-edge" fill="none"
              stroke="transparent" strokeWidth="16" onPointerDown={(e) => startRoom(e, border)}>
              <title>Add room section</title>
            </path>
          </g>
        ))}
      </svg>
    </div>
  );
}
