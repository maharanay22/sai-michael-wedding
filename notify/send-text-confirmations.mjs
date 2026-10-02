// Texts a confirmation to guests who ticked "Text me" and haven't had one yet.
// Run every 10 minutes by .github/workflows/text-confirmations.yml (until the wedding), or by hand: node send-text-confirmations.mjs [--dry-run]
import { requireEnv, firestore, FieldValue, dryRun, smsReady, sendSms, segments, TEXTS, MEDIA, pause } from "./lib.mjs";

requireEnv(["FIREBASE_SERVICE_ACCOUNT"]);
if (!smsReady()) { console.error("Twilio settings missing (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM)."); process.exit(1); }

// Safety cap on the total number of confirmation texts, so a flood of fake RSVPs can't run up the bill.
const MAX_TEXTS = Number(process.env.MAX_CONFIRMATION_TEXTS || 300);

// Wedding RSVPs (index.html) and reception RSVPs (reception.html) are separate lists, each with its own texts.
const EVENTS = [
  { label: "wedding", collection: "rsvps", yes: TEXTS.confirmYes, no: TEXTS.confirmNo, mediaYes: MEDIA.confirmYes, mediaNo: MEDIA.confirmNo },
  { label: "reception", collection: "receptionRsvps", yes: TEXTS.recConfirmYes, no: TEXTS.recConfirmNo, mediaYes: MEDIA.recConfirmYes, mediaNo: MEDIA.recConfirmNo },
];
const lists = [];
for (const ev of EVENTS) {
  const snap = await firestore().collection(ev.collection).where("smsOptIn", "==", true).get();
  lists.push({ ev, docs: snap.docs.map((d) => ({ ref: d.ref, id: d.id, r: d.data() })) });
}
// One shared safety cap across both events.
let budget = MAX_TEXTS - lists.reduce((n, l) => n + l.docs.filter((x) => x.r.smsConfirmationSentAt).length, 0);
let sent = 0, skipped = 0, failed = 0, opted = 0;

for (const { ev, docs } of lists) {
  opted += docs.length;
  // Per event: one confirmation per phone number (a guest replying to both events gets one text for each).
  const textedPhones = new Set(docs.filter((x) => x.r.smsConfirmationSentAt).map((x) => x.r.phone));
  for (const { ref, id, r } of docs) {
    if (r.smsConfirmationSentAt || r.smsError) continue;
    if (!/^\+\d{8,15}$/.test(r.phone || "")) { await ref.update({ smsError: "invalid phone" }); failed++; continue; }
    if (textedPhones.has(r.phone)) {
      await ref.update({ smsConfirmationSentAt: FieldValue.serverTimestamp(), smsNote: "number already texted" });
      skipped++; continue;
    }
    if (budget <= 0) { console.warn(`Cap of ${MAX_TEXTS} confirmation texts reached; not texting ${ev.label} ${id}.`); skipped++; continue; }
    const body = r.attending ? ev.yes(r) : ev.no(r);
    if (dryRun) { console.log(`[dry run] ${ev.label}: ${r.phone} (${segments(body)} seg): ${body}`); continue; }
    try {
      await sendSms(r.phone, body, r.attending ? ev.mediaYes : ev.mediaNo);
      await ref.update({ smsConfirmationSentAt: FieldValue.serverTimestamp() });
      textedPhones.add(r.phone); budget--; sent++;
      console.log(`texted (${ev.label}): ${r.name}`);
    } catch (e) {
      failed++;
      console.error(`failed (${ev.label}): ${r.name}: ${e.message}`);
      await ref.update({ smsError: e.message }).catch(() => {});
    }
    await pause(300);
  }
}
console.log(`Done. Opted in: ${opted} · texted now: ${sent} · skipped: ${skipped} · failed: ${failed}${dryRun ? " (dry run, nothing sent)" : ""}`);
