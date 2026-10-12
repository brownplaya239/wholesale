# Written Do-Not-Call & Outbound Calling Procedures

**Version 1.0 · effective at first caller training (planned 2026-10-12) · owner: Sumeet Sancheti**
Status: in force for all outbound calling; draft for counsel review.

This is the written policy required by 47 C.F.R. § 64.1200(c)(2)(i)(A) and
(d)(1) and 16 C.F.R. § 310.4(b)(3)(i). It is available on request to anyone who
asks, including any person we call. Every caller reads it, is trained on it
(`CALLER_TRAINING.md`), and signs `CALLER_ACKNOWLEDGEMENT.html` before
placing a call.

## 1. Program facts

| | |
|---|---|
| Calls are made on behalf of | Sumeet Sancheti, NJ Licensed Real Estate Salesperson #2082408, Coldwell Banker Realty (335 Route 9 South, Manalapan, NJ 07726) |
| Compliance owner | Sumeet Sancheti — (908) 596-0242 · sum@housesoldnj.com |
| Dialer | WAVV, embedded in GoHighLevel (HouseSoldNJ sub-account) |
| Caller-ID numbers | `__________` (record each number; all registered, all answered or routed to a voicemail that names the business) |
| National DNC Registry Subscription Account Number (SAN) | `__________` · area codes covered: `__________` |
| DNC scrub vendor (scrubs under our SAN) | `__________` |
| Litigator scrub vendor | `__________` |
| Records location | `compliance/` (logs) · Postgres `acq_calls` / `acq_suppression` (call log, internal DNC) · WAVV/GHL (recordings) |

## 2. Scope

Covers every outbound call to a property owner made by Sumeet Sancheti or
anyone calling for him, through WAVV or by hand, on any list: BatchLeads, Land
Portal, skip-trace returns, the 2019 M-Power list, or anything else. It also
covers calls to people who filled in the HouseSoldNJ.com form; §5.9 lists the
rules that differ for them.

## 3. Responsibilities

- **Compliance owner (Sumeet):**
  - keeps this policy current;
  - maintains the registry subscription and the vendors;
  - approves every list release;
  - reviews compliance alerts daily;
  - trains callers and signs their training log entries;
  - handles complaints and incidents (§10).
- **Callers:**
  - dial only the assigned GHL/WAVV queues during the allowed hours;
  - use the opening in §5.3;
  - honor every do-not-call request on the spot (§6);
  - record the disposition and fields truthfully.
- **The system** (`docs/ACQUISITION_SYSTEM.md`) enforces what it can,
  automatically (§9.1). A caller is never excused because "the system let me
  dial it".

## 4. Before a number can be dialed (list preparation)

1. **Source.** Records enter only through `scripts/09_acq_ingest.py`. Raw
   vendor files are archived unchanged in `compliance/skiptrace_raw/`. No caller
   ever dials from a spreadsheet, a vendor portal, or the 2019 phone columns.
2. **National registry.** A number is callable only if a scrub against the
   National Do Not Call Registry says clean. The scrub must use a registry
   version obtained under our own SAN no more than **31 days** before the dial
   (47 C.F.R. § 64.1200(c)(2)(i)(D); 16 C.F.R. § 310.4(b)(3)(iv)).
   - Our SAN covers every area code we dial (16 C.F.R. § 310.8).
   - A wave is not released unless each scrub has at least 21 days of validity
     left.
   - Released contacts are re-scrubbed weekly (`10_acq_release.py
     scrub-export` / `scrub-apply`).
   - Numbers that are newly on the registry are pulled from GHL (`patch`).
3. **Litigator list.** Every number is scrubbed against a TCPA-litigator list
   in the same batch. A hit is never callable.
4. **State lists and cleared states.** Callable owners are only those whose
   mailing state is on the cleared list (`--dial-states`, default **NJ only**).
   - A state is cleared when the compliance owner confirms its own
     do-not-call list is scrubbed and its registration and hour rules are
     handled, records that as a new version in §11, and adds the state to
     `--dial-states`.
   - Owners in uncleared states get mail only.
   - FL, OK and MD residents or area codes, once cleared, are manual
     single-line dialing only.
5. **Internal do-not-call list.** These numbers and people are never released
   again:
   - every number and person in `acq_suppression`
     (`/api/admin/acq/export?kind=dnc` → `data/processed/acq/internal_dnc.csv`);
   - everyone in `compliance/optouts.csv`.
   Export it before every `09 build`.
6. **Other suppression:** properties actively listed with another broker (NJ
   Real Estate Commission rules), recent sales, and wrong numbers already
   recorded.
