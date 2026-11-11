import "server-only";
import { modalEngine } from "./modal";
import type { ProcessingEngine } from "./types";

export * from "./types";

/**
 * The processing engine every page and API route uses: the worker on Modal
 * (./modal.ts, worker/app.py) for both inspo analysis and rendering.
 */
const engine: ProcessingEngine = modalEngine;

export const startAnalysis: ProcessingEngine["startAnalysis"] = (input) => engine.startAnalysis(input);
export const getAnalysisStatus: ProcessingEngine["getAnalysisStatus"] = (jobId) => engine.getAnalysisStatus(jobId);
export const startRender: ProcessingEngine["startRender"] = (input) => engine.startRender(input);
export const getJobStatus: ProcessingEngine["getJobStatus"] = (jobId) => engine.getJobStatus(jobId);
