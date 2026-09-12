import type { Item } from "@/lib/event";

/** Architectural symbols stay inside the object's actual collision footprint. */
export default function MapFurniture({ item, detailed }: { item: Item; detailed: boolean }) {
  const w = item.w * 20, h = item.h * 20;
  if (!detailed || w < 32 || h < 28) return null;
  const seats = Math.min(6, Math.max(2, Math.floor(w / 22)));
  return <g className="map-furniture" pointerEvents="none" aria-hidden="true"
    fill="none" stroke="currentColor" strokeWidth="1.1">
    {(item.kind === "booth" || item.kind === "reception" || item.kind === "food") && <>
      {Array.from({ length: seats }, (_, i) => <rect key={i}
        x={6 + (w - 12) / seats * (i + .5) - 5} y="4" width="10" height="7" rx="2" fill="#fff" />)}
      <rect x="4" y="12" width={w - 8} height={h - 16} rx="1" />
      {item.kind === "food" && <path d={`M${w - 15} ${h - 10}h7m-7 -3h7`} />}
    </>}
    {item.kind === "stage" && <>
      <path d={`M4 ${h - 12}H${w - 4} M4 ${h - 7}H${w - 4}`} />
      <rect x="5" y="5" width="7" height="10" rx="1" />
      <rect x={w - 12} y="5" width="7" height="10" rx="1" />
    </>}
    {item.kind === "seating" && Array.from({ length: seats }, (_, i) => <g key={i}
      transform={`translate(${(w / seats) * (i + .5)} ${h - 12})`}>
      <rect x="-5" y="-4" width="10" height="8" rx="2" fill="#fff" />
      <path d="M-6 1v5h12v-5" />
    </g>)}
    {item.kind === "restroom" && Array.from({ length: 3 }, (_, i) => <g key={i}
      transform={`translate(${4 + (w - 8) / 3 * i} ${h - 18})`}>
      <path d={`M0 14V0h${(w - 8) / 3 - 3}v14`} />
      <rect x="4" y="2" width="7" height="3" rx="1" />
      <ellipse cx="7.5" cy="9" rx="3.5" ry="4" />
    </g>)}
    {item.kind === "stairs" && Array.from({ length: 5 }, (_, i) =>
      <path key={i} d={`M4 ${h - 5 - i * 4}H${w - 4}`} />)}
  </g>;
}