7. **Scrub records.** Every scrub batch is logged in `compliance/scrub_log.csv`
   (date, vendor, count, number suppressed, file hash). The vendor's return
   file is kept.

## 5. Making calls

1. **Hours.** Monday–Saturday, **9:00 am–8:00 pm in the owner's time zone**.
   No Sundays, no federal holidays. The legal outer limit is 8:00 am–9:00 pm
   (47 C.F.R. § 64.1200(c)(1)); our window is tighter on purpose. The owner's
   zone comes from their mailing state.
   - Callers work queues by the "Call Window ET" field. Late-window queues
     (10a, 11a, 12p ET) are opened only after their start time.
   - Where a state is stricter, the state rule wins once that state is
     cleared: PA residents 9:00 am–7:00 pm, no Sundays or holidays, from about
     Oct 18, 2026; FL 8:00 am–8:00 pm.
2. **Frequency.**
   - At most one attempt per contact per day; never more than 3 calls in 24
     hours to the same person about the same property.
   - The cadence is 8 attempts over about 30 days, then 90 days of rest.
   - Every number for a person counts toward that person's limit.
3. **Opening, every call, before anything else:**
   > "Hi, is this {first name}? This is {caller} calling for Sumeet Sancheti —
   > he's a licensed real estate agent with Coldwell Banker Realty here in New
   > Jersey, and he also buys properties directly. This call may be recorded.
   > I'm calling about {property street} — is that still yours?"

   This states the caller's name, the person and brokerage the call is for,
   that the caller is a licensee, the purpose, and that the call is recorded
   (47 C.F.R. § 64.1200(d)(4)). If asked, give the callback number
   `__________` and the office address in §1.
4. **Caller ID.** WAVV must always transmit a caller-ID number we own and
   answer, with the business name where the carrier supports it (47 C.F.R.
   § 64.1601(e)). Never block caller ID. Never spoof another number.
5. **Live humans only.**
   - No artificial or prerecorded voice, no AI voice, no ringless voicemail,
     and no voicemail drops (47 U.S.C. § 227(b)).
   - The WAVV voicemail-drop recording slot stays **empty**. In multi-line mode
     WAVV drops any recording automatically.
   - Callers may leave a live voicemail, spoken by the caller: "Hi, this is
     {caller} calling for Sumeet Sancheti, a licensed real estate agent with
     Coldwell Banker Realty, about {property street}. You can reach us at
     {number}. Thank you."
6. **One line.**
   - WAVV runs single-line until counsel approves more in writing.
   - With more than one line, dropped connects must stay under 3% of
     live-answered calls per campaign per 30 days (47 C.F.R.
     § 64.1200(a)(7)). `/admin/calls` measures this.
   - The manual lane (FL/OK/MD) is single-line forever.
7. **No texts or email to cold contacts.** They carry SMS do-not-disturb and
   the `no-sms` tag.
8. **What callers say and don't say.**
   - Callers gather facts and book Sumeet.
   - They never state a price, an offer, a commission, or listing terms.
   - If the property is listed with an agent: thank the owner, end the call,
     and disposition *Already Listed*.
9. **Website leads (consented).** People who submitted the HouseSoldNJ.com form
   with the consent box checked may be called and texted about their inquiry
   (the stored consent record), inside the same hours. A request to stop ends
   that consent at once (§6).
10. **Recording.** All calls are recorded, and the notice is in the opening. NJ
    allows recording with one party's consent (N.J.S.A. 2A:156A-4(d)), but some
    owners live in all-party states, so the notice is given on every call.
    - If an owner objects to recording: apologize, offer to have Sumeet call
      from a line that is not recorded, end the call, and note it.

## 6. Do-not-call requests

**What counts.** Any request, in any words, not to be called, to be removed,
or not to be contacted. For example: "take me off your list", "don't call me
again", "I'm on the Do Not Call list", "stop calling", "who gave you this
number, don't call here", "lose my number". "Not interested" by itself is not
a do-not-call request. If in doubt, treat it as one.

**On the call:**
1. Do not argue, persuade or ask "are you sure".
2. Say: *"I'm sorry for the bother — I'll make sure you're not called again.
   Have a good day."*
3. End the call politely.
4. Disposition **DNC** in WAVV immediately.

**What the system does on a DNC disposition, automatically:**
- adds the person and every number on the contact to the internal list
  (`acq_suppression`);
- sets GHL do-not-disturb on all channels, Dial Lane `suppressed` and the tag
  `dnc`;
- closes the opportunity ("DNC / opt-out") and removes it from every dial
  queue.

The AI call review also runs on every recorded call. If the transcript shows
an opt-out the caller did not record, the same suppression is applied
automatically and the compliance owner is alerted.

