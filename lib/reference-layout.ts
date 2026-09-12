import { seedEvent, type FairEvent, type Item, type ItemKind } from "./event.ts";

/** Approximate proportions from background.pdf, not measured building dimensions. */
export function referenceLayout(): FairEvent {
  const item = (id: string, kind: ItemKind, name: string, x: number, y: number,
    w: number, h: number): Item => ({ id, kind, label: id.toUpperCase(), name,
    x, y, w, h, company: "", category: "", popularity: 2, dwell: 60 });
  return {
    ...seedEvent(), name: "Café & stage", venue: "Reference hall",
    width: 40, height: 23, visitors: 1000,
    roomRectangles: [
      { x: 0, y: 0, w: 31.5, h: 20 },
      { x: 31.5, y: 6, w: 8.5, h: 15 },
      { x: 9, y: 20, w: 22.5, h: 1 },
      { x: 16.5, y: 21, w: 13, h: 2 },
    ],
    entrance: { x: 4.5, y: 19.5 }, exit: { x: 26.5, y: 0.5 },
    items: [
      ...[[2, 2.5], [10, 2.5], [23, 3.5], [3.5, 8.5], [11, 7.5],
        [17, 10], [23, 8.5], [2.5, 14], [11, 13], [27.5, 13]]
        .map(([x, y], i) => item(`b${String(i + 1).padStart(2, "0")}`, "booth", "Exhibition table", x, y, 4.5, 3)),
      item("f01", "food", "Café", 18.5, 15, 4.5, 3),
      { ...item("g01", "stage", "Stage", 17, 21, 12, 2), stageSpotlight: 40 },
      item("wc01", "restroom", "Restrooms", 32.5, 6.5, 7, 5),
      item("s01", "seating", "Lounge seating", 34, 16, 5, 3.5),
      { ...item("r01", "reception", "Welcome desk", 9, 18, 4.5, 2), processingRate: 20 },
    ],
  };
}
