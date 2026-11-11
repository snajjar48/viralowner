import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { headObject, putObject } from "../storage";
import { MOCK_RENDER_KEY } from "./mock";

let ready = false;

/**
 * The mock's "finished video" is one sample file. Upload it to storage the
 * first time it's needed, so downloads work exactly as they will for real
 * renders. (The real worker writes each render to storage itself.)
 */
export async function ensureMockRenderInStorage() {
  if (ready) return;
  if (!(await headObject(MOCK_RENDER_KEY))) {
    const file = await readFile(path.join(process.cwd(), "assets/mock/mock-render.mp4"));
    await putObject(MOCK_RENDER_KEY, new Uint8Array(file), "video/mp4");
  }
  ready = true;
}
