export type BoothSize = { name: string; w: number; h: number };
export type ExhibitorProfile = {
  popularity: number;
  historicalVisitors?: number;
  peakRate: number;
  dwell: number;
  staff: number;
  equipmentArea: number;
  storageArea: number;
  serviceRate: number;
  minimumArea: number;
  maximumBudget?: number;
  preferredLocation: "any" | "entrance" | "quiet";
  preferredNeighbors: string[];
  avoidNeighbors: string[];
  source: "estimated" | "historical";
};
export type SeatPolicy = { price?: number; disabled?: boolean; requiredCategory?: string };
export type RSVPMetrics = {
  visitors: number; intended: number; missedRate: number; queueSeconds: number;
  exposure: number; density: number; coverage: number; balance: number;
  neighborVisitChange: number; companyScore: number; venueScore: number; score: number;
};
export type ScenarioSummary = { seatId: string; label: string; metrics: RSVPMetrics };
export type RSVPRecord = {
  requestId: string; companyId: string; order: number; size: BoothSize; seatId: string;
  sourceRevision: number; profile: ExhibitorProfile; scenarios: ScenarioSummary[];
  originalSeat: { x: number; y: number; w: number; h: number };
  timestamp: string; released?: boolean; requeued?: boolean; undersizedAcknowledged: boolean;
  scoringVersion: string;
};
export type RSVPState = {
  orderMode?: "random" | "manual" | "registration" | "popularity" | "alphabetical";
  order: string[]; skipped: string[]; records: RSVPRecord[];
  sizes: BoothSize[];
  protectedAreas: { x: number; y: number; w: number; h: number }[];
  final?: { status: "pending" | "complete"; sourceRevision: number; visits?: number; peak?: number; queueSeconds?: number };
};
