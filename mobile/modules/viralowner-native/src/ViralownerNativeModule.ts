import { NativeModule, requireNativeModule } from "expo";

export type PickedVideo = { ref: string; name: string; type: string; size: number; durationS?: number };
export type ProgressEvent = { ref: string; phase: "preparing" | "shrinking" | "uploading"; percent: number };
export type Prepared = { size: number; type: string; shrunk: boolean };

type Events = {
  onProgress(event: ProgressEvent): void;
};

declare class ViralownerNativeModule extends NativeModule<Events> {
  /** The Photos picker for videos; resolves right away with what was picked ([] if closed). */
  pickVideos(limit: number): Promise<PickedVideo[]>;
  /** Gets a picked video's original bytes from Photos, then PUTs them to a signed URL. */
  upload(ref: string, url: string, headers: Record<string, string>): Promise<number>;
  /**
   * Gets a picked video ready (from Photos; made smaller first when `shrink` and it's a big vertical
   * clip). Resolves with the file's final size and type, for the upload URLs.
   */
  prepare(ref: string, shrink: boolean): Promise<Prepared>;
  /** Uploads a prepared video in parts, several at once (part i to urls[i]). */
  uploadParts(ref: string, urls: string[], partBytes: number): Promise<number>;
  cancel(ref: string): void;
  release(ref: string): void;
  /** Keeps a copy of this site's cookies (its login) in the Keychain; none = signed out. */
  saveCookies(domain: string): Promise<number>;
  /** Puts back any saved cookies the web view lost. */
  restoreCookies(): Promise<number>;
}

export default requireNativeModule<ViralownerNativeModule>("ViralownerNative");
