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

export async function sendSms(to, body) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const form = new URLSearchParams({ To: to, Body: body });
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

// Text messages. Plain characters only (no emoji or Telugu) so each stays 1–2 segments and cheap.
export const TEXTS = {
  confirmYes: (r) =>
    `Maha Yadavalli - Sai & Michael Wedding: Thank you, ${first(r.name)}! Your RSVP for Sai Keerthana & Michael's wedding is confirmed for ${guestLine(r)}. Fri Nov 6, 6:00 PM, Hindu Temple of Atlanta, Riverdale GA. Reply STOP to opt out.`,
  confirmNo: (r) =>
    `Maha Yadavalli - Sai & Michael Wedding: Thank you for letting us know, ${first(r.name)}. We will miss you at Sai Keerthana & Michael's wedding. Reply STOP to opt out.`,
  reminder: (r) =>
    `Maha Yadavalli - Sai & Michael Wedding: Reminder - Sai Keerthana & Michael's wedding is TOMORROW, Fri Nov 6 at 6:00 PM. Hindu Temple of Atlanta, 5851 Georgia Hwy 85, Riverdale GA 30274.${SITE_URL ? " " + SITE_URL : ""} Reply STOP to opt out.`,
};
function first(name) {
  return String(name || "").trim().split(/\s+/)[0].slice(0, 20) || "friend";
}
