// Shared helpers for the GitHub Action jobs: Firestore (admin) and Twilio over plain HTTPS.
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

export { FieldValue };
export const dryRun = process.argv.includes("--dry-run") || process.env.DRY_RUN === "true";
export const SITE_URL = (process.env.SITE_URL || "").replace(/\/$/, "");

export const TWILIO_ENV = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"];

export function requireEnv(names) {
  const missing = names.filter((k) => !process.env[k]);
  if (missing.length) { console.error("Missing settings:", missing.join(", ")); process.exit(1); }
}

let db;
export function firestore() {
  if (!db) {
    initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
    db = getFirestore();
  }
  return db;
}

export function guestLine(r) {
  const a = r.adults || 0, k = r.kids || 0;
  return `${a} adult${a === 1 ? "" : "s"}${k ? ` and ${k} child${k === 1 ? "" : "ren"}` : ""}`;
}

export const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));

// ---------- Twilio ----------
export const smsReady = () => process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && (process.env.TWILIO_FROM || process.env.TWILIO_MESSAGING_SERVICE_SID);

const GSM = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà^{}\\[~]|€";
// How many billable SMS segments a message uses (GSM-7: 160/153 chars, otherwise Unicode: 70/67).
export function segments(text) {
  const gsm = [...text].every((c) => GSM.includes(c));
  const len = gsm ? [...text].reduce((n, c) => n + ("^{}\\[~]|€".includes(c) ? 2 : 1), 0) : [...text].length;
  const [single, multi] = gsm ? [160, 153] : [70, 67];
  return len <= single ? 1 : Math.ceil(len / multi);
}

export async function sendSms(to, body, mediaUrl) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const form = new URLSearchParams({ To: to, Body: body });
  if (mediaUrl) form.set("MediaUrl", mediaUrl); // picture message (MMS): colorful card + text
  if (process.env.TWILIO_MESSAGING_SERVICE_SID) form.set("MessagingServiceSid", process.env.TWILIO_MESSAGING_SERVICE_SID);
  else form.set("From", process.env.TWILIO_FROM);
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Twilio ${json.code || res.status}: ${json.message || "send failed"}`.slice(0, 200));
  return json.sid;
}

// Picture messages (MMS): a colorful card image plus a short text with emoji. MMS is priced per message, so emoji cost nothing extra.
export const MEDIA = {
  confirmYes: SITE_URL ? SITE_URL + "/card-confirmed.jpg" : "",
  confirmNo: SITE_URL ? SITE_URL + "/photo-video-cover.jpg" : "",
  reminder: SITE_URL ? SITE_URL + "/card-reminder.jpg" : "",
};
export const TEXTS = {
  confirmYes: (r) =>
    `🙏 Namaskaram ${first(r.name)}! Your RSVP is confirmed for ${guestLine(r)} 🌸\n\nSai Keerthana & Michael's wedding\n📅 Fri, Nov 6 · 6:00 PM\n🛕 Hindu Temple of Atlanta, Riverdale GA\n\nWe look forward to your blessings! 🪔\n– Maha Yadavalli. Reply STOP to opt out.`,
  confirmNo: (r) =>
    `🙏 RSVP received. ${first(r.name)}, your response for Sai Keerthana & Michael's wedding (Nov 6) is recorded as "Unable to attend". To change it, RSVP again at ${SITE_URL || "our invitation site"} 🌸\n– Maha Yadavalli. Reply STOP to opt out.`,
  reminder: (r) =>
    `🪔 See you tomorrow! 🪔\n\nSai Keerthana & Michael's wedding is TOMORROW\n📅 Fri, Nov 6 · Muhurtham 6:00 PM\n🛕 Hindu Temple of Atlanta, 5851 Georgia Hwy 85, Riverdale GA 30274\n👥 ${guestLine(r)}${SITE_URL ? "\n🔗 " + SITE_URL : ""}\n\n– Maha Yadavalli. Reply STOP to opt out.`,
};
function first(name) {
  return String(name || "").trim().split(/\s+/)[0].slice(0, 20) || "friend";
}