**Requests that arrive any other way** (callback, voicemail, text STOP, email,
letter, in person, through Coldwell Banker): the person who receives it tells
the compliance owner the same day. The compliance owner, **within one business
day**:
- in GHL: adds the tag `dnc`, sets Dial Lane `suppressed` and turns DND on for
  all channels;
- adds a row to `compliance/optouts.csv`: date, phone(s), name, property,
  channel, their words, received by, and when it was entered in GHL.

The federal outer limit for honoring a request is 10 business days (47 C.F.R.
§ 64.1200(d)(3)); we honor immediately.

**Scope and duration.**
- A request covers the person, every number they have, and every property
  they own.
- It covers all calls made for Sumeet Sancheti / HouseSoldNJ.
- We never re-skip-trace a person to find a number around their request.
- Requests are **permanent** in our system; federal law requires at least 5
  years (47 C.F.R. § 64.1200(d)(6)).
- The internal list is never sold, shared or used for anything except
  suppression.

## 7. Wrong numbers and wrong owners

- Disposition *Wrong Number* or *Wrong Owner*.
- The number is removed from that contact permanently and never re-dialed for
  them.
- A person reached by mistake who asks not to be called is a DNC request (§6).

## 8. Records and retention

| Record | Where | Kept |
|---|---|---|
| Every dial: time, number, caller, duration, disposition, compliance flags | `acq_calls`; weekly export `compliance/dial_log_YYYY-MM-DD.csv` | 7 years |
| Scrub batches | `compliance/scrub_log.csv` + vendor return files | 7 years |
| Do-not-call requests | `acq_suppression` (append-only) + `compliance/optouts.csv` | permanent |
| Training | `compliance/training_log.csv` + signed forms in `compliance/signed/` | 7 years after the caller leaves |
| Incidents and complaints | `compliance/incidents.csv` + saved recordings | 7 years |
| Raw vendor lists | `compliance/skiptrace_raw/` | 7 years |
| Call recordings and transcripts | WAVV / GHL (vendor retention) + `acq_calls` transcripts | vendor term; incident recordings saved locally |

Federal telemarketing rules require 5 years (16 C.F.R. § 310.5); we keep 7.
Logs are append-only: never edit or delete a row; a correction is a new row.
Lead data never goes into git.

## 9. Monitoring and enforcement

1. **Automatic, on every call** (`site/src/lib/acq/compliance.ts`). Each check
   is logged on the call and violations alert the compliance owner at once.
   - Calling outside 8 am–9 pm in any of the owner's zones (violation).
   - Calling outside 9 am–8 pm, on Sunday or on a federal holiday (policy).
   - Calling a suppressed contact (violation).
   - Calling a cold contact with no scrub, or a scrub over 31 days old
     (violation).
   - A caller who is not on the signed training log (violation;
     `ACQ_TRAINED_CALLERS`).
   - A number not on the contact record (warning).
   - A dropped connect (warning; counts toward the 3% cap).
2. **AI review of every recorded conversation** flags:
   - missed opt-outs (auto-suppressed);
   - listed properties;
   - missing recording or license disclosure;
   - callers quoting prices or terms;
   - other concerns.
3. **Daily:** the compliance owner reads every ⚠️ compliance and 🤖 call-review
   alert the same day.
4. **Weekly:**
   - review `/admin/calls` (violations, dropped-connect rate, QA flags);
   - listen to at least 5 calls per caller;
   - export the dial log;
   - re-scrub;
   - check that the training log covers every active caller.
5. **Consequences.**
   - Any violation: coaching and a documented review.
   - A second violation of the same rule, or any deliberate violation
     (arguing with a DNC request, dialing outside the queues, quoting prices):
     removal from calling until retrained.
   - Repeated or deliberate violations: removal from the program.

## 10. Complaints, demand letters, incidents

1. Every violation flag, complaint or legal threat gets a row in
   `compliance/incidents.csv` within one business day: what happened, the call
   id, the caller, and the action taken.
2. A complaint or threat ("I'm on the Do Not Call list, I'll sue"): apply §6
   immediately, do not argue or offer money on the call, and alert the
   compliance owner the same day.
3. A demand letter or lawsuit:
   - preserve everything: save the recording, transcript and call log rows to
     `compliance/incidents/`;
   - delete nothing;
   - send it to counsel before any reply.
4. Fix the cause (a list, a setting, training) and record the fix in the same
   row.

## 11. Changes

The compliance owner reviews this document every quarter and whenever a law,
the dialer, or the business model changes. Each change gets a new version
number, and every caller is retrained on it before their next shift.

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-10-06 | First issue |

*This document governs how this business calls people. It summarizes the rules
we follow; the cited regulations control where they say more.*
