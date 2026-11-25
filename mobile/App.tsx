// The viralowner iPhone app: the website, plus two things a website can't do well on an iPhone:
//   1. Pick clips from Photos as the original files (no conversion first) and upload them.
//   2. Save a finished video straight to Photos, or share it to TikTok / Instagram.
//   3. Notifications when a video is ready, and a one-time screen about how clips are used (App Store rules).
// Plans and sign-up (they take a card) open in Safari, as App Store rules ask.
// The site does everything else; it talks to this app through src/lib/native-app.ts.
import { Directory, File, Paths } from "expo-file-system";
import * as MediaLibrary from "expo-media-library/legacy";
import * as Notifications from "expo-notifications";
import * as Sharing from "expo-sharing";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from "react-native-webview";
import type { IOSWebViewProps } from "react-native-webview/lib/WebViewTypes";
import type { ComponentType, RefAttributes } from "react";
import Native from "./modules/viralowner-native";

// The library's combined iOS + Android + Windows props type comes out as `never` with this TypeScript;
// this is an iOS-only app, so it's typed with the iOS props.
const Web = WebView as unknown as ComponentType<IOSWebViewProps & RefAttributes<WebView>>;

const SITE = "https://www.viralowner.com";
const START = `${SITE}/dashboard`; // not signed in: the site sends them to log in
const BG = "#0B0B0F";
const CORAL = "#F63165";
const APP_VERSION = 5; // 3: prepare (with shrinking) + uploads in parts; 4: shrinking that keeps the quality; 5: notifications
const EAS_PROJECT_ID = "aa64a2e0-1a79-43a0-8be0-642d299ca286";
// Agreed to how clips are used (the screen before the first upload). A new version asks again.
const CONSENT_FILE = "consent-v1.json";
const COOKIE_DOMAIN = "viralowner.com";

void SplashScreen.preventAutoHideAsync();

// A notification that arrives while the app is open still shows.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

function consented(): boolean {
  try {
    return new File(Paths.document, CONSENT_FILE).exists;
  } catch {
    return false;
  }
}
function saveConsent() {
  try {
    const f = new File(Paths.document, CONSENT_FILE);
    if (!f.exists) f.create();
    f.write(JSON.stringify({ at: new Date().toISOString() }));
  } catch {
    // Asked again next time.
  }
}

// Tells the site it's inside the app (before any of its code runs).
const BEFORE_LOAD = `window.__VIRALOWNER_APP__ = { version: ${APP_VERSION}, platform: "ios" }; true;`;

type FromSite =
  | { type: "pickClips"; id: string; limit: number }
  | { type: "upload"; ref: string; url: string; headers: Record<string, string> }
  | { type: "prepare"; ref: string; shrink: boolean }
  | { type: "uploadParts"; ref: string; urls: string[]; partBytes: number }
  | { type: "cancel"; ref: string }
  | { type: "release"; ref: string }
  | { type: "saveVideo"; id: string; url: string; fileName: string; mode: "save" | "share" }
  | { type: "enablePush"; ask: boolean };

const isViralowner = (host: string) => host === "viralowner.com" || host.endsWith(".viralowner.com");

/**
 * Pages that take a card open in Safari, never in the app (App Store rules, US storefront): choosing a
 * plan, signing up (it takes a card for the free trial), and Stripe's own pages (billing, checkout).
 */
function isPayment(url: string) {
  try {
    const u = new URL(url);
    if (u.hostname.endsWith("stripe.com")) return !u.hostname.startsWith("js.") && !u.hostname.startsWith("m.");
    return isViralowner(u.hostname) && /^\/(plans|signup)(\/|$)/.test(u.pathname);
  } catch {
    return false;
  }
}

/** Only viralowner's own pages open inside the app (and Stripe's scripts they use); other links open in Safari. */
function opensInApp(url: string) {
  if (url.startsWith("about:") || url.startsWith("blob:") || url.startsWith("data:")) return true;
  if (isPayment(url)) return false;
  try {
    const host = new URL(url).hostname;
    return isViralowner(host) || host.endsWith("stripe.com") || host.endsWith("stripe.network");
  } catch {
    return false;
  }
}

function videoType(name: string, mime?: string | null) {
  if (mime === "video/mp4" || mime === "video/quicktime") return mime;
  return /\.(mp4|m4v)$/i.test(name) ? "video/mp4" : "video/quicktime";
}

