// The day before the wedding: a reminder text to every attending guest who ticked "Text me".
// Run by .github/workflows/wedding-reminder.yml on 5 Nov 2026, or by hand.
//   DRY_RUN=true   → only list who would be texted
//   TEST_PHONE=+14045550123 → send one sample reminder to that number only
import { requireEnv, firestore, FieldValue, dryRun, guestLine, smsReady, sendSms, segments, TEXTS, MEDIA, pause } from "./lib.mjs";

if (!smsReady()) { console.error("Twilio settings missing (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM)."); process.exit(1); }

// Accepts any common US format: 4092739225, (409) 273-9225, 409-273-9225, 1 409 273 9225 or +14092739225.
function toE164(v) {
  const t = String(v || "").trim(), d = t.replace(/\D/g, "");
  if (!t) return "";
  if (t.startsWith("+")) return d.length >= 8 && d.length <= 15 ? "+" + d : null;
  if (d.length === 10 && /^[2-9]/.test(d)) return "+1" + d;
  if (d.length === 11 && d[0] === "1") return "+" + d;
  return null;
}
const testPhone = toE164(process.env.TEST_PHONE);
if (testPhone === null) { console.error(`Could not read the test phone "${process.env.TEST_PHONE}". Type a 10-digit US mobile number, e.g. 4045550123.`); process.exit(1); }
if (testPhone) {
  const body = TEXTS.reminder({ name: "Test Guest", adults: 2, kids: 1 });
  console.log(`Test reminder to ${testPhone} (${segments(body)} segment(s)):\n${body}`);
  await sendSms(testPhone, body, MEDIA.reminder);
  console.log("Sent.");
  process.exit(0);
}

requireEnv(["FIREBASE_SERVICE_ACCOUNT"]);
const snap = await firestore().collection("rsvps").where("attending", "==", true).get();
const textedPhones = new Set();
const t = { text: 0, skipped: 0, notOpted: 0, failed: 0 };

for (const doc of snap.docs) {
  const r = doc.data();
  if (!r.smsOptIn) { t.notOpted++; continue; }
  if (r.smsReminderSentAt) { t.skipped++; continue; }
  if (!/^\+\d{8,15}$/.test(r.phone || "")) { t.failed++; await doc.ref.update({ smsError: "invalid phone" }).catch(() => {}); continue; }
  if (textedPhones.has(r.phone)) { await doc.ref.update({ smsReminderSentAt: FieldValue.serverTimestamp() }); t.skipped++; continue; }
  const body = TEXTS.reminder(r);
  if (dryRun) { console.log(`[dry run] ${r.name} ${r.phone} (${guestLine(r)}, ${segments(body)} seg)`); continue; }
  try {
    await sendSms(r.phone, body, MEDIA.reminder);
    await doc.ref.update({ smsReminderSentAt: FieldValue.serverTimestamp() });
    textedPhones.add(r.phone); t.text++;
    console.log(`texted: ${r.name}`);
  } catch (e) {
    t.failed++;
    console.error(`failed: ${r.name}: ${e.message}`);
    await doc.ref.update({ smsError: e.message.slice(0, 200) }).catch(() => {});
  }
  await pause(300);
}
console.log(`Done. Attending: ${snap.size} · texted: ${t.text} · already reminded: ${t.skipped} · didn't tick "Text me": ${t.notOpted} · failed: ${t.failed}${dryRun ? " (dry run, nothing sent)" : ""}`);
if (t.notOpted) console.log(`Tip: the ${t.notOpted} guest(s) who didn't tick "Text me" can be reminded with the WhatsApp button on the host dashboard.`);
if (t.failed) process.exit(1);
