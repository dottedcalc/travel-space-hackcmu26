import { simulate } from "./simulation.ts";
import type { FairEvent } from "./event.ts";

self.onmessage = (message: MessageEvent<FairEvent>) => {
  try {
    self.postMessage({ simulation: simulate(message.data, (progress) => self.postMessage({ progress }), true) });
  } catch (error) {
    console.error("Simulation failed:", error);
    self.postMessage({ error: "Simulation could not finish. Try fewer visitors." });
  }
};
