import "server-only";
import { mockEngine } from "./mock";
import type { ProcessingEngine } from "./types";

export * from "./types";

/**
 * The processing engine every page and API route uses.
 *
 * Today it's the mock (./mock.ts). To connect the real worker, write an engine
 * that implements ProcessingEngine (for example, one that calls the worker's
 * HTTP API) and return it here. Nothing else needs to change.
 */
const engine: ProcessingEngine = mockEngine;

export const analyzeInspo: ProcessingEngine["analyzeInspo"] = (input) => engine.analyzeInspo(input);
export const startRender: ProcessingEngine["startRender"] = (input) => engine.startRender(input);
export const getJobStatus: ProcessingEngine["getJobStatus"] = (jobId) => engine.getJobStatus(jobId);
