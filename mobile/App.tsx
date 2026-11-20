// The viralowner iPhone app: the website, plus two things a website can't do well on an iPhone:
//   1. Pick clips from Photos as the original files (no conversion first) and upload them.
//   2. Save a finished video straight to Photos, or share it to TikTok / Instagram.
// The site does everything else; it talks to this app through src/lib/native-app.ts.
import { Directory, File, Paths } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import * as MediaLibrary from "expo-media-library/legacy";
import * as Sharing from "expo-sharing";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from "react-native-webview";
import type { IOSWebViewProps } from "react-native-webview/lib/WebViewTypes";
import type { ComponentType, RefAttributes } from "react";

// The library's combined iOS + Android + Windows props type comes out as `never` with this TypeScript;
// this is an iOS-only app, so it's typed with the iOS props.
const Web = WebView as unknown as ComponentType<IOSWebViewProps & RefAttributes<WebView>>;

const SITE = "https://www.viralowner.com";
const START = `${SITE}/login`; // signed in: goes straight on to their videos
const BG = "#0B0B0F";
const CORAL = "#F63165";
const APP_VERSION = 1;

void SplashScreen.preventAutoHideAsync();

// Tells the site it's inside the app (before any of its code runs).
const BEFORE_LOAD = `window.__VIRALOWNER_APP__ = { version: ${APP_VERSION}, platform: "ios" }; true;`;

type FromSite =
  | { type: "pickClips"; id: string; limit: number }
  | { type: "upload"; ref: string; url: string; headers: Record<string, string> }
  | { type: "cancel"; ref: string }
  | { type: "release"; ref: string }
  | { type: "saveVideo"; id: string; url: string; fileName: string; mode: "save" | "share" };

/** Only viralowner's own pages (and Stripe's checkout) open inside the app; other links open in Safari. */
function opensInApp(url: string) {
  try {
    const host = new URL(url).hostname;
    return (
      host === "viralowner.com" ||
      host.endsWith(".viralowner.com") ||
      host.endsWith("stripe.com") ||
      host.endsWith("stripe.network") ||
      url.startsWith("about:") ||
      url.startsWith("blob:") ||
      url.startsWith("data:")
    );
  } catch {
    return false;
  }
}

function videoType(name: string, mime?: string | null) {
  if (mime === "video/mp4" || mime === "video/quicktime") return mime;
  return /\.(mp4|m4v)$/i.test(name) ? "video/mp4" : "video/quicktime";
}

export default function App() {
  return (
    <SafeAreaProvider>
      <Main />
    </SafeAreaProvider>
  );
}

