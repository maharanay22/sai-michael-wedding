// Texts a confirmation to guests who ticked "Text me" and haven't had one yet.
// Run every 10 minutes by .github/workflows/text-confirmations.yml (until the wedding), or by hand: node send-text-confirmations.mjs [--dry-run]
import { requireEnv, firestore, FieldValue, dryRun, smsReady, sendSms, segments, TEXTS, pause } from "./lib.mjs";

requireEnv(["FIREBASE_SERVICE_ACCOUNT"]);
if (!smsReady()) { console.error("Twilio settings missing (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM)."); process.exit(1); }

// Safety cap on the total number of confirmation texts, so a flood of fake RSVPs can't run up the bill.
const MAX_TEXTS = Number(process.env.MAX_CONFIRMATION_TEXTS || 300);

const snap = await firestore().collection("rsvps").where("smsOptIn", "==", true).get();
const docs = snap.docs.map((d) => ({ ref: d.ref, id: d.id, r: d.data() }));
const alreadySent = docs.filter((x) => x.r.smsConfirmationSentAt);
const textedPhones = new Set(alreadySent.map((x) => x.r.phone));
let budget = MAX_TEXTS - alreadySent.length;
let sent = 0, skipped = 0, failed = 0;

for (const { ref, id, r } of docs) {
  if (r.smsConfirmationSentAt || r.smsError) continue;
  if (!/^\+\d{8,15}$/.test(r.phone || "")) { await ref.update({ smsError: "invalid phone" }); failed++; continue; }
  if (textedPhones.has(r.phone)) {
    // Same number already confirmed on another RSVP: mark it done without texting again.
    await ref.update({ smsConfirmationSentAt: FieldValue.serverTimestamp(), smsNote: "number already texted" });
    skipped++; continue;
  }
  if (budget <= 0) { console.warn(`Cap of ${MAX_TEXTS} confirmation texts reached; not texting ${id}.`); skipped++; continue; }
  const body = r.attending ? TEXTS.confirmYes(r) : TEXTS.confirmNo(r);
  if (dryRun) { console.log(`[dry run] ${r.phone} (${segments(body)} seg): ${body}`); continue; }
  try {
    await sendSms(r.phone, body);
    await ref.update({ smsConfirmationSentAt: FieldValue.serverTimestamp() });
    textedPhones.add(r.phone); budget--; sent++;
    console.log(`texted: ${r.name}`);
  } catch (e) {
    failed++;
    console.error(`failed: ${r.name}: ${e.message}`);
    await ref.update({ smsError: e.message }).catch(() => {});
  }
  await pause(300);
}
console.log(`Done. Opted in: ${docs.length} · texted now: ${sent} · skipped: ${skipped} · failed: ${failed}${dryRun ? " (dry run, nothing sent)" : ""}`);