export default function App() {
  const [agreed, setAgreed] = useState(consented);
  return (
    <SafeAreaProvider>
      {agreed ? (
        <Main />
      ) : (
        <Consent
          onAgree={() => {
            saveConsent();
            setAgreed(true);
          }}
        />
      )}
    </SafeAreaProvider>
  );
}

/**
 * Before anything is uploaded: what happens to their clips, and that an AI service helps edit them
 * (App Store rule 5.1.2(i): say so and get permission before sharing data with a third-party AI).
 */
function Consent({ onAgree }: { onAgree: () => void }) {
  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);
  return (
    <SafeAreaView style={styles.root} edges={["top", "left", "right", "bottom"]}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.consent}>
        <Image source={require("./assets/icon.png")} style={styles.logo} />
        <Text style={styles.consentTitle}>before you start</Text>
        <Text style={styles.consentBody}>
          viralowner edits your clips into a finished video. to do that, frames from your clips, what’s said in them and
          the notes you write are sent to our AI provider, Anthropic, which helps plan the edit.
        </Text>
        <View style={styles.points}>
          <Text style={styles.point}>
            • nothing is kept or stored by Anthropic for its own use: it never trains AI on what you send, and deletes it
            automatically.
          </Text>
          <Text style={styles.point}>• it’s only used to make your video. it’s never sold, and never used for anything else.</Text>
          <Text style={styles.point}>
            • your clips and videos stay in your account only, for you to edit and download. delete any of them, or your
            whole account, anytime in the app.
          </Text>
        </View>
        <Pressable onPress={() => void Linking.openURL(`${SITE}/privacy`)}>
          <Text style={styles.link}>read the privacy policy</Text>
        </Pressable>
        <Pressable style={[styles.button, styles.wide]} onPress={onAgree} accessibilityRole="button">
          <Text style={styles.buttonText}>agree and continue</Text>
        </Pressable>
        <Text style={styles.fine}>you can’t make videos without this, because the editing needs it.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Main() {
  const web = useRef<WebView>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    Native.restoreCookies()
      .catch(() => 0)
      .finally(() => setRestored(true));
  }, []);

  const send = useCallback((msg: Record<string, unknown>) => {
    web.current?.injectJavaScript(`window.__voReceive && window.__voReceive(${JSON.stringify(msg)}); true;`);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void SplashScreen.hideAsync(), 4000); // never stuck on the splash
    return () => clearTimeout(t);
  }, []);

  // Progress from the native uploads (getting the video from Photos, then uploading it).
  useEffect(() => {
    const sub = Native.addListener("onProgress", (e) => send({ type: "progress", ref: e.ref, percent: e.percent, phase: e.phase }));
    return () => sub.remove();
  }, [send]);

  // Staying logged in: a copy of the site's login is kept in the Keychain and put back on launch.
  const saveLogin = useCallback(() => {
    Native.saveCookies(COOKIE_DOMAIN).catch(() => {});
  }, []);
  // Back from Safari after choosing a plan (or from anywhere after the connection dropped): reload, so the
  // new plan shows or the page comes back.
  const leftToPay = useRef(false);
  const failedRef = useRef(false);
  failedRef.current = failed;
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return saveLogin();
      if (leftToPay.current || failedRef.current) {
        leftToPay.current = false;
        setFailed(false);
        web.current?.reload();
      }
    });
    return () => sub.remove();
  }, [saveLogin]);

  // Tapping a "your video is ready" notification opens that video (also when it launched the app).
  const openPath = useCallback((path: unknown) => {
    if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) return;
    web.current?.injectJavaScript(`window.location.href = ${JSON.stringify(SITE + path)}; true;`);
  }, []);
  const launchPath = useRef<string | null>(null);
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((r) => openPath(r.notification.request.content.data?.path));
    void Notifications.getLastNotificationResponseAsync().then((r) => {
      const path = r?.notification.request.content.data?.path;
      if (typeof path === "string") launchPath.current = path;
    });
    return () => sub.remove();
  }, [openPath]);

  /** Registers for notifications (`ask`: shows iPhone's prompt if it hasn't been answered) and tells the site. */
  async function enablePush(ask: boolean) {
    try {
      let { status } = await Notifications.getPermissionsAsync();
      if (status === "undetermined" && ask) status = (await Notifications.requestPermissionsAsync()).status;
      if (status !== "granted") return;
      const token = (await Notifications.getExpoPushTokenAsync({ projectId: EAS_PROJECT_ID })).data;
      send({ type: "pushToken", token });
    } catch {
      // No notifications on this phone (or the simulator): everything else works.
    }
  }

  async function pickClips(id: string, limit: number) {
    try {
      // Returns as soon as they tap "add": each video is read from Photos only when it uploads.
      const files = await Native.pickVideos(Math.max(1, Math.min(40, limit)));
      send({
        type: "picked",
        id,
        files: files.map((f) => ({ ...f, type: videoType(f.name, f.type), durationS: f.durationS ?? null })),
      });
    } catch (e) {
      send({ type: "picked", id, files: [], error: String(e) });
    }
  }

  async function upload(ref: string, url: string, headers: Record<string, string>) {
    try {
      await Native.upload(ref, url, headers);
      send({ type: "uploaded", ref });
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      if (/canceled/i.test(text)) return;
      send({ type: "uploadFailed", ref, error: text || "the upload didn’t go through." });
    }
  }

  async function prepare(ref: string, shrink: boolean) {
    try {
      const ready = await Native.prepare(ref, shrink);
      send({ type: "prepared", ref, size: ready.size, fileType: ready.type, shrunk: ready.shrunk });
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      send({ type: "prepareFailed", ref, error: text || "we couldn’t get that video from your photos." });
    }
  }

  async function uploadParts(ref: string, urls: string[], partBytes: number) {
    try {
      await Native.uploadParts(ref, urls, partBytes);
      send({ type: "uploaded", ref });
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      if (/canceled/i.test(text)) return;
      send({ type: "uploadFailed", ref, error: text || "the upload didn’t go through." });
    }
  }

  function release(ref: string) {
    try {
      Native.release(ref);
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
    else if (msg.type === "prepare") void prepare(msg.ref, msg.shrink);
    else if (msg.type === "uploadParts") void uploadParts(msg.ref, msg.urls, msg.partBytes);
    else if (msg.type === "cancel") Native.cancel(msg.ref);
    else if (msg.type === "release") release(msg.ref);
    else if (msg.type === "saveVideo") void saveVideo(msg.id, msg.url, msg.fileName, msg.mode);
    else if (msg.type === "enablePush") void enablePush(msg.ask === true);
  }

  function onShouldStart(req: WebViewNavigation) {
    if (opensInApp(req.url)) return true;
    if (isPayment(req.url)) leftToPay.current = true;
    void Linking.openURL(req.url); // plans and sign-up, mailto:, other sites: Safari / Mail
    return false;
  }

  return (
    <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
      <StatusBar style="light" />
      {failed ? (
        <View style={styles.center}>
          <Image source={require("./assets/icon.png")} style={styles.logo} />
          <Text style={styles.title}>can’t reach viralowner</Text>
          <Text style={styles.body}>
            check your connection, then try again. videos that are being made keep going, and we’ll tell you when they’re
            ready.
          </Text>
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
      {restored ? (
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
          saveLogin();
          if (launchPath.current) {
            const path = launchPath.current;
            launchPath.current = null;
            openPath(path);
          }
        }}
        onHttpError={(e) => {
          // The site itself is down (not a page's own error): the "can't reach" screen, not a blank page.
          if (e.nativeEvent.statusCode >= 500 && !e.nativeEvent.url.includes("/api/")) setFailed(true);
        }}
        onNavigationStateChange={(nav) => {
          if (!nav.loading) saveLogin(); // logging in or out moves to another page
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
          else {
            if (isPayment(url)) leftToPay.current = true;
            void Linking.openURL(url);
          }
        }}
        bounces
        originWhitelist={["https://*", "about:*", "blob:*", "data:*"]}
      />
      ) : null}
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
  logo: { width: 64, height: 64, borderRadius: 16, marginBottom: 4 },
  consent: { flexGrow: 1, justifyContent: "center", padding: 24, gap: 14 },
  consentTitle: { color: "#fff", fontSize: 24, fontWeight: "700" },
  consentBody: { color: "#d4d4d8", fontSize: 16, lineHeight: 23 },
  points: { gap: 10, borderRadius: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", padding: 16 },
  point: { color: "#d4d4d8", fontSize: 15, lineHeight: 21 },
  link: { color: "#fff", fontSize: 15, textDecorationLine: "underline" },
  wide: { alignItems: "center", marginTop: 6 },
  fine: { color: "#a1a1aa", fontSize: 13, textAlign: "center" },
});
