"use client";
import { useEffect, useState } from "react";
import { gridFor, type Simulation } from "@/lib/simulation";
import type { FairEvent } from "@/lib/event";
import { heatSurfacePixels, smoothHeatField } from "@/lib/heat-surface";

type HeatData = Pick<Simulation, "cell" | "peakLocalDensity">;

export default function HeatSurface({ event, simulation }: { event: FairEvent; simulation: HeatData }) {
  const [image, setImage] = useState<{ source: HeatData; layout: FairEvent; url: string } | null>(null);
  useEffect(() => {
    const grid = gridFor(event);
    const field = smoothHeatField(simulation.peakLocalDensity, grid);
    const raster = heatSurfacePixels(field, grid);
    const canvas = document.createElement("canvas");
    canvas.width = raster.width;
    canvas.height = raster.height;
    const context = canvas.getContext("2d");
    if (!context) return;
    const data = context.createImageData(raster.width, raster.height);
    data.data.set(raster.pixels);
    context.putImageData(data, 0, 0);
    setImage({ source: simulation, layout: event, url: canvas.toDataURL("image/png") });
  }, [event, simulation]);
  if (!image || image.source !== simulation || image.layout !== event) return null;
  const cell = simulation.cell;
  return <image href={image.url} x="0" y="0" width={Math.ceil(event.width / cell) * cell * 20}
    height={Math.ceil(event.height / cell) * cell * 20} preserveAspectRatio="none"
    mask="url(#crowd-floor-mask)" pointerEvents="none" aria-label="Peak crowd density: deeper yellow-orange means more people per square metre" />;
}
