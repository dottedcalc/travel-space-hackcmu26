import { z } from "zod";
export const sizeSchema = z.object({ name: z.string().min(1).max(30), w: z.number().min(0.5).max(1000).multipleOf(0.5), h: z.number().min(0.5).max(1000).multipleOf(0.5) });
export const profileSchema = z.object({
  popularity: z.number().min(1).max(3), historicalVisitors: z.number().int().min(0).max(10_000_000).optional(),
  peakRate: z.number().min(0.01).max(10000), dwell: z.number().int().min(10).max(1800),
  staff: z.number().int().min(1).max(1000), equipmentArea: z.number().min(0).max(10000),
  storageArea: z.number().min(0).max(10000), serviceRate: z.number().min(0.1).max(120),
  minimumArea: z.number().min(0).max(10000), maximumBudget: z.number().min(0).max(1e9).optional(),
  preferredLocation: z.enum(["any", "entrance", "quiet"]),
  preferredNeighbors: z.array(z.string().max(100)).max(100), avoidNeighbors: z.array(z.string().max(100)).max(100),
  source: z.enum(["estimated", "historical"]),
}).strict();
export const seatPolicySchema = z.object({ price: z.number().min(0).max(1e9).optional(), disabled: z.boolean().optional(), requiredCategory: z.string().max(50).optional() });
const metric = z.number().finite().min(0);
const score = metric.max(100);
export const metricsSchema = z.object({ visitors: metric, intended: metric, missedRate: metric.max(1), queueSeconds: metric, exposure: metric, density: metric, coverage: metric.max(1), balance: metric.max(1), neighborVisitChange: z.number().finite(), companyScore: score, venueScore: score, score });
export const scenarioSchema = z.object({ seatId: z.string().min(1).max(60), label: z.string().max(20), metrics: metricsSchema });
export const reservationSchema = z.object({ companyId: z.string().min(1).max(200), seatId: z.string().min(1).max(60), size: sizeSchema,
  revision: z.number().int().min(0), requestId: z.string().uuid(), scenarios: z.array(scenarioSchema).min(1).max(5), undersizedAcknowledged: z.boolean() }).strict();
