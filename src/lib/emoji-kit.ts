/**
 * The emoji kit: the emojis a maker's own phone or computer draws, in its own style (Apple's on an
 * iPhone, Samsung's on a Samsung, and so on), so the emojis in their videos look like the ones on
 * their phone. The browser draws these and uploads them (components/emoji-kit-sync.tsx); the video
 * worker uses them, and Google's emoji for anything not in the kit.
 */

/** Bump when the list or the drawing changes: every kit is drawn again. */
export const EMOJI_KIT_VERSION = 2;
/** Each emoji's square in the sheet, in pixels. */
export const EMOJI_KIT_CELL = 128;
export const EMOJI_KIT_COLS = 16;
/** At most this many per sheet (keeps every sheet under phones' canvas size limits). */
export const EMOJI_KIT_PER_SHEET = 288;

// The emojis people actually use in short-form videos, most used first (kept short: every device
// draws and uploads these once). Anything else comes out in Google's style.
const COMMON = `
😂 🤣 😭 🥹 😍 🥰 😘 😊 😁 😀 😅 😆 😉 😋 😎 🤩 🥳 😇 🙂 🙃 😏 😌 😜 🤪 😛 🤑 🤗 🤭 🫢 🤫 🤔 🫡 🤨 😐 😑 😶 🙄 😬 😮‍💨 😴 🤤 😷 🤢 🤮 🥵 🥶 😵‍💫 🤯 🤠 🧐 😕 😟 😮 😲 😳 🥺 😢 😩 😫 😤 😡 🤬 😈 💀 ☠️ 💩 🤡 👻 👽 🤖 🙈 🙉 🙊
👋 ✋ 👌 🤌 🤏 ✌️ 🤞 🫰 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 👍 👎 ✊ 👊 👏 🙌 🫶 🤝 🙏 ✍️ 💅 💪 🧠 👀 👄 🫦 🗣️ 🙋 🤷 🤦 💁 🧑‍🍳 👨‍🍳 👩‍🍳 💃 🕺 🏃 🧘 👑 💍
❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 ❤️‍🔥 💕 💞 💖 💘 💯 💥 💫 💦 💨 💬 💭 💤 ✨ 🌟 ⭐ ⚡ 🔥 🌈 ☀️ 🌙 ❄️ 🌊 🌸 🌹 🌻 🌱 🍀 🐶 🐱 🦄 🐝 🦋
🍎 🍋 🍌 🍉 🍇 🍓 🍒 🍑 🥭 🍍 🥥 🥑 🌶️ 🌽 🥕 🧄 🥐 🍞 🧀 🥚 🍳 🥞 🧇 🥓 🥩 🍗 🍖 🌭 🍔 🍟 🍕 🥪 🌮 🌯 🥗 🍝 🍜 🍲 🍛 🍣 🍱 🥟 🍤 🍚 🍦 🍨 🍧 🥧 🧁 🍰 🎂 🍮 🍭 🍬 🍫 🍿 🍩 🍪 🍯 🥛 ☕ 🍵 🧃 🥤 🧋 🍺 🍻 🥂 🍷 🥃 🍸 🍹 🍾 🧊 🍽️ 🧂
💰 💵 💸 💳 💎 📈 📉 💼 📱 💻 📸 🎥 🎬 🎙️ 🎧 🎵 🎶 📣 🔔 💡 🛒 🛍️ 🏷️ 📦 📝 📌 📍 📅 ⏰ ⏳ 🔑 🔒 🛠️ 🏠 🏪 🌍 ✈️ 🚗 🚀
🎉 🎊 🎈 🎁 🪄 🎯 🎮 🏆 🥇 🏅 ⚽ 🏀 🏈
✅ ✔️ ❌ ⛔ 🚫 ⚠️ ❗ ❓ ‼️ ⁉️ ➕ ➖ 🔝 🔜 🆕 🆓 🔴 🟢 🔵 ⚫ ⚪ 🔺 🔻 ▶️ ⏩ 🔁 ⬆️ ⬇️ ⬅️ ➡️ ↗️ 🚨 🏁 🚩 🏳️‍🌈 🏴‍☠️
`;

// Every country and region with a flag emoji (ISO 3166 codes); a device that can't draw one leaves it out.
const FLAG_CODES =
  "AC AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
  "CA CC CD CF CG CH CI CK CL CM CN CO CP CR CU CV CW CX CY CZ DE DG DJ DK DM DO DZ EA EC EE EG EH ER ES ET EU FI FJ " +
  "FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU IC ID IE IL IM IN IO IQ IR " +
  "IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM " +
  "MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT " +
  "PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TA TC TD TF TG TH TJ TK TL " +
  "TM TN TO TR TT TV TW TZ UA UG UM UN US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW";

const flag = (code: string) => String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));

export const KIT_EMOJIS: string[] = [...new Set(COMMON.split(/\s+/).filter(Boolean))];
export const KIT_FLAGS: string[] = FLAG_CODES.split(" ").map(flag);

const ALLOWED = new Set([...KIT_EMOJIS, ...KIT_FLAGS]);
export const isKitEmoji = (e: unknown): e is string => typeof e === "string" && ALLOWED.has(e);

/** One sheet of the kit as stored: which emoji is in which square, row by row. */
export type KitSheet = { key: string; emojis: string[] };
export type EmojiKit = {
  v: number;
  /** A fingerprint of how this device draws emoji: a different device (or OS update) draws a new kit. */
  style: string;
  cell: number;
  cols: number;
  sheets: KitSheet[];
};
