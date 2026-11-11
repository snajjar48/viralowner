import "server-only";
import { mockEngine } from "./mock";
import { ensureMockRenderInStorage } from "./mock-output";
import { modalEngine } from "./modal";
import type { ProcessingEngine } from "./types";

export * from "./types";

/**
 * The processing engine every page and API route uses.
 *
 * Analysis runs on the real worker (./modal.ts, worker/app.py).
 * Rendering is still the mock (./mock.ts) until phase C.
 */
const engine: ProcessingEngine = {
  startAnalysis: modalEngine.startAnalysis,
  getAnalysisStatus: modalEngine.getAnalysisStatus,
  startRender: mockEngine.startRender,
  getJobStatus: mockEngine.getJobStatus,
};

export const startAnalysis: ProcessingEngine["startAnalysis"] = (input) => engine.startAnalysis(input);
export const getAnalysisStatus: ProcessingEngine["getAnalysisStatus"] = (jobId) => engine.getAnalysisStatus(jobId);
export const startRender: ProcessingEngine["startRender"] = (input) => engine.startRender(input);
export const getJobStatus: ProcessingEngine["getJobStatus"] = async (jobId) => {
  const status = await engine.getJobStatus(jobId);
  // Mock only: make sure its sample output exists in storage. Remove with the mock.
  if (status.state === "done" && engine.getJobStatus === mockEngine.getJobStatus) await ensureMockRenderInStorage();
  return status;
};
