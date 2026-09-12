export type HeatGrid = { w: number; h: number; cell: number; blocked: Uint8Array };
const free = (grid: HeatGrid, x: number, y: number) =>
  x >= 0 && y >= 0 && x < grid.w && y < grid.h && !grid.blocked[y * grid.w + x];

/** Every touched grid cell, including both sides of diagonal corners. */
function crossing(dx: number, dy: number) {
  const cells = [{ x: 0, y: 0 }];
  let x = 0, y = 0;
  const sx = Math.sign(dx), sy = Math.sign(dy);
  const stepX = dx ? 1 / Math.abs(dx) : Infinity, stepY = dy ? 1 / Math.abs(dy) : Infinity;
  let nextX = stepX / 2, nextY = stepY / 2;
  while (x !== dx || y !== dy) {
    if (Math.abs(nextX - nextY) < 1e-8) {
      cells.push({ x: x + sx, y }, { x, y: y + sy });
      x += sx; y += sy; nextX += stepX; nextY += stepY;
    } else if (nextX < nextY) { x += sx; nextX += stepX; }
    else { y += sy; nextY += stepY; }
    cells.push({ x, y });
  }
  return cells;
}

/** Display-only smoothing; measured peaks and simulation statistics remain untouched. */
export function smoothHeatField(values: readonly number[], grid: HeatGrid) {
  const sigma = Math.max(0.7, grid.cell * 0.7);
  const radius = Math.ceil(2 * sigma / grid.cell);
  const kernel = [];
  for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
    const distance2 = (dx * dx + dy * dy) * grid.cell ** 2;
    if (distance2 > (2 * sigma) ** 2) continue;
    kernel.push({ dx, dy, weight: Math.exp(-distance2 / (2 * sigma ** 2)), cells: crossing(dx, dy) });
  }
  const field = new Float32Array(grid.w * grid.h);
  for (let y = 0; y < grid.h; y++) for (let x = 0; x < grid.w; x++) {
    const index = y * grid.w + x;
    if (grid.blocked[index]) continue;
    let sum = 0, weights = 0, peak = true;
    const original = values[index] ?? 0;
    for (const tap of kernel) {
      if (!tap.cells.every((p) => free(grid, x + p.x, y + p.y))) continue;
      const value = values[(y + tap.dy) * grid.w + x + tap.dx] ?? 0;
      sum += value * tap.weight;
      weights += tap.weight;
      if (value > original) peak = false;
    }
    // Retain local maxima so a narrow bottleneck still reaches its original color band.
    field[index] = peak && original > 0 ? original : weights ? sum / weights : 0;
  }
  return field;
}

/** One hue in four distinct opacity bands; negligible density stays transparent. */
export const HEAT_LEVELS = [
  { max: 1, color: [233, 162, 59, 21] },
  { max: 2, color: [233, 162, 59, 42] },
  { max: 4, color: [233, 162, 59, 94] },
  { max: Infinity, color: [233, 162, 59, 125] },
] as const;

export function heatColor(value: number): readonly number[] {
  if (!(value >= 0.05)) return [0, 0, 0, 0];
  return HEAT_LEVELS.find((level) => value < level.max)?.color ?? HEAT_LEVELS[3].color;
}

/** Raster interpolation is bounded in size and cannot mix across blocked corners. */
export function heatSurfacePixels(field: Float32Array, grid: HeatGrid) {
  const scale = Math.min(6, 1200 / Math.max(grid.w, grid.h));
  const width = Math.ceil(grid.w * scale), height = Math.ceil(grid.h * scale);
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) {
    const gx = (px + 0.5) / width * grid.w, gy = (py + 0.5) / height * grid.h;
    const cellX = Math.floor(gx), cellY = Math.floor(gy);
    if (!free(grid, cellX, cellY)) continue;
    const x0 = Math.floor(gx - 0.5), y0 = Math.floor(gy - 0.5);
    const fx = gx - 0.5 - x0, fy = gy - 0.5 - y0;
    let total = 0, weights = 0;
    for (let dy = 0; dy <= 1; dy++) for (let dx = 0; dx <= 1; dx++) {
      const x = x0 + dx, y = y0 + dy;
      if (!free(grid, x, y) || !free(grid, x, cellY) || !free(grid, cellX, y)) continue;
      const weight = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
      total += field[y * grid.w + x] * weight;
      weights += weight;
    }
    const value = weights ? total / weights : 0;
    const color = heatColor(value);
    pixels.set(color, (py * width + px) * 4);
  }
  return { width, height, pixels };
}