function Main() {
  const web = useRef<WebView>(null);
  const picked = useRef(new Map<string, string>()); // ref → the picked file's local uri
  const uploads = useRef(new Map<string, AbortController>());
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);

  const send = useCallback((msg: Record<string, unknown>) => {
    web.current?.injectJavaScript(`window.__voReceive && window.__voReceive(${JSON.stringify(msg)}); true;`);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void SplashScreen.hideAsync(), 4000); // never stuck on the splash
    return () => clearTimeout(t);
  }, []);

  async function pickClips(id: string, limit: number) {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted && perm.accessPrivileges !== "limited") {
        send({ type: "picked", id, files: [], error: "no photos permission" });
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["videos"],
        allowsMultipleSelection: true,
        selectionLimit: Math.max(1, Math.min(40, limit)),
        orderedSelection: true,
        // The file as filmed: no conversion to a "compatible" copy (that's the slow, bigger step on the website).
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
        videoExportPreset: ImagePicker.VideoExportPreset.Passthrough,
        shouldDownloadFromNetwork: true, // clips kept in iCloud
        quality: 1,
      });
      if (result.canceled) {
        send({ type: "picked", id, files: [] });
        return;
      }
      const files = result.assets.map((a, i) => {
        const ref = `${Date.now().toString(36)}-${i}-${Math.random().toString(36).slice(2, 8)}`;
        picked.current.set(ref, a.uri);
        const name = a.fileName || a.uri.split("/").pop() || `clip-${i + 1}.mov`;
        const size = a.fileSize || new File(a.uri).size;
        return {
          ref,
          name,
          type: videoType(name, a.mimeType),
          size,
          durationS: a.duration != null ? a.duration / 1000 : null,
        };
      });
      send({ type: "picked", id, files });
    } catch (e) {
      send({ type: "picked", id, files: [], error: String(e) });
    }
  }

  async function upload(ref: string, url: string, headers: Record<string, string>) {
    const uri = picked.current.get(ref);
    if (!uri) return send({ type: "uploadFailed", ref, error: "the clip isn't on this phone any more. pick it again." });
    const controller = new AbortController();
    uploads.current.set(ref, controller);
    let last = -1;
    const task = new File(uri).createUploadTask(url, {
      httpMethod: "PUT",
      headers,
      sessionType: "background", // keeps going if they switch apps for a bit
      signal: controller.signal,
      onProgress: ({ bytesSent, totalBytes }) => {
        const percent = totalBytes ? Math.min(99, Math.floor((bytesSent / totalBytes) * 100)) : 0;
        if (percent !== last) {
          last = percent;
          send({ type: "progress", ref, percent });
        }
      },
    });
    try {
      const res = await task.uploadAsync();
      if (res.status >= 200 && res.status < 300) send({ type: "uploaded", ref });
      else send({ type: "uploadFailed", ref, error: `the upload didn’t go through (${res.status}).` });
    } catch (e) {
      if (!controller.signal.aborted) send({ type: "uploadFailed", ref, error: "the upload didn’t go through." });
    } finally {
      task.release();
      uploads.current.delete(ref);
    }
  }

  function release(ref: string) {
    const uri = picked.current.get(ref);
    picked.current.delete(ref);
    uploads.current.get(ref)?.abort();
    try {
      if (uri) new File(uri).delete(); // the picker's copy in the app's temporary files
    } catch {
      // already gone
    }
  }

  async function saveVideo(id: string, url: string, fileName: string, mode: "save" | "share") {
    let file: File | null = null;
    try {
      if (mode === "save") {
        const perm = await MediaLibrary.requestPermissionsAsync(true);
        if (!perm.granted) return send({ type: "saveFailed", id, error: "no permission to add to photos" });
      }
      const dir = new Directory(Paths.cache, "videos");
      if (!dir.exists) dir.create();
      const safe = (fileName || "viralowner.mp4").replace(/[^\w.-]+/g, "-");
      const dest = new File(dir, safe.endsWith(".mp4") ? safe : `${safe}.mp4`);
      if (dest.exists) dest.delete();
      file = await File.downloadFileAsync(url, dest);
      if (mode === "save") {
        await MediaLibrary.saveToLibraryAsync(file.uri);
      } else {
        await Sharing.shareAsync(file.uri, { mimeType: "video/mp4", UTI: "public.mpeg-4" });
      }
      send({ type: "saved", id });
    } catch (e) {
      send({ type: "saveFailed", id, error: String(e) });
    } finally {
      // Saved or shared: the downloaded copy isn't needed (a share has already been handed over).
      if (file && mode === "save") {
        try {
          file.delete();
        } catch {
          // fine
        }
      }
    }
  }

  function onMessage(event: WebViewMessageEvent) {
    let msg: FromSite;
    try {
      msg = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    // Only viralowner's own pages may ask for anything.
    if (!opensInApp(event.nativeEvent.url) || !new URL(event.nativeEvent.url).hostname.endsWith("viralowner.com")) return;
    if (msg.type === "pickClips") void pickClips(msg.id, msg.limit);
    else if (msg.type === "upload") void upload(msg.ref, msg.url, msg.headers);
    else if (msg.type === "cancel") uploads.current.get(msg.ref)?.abort();
    else if (msg.type === "release") release(msg.ref);
    else if (msg.type === "saveVideo") void saveVideo(msg.id, msg.url, msg.fileName, msg.mode);
  }

  function onShouldStart(req: WebViewNavigation) {
    if (opensInApp(req.url)) return true;
    void Linking.openURL(req.url); // mailto:, other sites: Safari / Mail
    return false;
  }

  return (
    <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
      <StatusBar style="light" />
      {failed ? (
        <View style={styles.center}>
          <Text style={styles.title}>can’t reach viralowner</Text>
          <Text style={styles.body}>check your connection, then try again.</Text>
          <Pressable
            style={styles.button}
            onPress={() => {
              setFailed(false);
              setLoading(true);
              web.current?.reload();
            }}
          >
            <Text style={styles.buttonText}>try again</Text>
          </Pressable>
        </View>
      ) : null}
      <Web
        ref={web}
        source={{ uri: START }}
        style={[styles.web, failed && styles.hidden]}
        injectedJavaScriptBeforeContentLoaded={BEFORE_LOAD}
        applicationNameForUserAgent={`ViralOwnerApp/${APP_VERSION}`}
        onMessage={onMessage}
        onShouldStartLoadWithRequest={onShouldStart}
        onLoadEnd={() => {
          setLoading(false);
          void SplashScreen.hideAsync();
        }}
        onError={() => setFailed(true)}
        onContentProcessDidTerminate={() => web.current?.reload()}
        sharedCookiesEnabled
        allowsBackForwardNavigationGestures
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        pullToRefreshEnabled
        decelerationRate="normal"
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
        onOpenWindow={(e) => {
          // A link that opens a new tab: viralowner's own pages open here, anything else in Safari.
          const url = e.nativeEvent.targetUrl;
          if (opensInApp(url)) web.current?.injectJavaScript(`window.location.href = ${JSON.stringify(url)}; true;`);
          else void Linking.openURL(url);
        }}
        bounces
        originWhitelist={["https://*", "about:*", "blob:*", "data:*"]}
      />
      {loading && !failed ? (
        <View style={styles.loading} pointerEvents="none">
          <ActivityIndicator color={CORAL} />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  web: { flex: 1, backgroundColor: BG },
  hidden: { display: "none" },
  loading: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  title: { color: "#fff", fontSize: 18, fontWeight: "600" },
  body: { color: "#a1a1aa", fontSize: 15, textAlign: "center" },
  button: { marginTop: 8, backgroundColor: CORAL, borderRadius: 999, paddingHorizontal: 28, paddingVertical: 14 },
  buttonText: { color: "#fff", fontSize: 15, fontWeight: "600" },
});
