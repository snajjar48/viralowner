import { NativeModule, requireNativeModule } from "expo";

export type PickedVideo = { ref: string; name: string; type: string; size: number; durationS?: number };
export type ProgressEvent = { ref: string; phase: "preparing" | "uploading"; percent: number };

type Events = {
  onProgress(event: ProgressEvent): void;
};

declare class ViralownerNativeModule extends NativeModule<Events> {
  /** The Photos picker for videos; resolves right away with what was picked ([] if closed). */
  pickVideos(limit: number): Promise<PickedVideo[]>;
  /** Gets a picked video's original bytes from Photos, then PUTs them to a signed URL. */
  upload(ref: string, url: string, headers: Record<string, string>): Promise<number>;
  cancel(ref: string): void;
  release(ref: string): void;
  /** Keeps a copy of this site's cookies (its login) in the Keychain; none = signed out. */
  saveCookies(domain: string): Promise<number>;
  /** Puts back any saved cookies the web view lost. */
  restoreCookies(): Promise<number>;
}

export default requireNativeModule<ViralownerNativeModule>("ViralownerNative");
