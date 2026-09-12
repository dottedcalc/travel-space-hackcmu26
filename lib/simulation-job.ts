import type { FairEvent } from "./event.ts";
import type { Simulation } from "./simulation.ts";

type WorkerPort = Pick<Worker, "postMessage" | "terminate" | "onmessage" | "onerror" | "onmessageerror">;
type Callbacks = {
  onProgress: (percent: number) => void;
  onComplete: (simulation: Simulation) => void;
  onError: (message: string) => void;
};

/** Own one run, including startup failures, stalled workers, and cancellation. */
export function startSimulationJob(createWorker: () => WorkerPort, event: FairEvent,
  callbacks: Callbacks, timeoutMs = 60_000) {
  let worker: WorkerPort | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const cancel = () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timeout);
    if (worker) {
      worker.onmessage = worker.onerror = worker.onmessageerror = null;
      worker.terminate();
    }
  };
  const fail = (message: string) => {
    if (stopped) return;
    cancel();
    callbacks.onError(message);
  };
  const armTimeout = () => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fail("Simulation stopped responding. Try again or reduce the visitor count."), timeoutMs);
  };
  try {
    worker = createWorker();
    worker.onmessage = ({ data }) => {
      if (stopped) return;
      if (data && typeof data.progress === "number" && Number.isFinite(data.progress)) {
        armTimeout();
        callbacks.onProgress(Math.max(0, Math.min(99, Math.floor(data.progress))));
      } else if (data?.simulation && Array.isArray(data.simulation.agents)) {
        cancel();
        callbacks.onComplete(data.simulation);
      } else {
        fail(typeof data?.error === "string" ? data.error : "The simulation returned an invalid result. Please try again.");
      }
    };
    worker.onerror = () => fail("The simulation could not start or stopped unexpectedly. Refresh the page and try again.");
    worker.onmessageerror = () => fail("The simulation result could not be read. Please try again.");
    armTimeout();
    worker.postMessage(event);
  } catch {
    fail("The simulation could not start. Refresh the page and try again.");
  }
  return { cancel };
}
