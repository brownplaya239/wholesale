# Caller Training Program

Goes with `DNC_PROCEDURES.md` v1.0. No one places an outbound call until
everything in "Sign-off" below is done and logged. Plan on about 90 minutes,
then 5 supervised live calls.

## Sign-off (all required before the first unsupervised call)

1. The caller attends the full session (modules 1–9) with the compliance owner.
2. The caller reads `DNC_PROCEDURES.md` in full.
3. Quiz: 12/12. Every miss is reviewed and re-answered correctly.
4. Role-plays 1–8 are passed.
5. 5 live calls made with the compliance owner listening, with zero
   compliance errors.
6. The caller and trainer sign `CALLER_ACKNOWLEDGEMENT.html`, printed or saved
   as a PDF. File it as `compliance/signed/ack_<caller>_<date>.pdf`.
7. The compliance owner adds a row to `compliance/training_log.csv`, and adds
   the caller's WAVV user id to `ACQ_TRAINED_CALLERS` in Vercel. From then on,
   calls by anyone not on that list are flagged as violations.
   - The id is whatever WAVV sends. After a caller's first test call it shows
     in the "Caller" column on `/admin/calls`.

Run `python scripts/10_acq_release.py compliance-init` once to create the
log files.

**Refreshers:**
- every 90 days;
- before the next shift after any new version of the procedures;
- remedial, the same week, after any violation flag that is confirmed real.

Log each refresher as a new row (`training_type` = refresher / remedial).

## Modules

**1. Why this matters (5 min).**
- Every call is governed by federal and state telemarketing law.
- One unlawful call can cost $500–$1,500, there is no cap, and people make a
  business of suing over it.
- The rules below protect the business, Sumeet's real estate license, and
  you.

**2. Who we are and the opening (10 min).**
- Memorize the opening in procedures §5.3, word for word: your name, calling
  for Sumeet Sancheti, licensed agent with Coldwell Banker Realty, also buys
  directly, "this call may be recorded", the property.
- Never skip the recording sentence or the license line. Never say "I'm not an
  agent". Never claim to be a neighbor, a city or bank employee, or anything
  untrue.

**3. Where and when you dial (10 min).**
- Dial only from your assigned GHL smart-list queues through WAVV. Never from
  a personal phone, a spreadsheet, or a number you typed in by hand.
- Queue order: Q1 inbound → Q2 power (9a–8p ET) → Q3 late windows only after
  their start time → Q4 manual (single line) → Q5 land.
- Respect Next Call Due. If a contact shows up that looks wrong (DNC tag,
  "suppressed" lane), don't dial it; tell Sumeet.
- No calls on Sundays or federal holidays.

**4. Do-not-call requests (15 min).**
- Know the trigger phrases (procedures §6).
- Response script: *"I'm sorry for the bother — I'll make sure you're not
  called again. Have a good day."* End the call, then disposition **DNC**.
- Never argue, persuade, or ask "are you sure".
- "Who gave you my number?" → *"We work from public property records and a
  data provider. I'm happy to make sure you're not called again."* If they
  want that, it's a DNC.
- A threat to sue, or "I'm on the registry": DNC, stay polite, and flag it to
  Sumeet the same day.
- Requests that come to you outside a call (a callback, a text, an email):
  pass them to Sumeet the same day.

**5. What you do and don't do (10 min).**
- You confirm the owner and find out motivation, condition, timeline,
  occupancy, decision makers, and what they hope to get.
- You **never** say a price, an offer, a range, a commission or listing terms:
  *"Sumeet will go over real numbers with you himself."*
- **Listed with an agent?** Thank them and end the call. Disposition *Already
  Listed*. Don't discuss the property further.
- **Owner passed away:** slow down, give condolences, and ask who is handling
  the estate. Disposition *Wrong Owner* with a note.
- **Tenant, child, or someone who sounds confused:** don't qualify them. Ask
  for the owner, or end the call politely.

**6. Voicemail, caller ID, recording (5 min).**
- Live voicemails only, in your own voice, using the procedures §5.5 script.
- Voicemail drops are disabled. Never record or upload one.
- If someone objects to being recorded: apologize, offer to have Sumeet call
  from a line that isn't recorded, end the call, and note it.
- If an owner calls the caller-ID number back, answer with the same opening.

**7. GHL and WAVV mechanics (15 min).**
- Fill in the opportunity fields **during** the call. Choose the disposition
  **last**.
- Notes within 5 minutes, and only for context the fields don't capture.
- The 12 dispositions and what each one triggers are in
  `docs/ACQUISITION_SYSTEM.md` §7. Pick the true one, not the hopeful one.

**8. Warm and Hot (10 min).**
- **Hot:** a confirmed owner or decision-maker, with real intent, an
  identifiable motivation, an actionable timeline, meaningful property facts,
  and openness to an offer.
- **Warm:** a confirmed owner willing to discuss, with urgency, price or
  timing unresolved.
- Not qualified: "might sell someday", "what would you pay?" with no
  engagement, or no actual selling indication.
- Marking a lead Hot or Warm requires the 9 qualification fields. Inflated
  grades show up in review.

**9. How your calls are reviewed (5 min).**
- Every call is recorded and automatically checked for hours, suppression,
  scrub age, and your training status.
- Every recorded conversation is reviewed by AI for opt-outs, listings,
  disclosures and quoted prices, and compared with your notes.
- Sumeet listens to at least 5 of your calls a week.
- Consequences are in procedures §9.5.

## Role-plays (trainer plays the owner; caller must pass all 8)

1. Two minutes into a good conversation the owner says, "Actually, just put me
   on your do-not-call list." → Stop, use the script, disposition DNC.
2. "Who gave you this number? I'm on the Do Not Call registry." → Script, DNC,
   flag to Sumeet.
3. "It's listed with Jane at RE/MAX right now." → Thank them, end, *Already
   Listed*.
4. "My mother passed in March, I'm her son." → Condolences, ask who handles
   the estate, *Wrong Owner* with a note (this is an estate lead).
5. A tenant answers. → Ask for the owner's contact or end politely; don't
   qualify the tenant.
6. "So what would you pay me for it?" → Don't give a number. Explain Sumeet
   will call with real numbers; keep qualifying.
7. "Are you recording this? I don't want to be recorded." → Apologize, offer
   Sumeet on a line that isn't recorded, end, note it.
8. A motivated seller: divorce, a vacant house that needs a roof, wants out in
   60 days, asking "around 300". → Capture all 9 fields, book Sumeet,
   disposition *Hot Lead* / *Appointment Booked*.

## Quiz (12 questions; answer key at the end — trainer keeps it)

1. What are our calling hours, and whose clock do they follow?
2. Can you call on a Sunday? On Columbus Day?
3. The owner says "not interested." Is that a DNC request?
4. The owner says "please stop calling me" after you've built rapport. What
   exactly do you do?
5. Can you leave a pre-recorded voicemail if you're short on time?
6. A contact in your queue has the tag `dnc`. What do you do?
7. The owner asks what Sumeet would pay. What do you say?
8. The property is listed with another agent. What do you do?
9. Can you dial a number the owner's relative gave you, from your own phone?
10. What two things must every opening include besides your name and Sumeet's
    name?
11. Someone emails the business saying "remove me". Whose job is it, and by
    when?
12. When do you choose the disposition: before or after filling in the fields?

**Answer key:**
1. Mon–Sat, 9 am–8 pm in the **owner's** time zone (the Call Window ET field
   tells you when).
2. No; no (no federal holidays).
3. Not by itself, but if there's any doubt, treat it as one.
4. Stop. "I'm sorry for the bother — I'll make sure you're not called again."
   End the call. Disposition DNC immediately. No persuading.
5. Never. Live voicemail in your own voice only.
6. Don't dial it; tell Sumeet.
7. No number: "Sumeet will go over real numbers with you himself."
8. Thank them, end the call, disposition *Already Listed*.
9. No. Only numbers on the GHL record, only through WAVV. Pass the new number
   to Sumeet to add properly.
10. That Sumeet is a licensed agent with Coldwell Banker Realty, and that the
    call may be recorded (plus the property you're calling about).
11. Pass it to Sumeet the same day; he enters it within one business day.
12. Fields during the call; disposition last.
