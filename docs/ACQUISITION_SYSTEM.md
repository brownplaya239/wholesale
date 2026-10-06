# Acquisition machine — BatchLeads / Land Portal → GHL + WAVV → AI review → deal

Built 2026-10-01. This is the operating doc: what each piece does, the exact
setup clicks, the launch gate, and the numbers to run it by. Code lives in
`scripts/09_acq_ingest.py`, `scripts/10_acq_release.py`, `site/src/lib/acq/`,
`site/scripts/ghl-*.ts`, `site/src/app/api/hooks/wavv/`, `/admin/calls`.

```
BatchLeads (4,000 homes, one export per cohort query)   Land Portal (1,000 parcels)
            │  09 inspect / add                                  │
            └────────────────┬───────────────────────────────────┘
                             ▼
  09 build ── dedupe (parcel, owner, phone) · suppress (listed / sold / no equity /
              land screens) · DNC+litigator scrub ≤31 d · score · lane · call window
                             ▼
  10 plan / wave ── capacity-driven, stratified county × cohort ─► W##.jsonl
                             ▼
  npm run ghl:push ──► GHL: Contact (dial state) ─ Property object ─ Opportunity
                             ▼
  WAVV (embedded in GHL) dials smart lists ──► call.ended / call.recorded webhooks
                             ▼
  /api/hooks/wavv ── call log (Postgres) · compliance audit · disposition engine
        │            (counters, cadence, phone rotation, DNC, stage moves) ─► GHL
        │            Hot/Booked ─► alert + property report (comps, MLS, worksheet)
        └─ recorded ─► WAVV transcript ─► Claude review ─► AI fields + QA + alerts
                             ▼
  Sum: Hot queue → consultation → buy / assign / list (Coldwell Banker)
  HouseSoldNJ.com form ─► same Contact + Property + Opportunity, tagged acq:inbound
```

## 1. Where this differs from the plan, and why

The plan was mostly right. These are the places I changed it, strongest first.

1. **The 1,000–1,250 fresh leads a week release does not fit your own scorecard.**
   1,200 dials per caller per week is 40 an hour. Two callers make 2,400 dials.
   A contact needs about 8 attempts over 30 days, so they can actually work
   **about 300 fresh owners a week**, not 1,000+. Releasing faster just ages the
   records, and their 31-day DNC scrubs, before anyone dials them.
   - The release size now comes from capacity: `10 plan`, then `10 wave`.
   - The buffer is measured in days of dialing (default 7), not a fixed 1,500.
   - If WAVV multi-line really triples throughput, measure it on `/admin/calls`
     and raise `--dials-per-hour`.
   - My throughput guesses: single-line power dialing ~50–80 dials an hour,
     3-line 150+. Confidence: low. Calibrate in week 1.

2. **Expect far fewer than 5,000 callable records.** Records pulled by several
   cohort queries collapse into one (that is the point of the dedupe). Some
   owners won't skip-trace. Every DNC- or litigator-flagged number is out.
   - My estimate is roughly 1,700–2,500 callable owners from the pull, with the
     rest mail-only. Confidence: low.
   - `09 build` prints the real split. Run it before buying the next pull.

3. **Calls by a licensed agent who may offer a listing are telephone
   solicitations.** DNC scrubbing is mandatory, not optional. You also need your
   own registry subscription (SAN) for every area code you dial. That is more
   than the five free ones now that the footprint covers South Jersey (609/640/856)
   plus out-of-state owners. Confidence: high on the scrub; high that the
   TSR's per-area-code fee rule (16 CFR 310.8) applies once these calls count as
   telemarketing.

4. **WAVV multi-line plus a recorded voicemail means automatic prerecorded
   voicemails.** WAVV's docs say that when multi-line dialing, it "will drop your
   voicemail message automatically in the background". A prerecorded message to
   a cell phone needs prior express written consent (TCPA §227(b)), and no cold
   record has that.
   - Never upload a voicemail recording in WAVV.
   - Callers leave live voicemails or none.
   - Confidence: high.

5. **Multi-line dialing means abandoned calls.** The rule (47 CFR 64.1200(a)(7))
   is: no more than 3% of live-answered calls per campaign per 30 days, and a
   live person must be connected within 2 seconds of the greeting.
   - Launch at **1 line** (power dial, where nobody gets dropped).
   - Go to 2–3 lines only after counsel signs off. `/admin/calls` tracks dropped
     connects against the 3% cap.
   - Contacts in **FL, OK and MD**, or on those area codes, never go in a
     multi-line queue: they are in the `manual` lane. Those states' own statutes
     reach automated dialing beyond federal law. Confidence: moderate.

6. **Don't let WAVV dispositions drive pipeline stages through GHL workflows.**
   The middleware writes all dial state: counters, cadence, number rotation,
   lanes, DNC, and stage moves. That logic is versioned and tested. The two GHL
   workflows only send notifications.

7. **Fill in the fields during the call, choose the disposition last.** GHL's
   stage-required fields are enforced in the UI only ("Conditional validation
   does not apply to Public API or workflow-based updates"). The middleware
   re-checks before moving a card:
   - Warm/Hot with missing fields → the card goes to *Contacted*, gets the
     `qa:missing-fields` tag, and the caller gets a 10-minute task.
   - A Hot seller still alerts you instantly.

8. **Calling state belongs on the Contact.** WAVV dials contacts, and GHL smart
   lists cannot filter on fields of an associated custom object. That's an open
   GHL feature request as of 2025-06. So the primary property's facts are copied
   onto the contact: county, cohort, signals, score and window.

9. **One opportunity per owner per pipeline at release**, anchored to the
   owner's best property, with the other parcels attached to the contact. Then a
   disposition never has to guess which of a landlord's five cards it means. You
   split a second deal by hand when it's real ("Allow Multiple Opportunities per
   Contact" must be on).

10. **The AI is an auditor, not the record.** Claude writes only the `AI …`
    fields. Where it disagrees with the caller is where the money and the risk
    are: a missed opt-out (auto-DNC), a missed listing (suppressed), a hidden hot
    seller (alert), an inflated hot (QA). Claude never makes the call; this stays
    a no-AI-voice business.

## 2. Launch gate — nothing dials until every box is ticked

Legal (counsel and broker in writing; I'm not your lawyer):
- [ ] **Coldwell Banker office sign-off in writing.** Cover:
  - outbound solicitation under the brokerage identity;
  - the dialer (WAVV) and the line count;
  - call recording;
  - callers' permitted role;
  - buying as principal and assigning.
  Anywhere-owned brokerages usually have written telemarketing policies. Get the
  actual document.
- [ ] **Callers' role.** I don't know NJ REC's position on unlicensed callers.
  The conservative line the script enforces:
  - callers gather facts and book Sumeet;
  - callers **never** quote a price, an offer, a commission or listing terms.
  The AI flags any call where they do.
- [ ] **Federal DNC registry subscription (SAN)** covering every area code dialed
  (first 5 free, then a per-area-code fee). The scrub vendor scrubs under YOUR SAN.
- [ ] **NJ telemarketer registration** (Division of Consumer Affairs, N.J.S.A.
  56:8-119 et seq.; $150/yr for 1–5 lines; no real-estate exemption). **Deferred
  by owner decision 2026-10-06** — revisit with counsel (whether intake-only
  buy-side calls count as telemarketing sales calls).
- [ ] **Litigator scrub account** (Blacklist Alliance / DNC.com or similar).
- [x] **Written DNC procedures + caller training** — `compliance/DNC_PROCEDURES.md`
  (the written policy, available on request), `compliance/CALLER_TRAINING.md`
  (curriculum, role-plays, quiz, sign-off), `compliance/CALLER_ACKNOWLEDGEMENT.html`
  (one-page sign-off form). Still to do per caller: train, sign, file in
  `compliance/signed/`, log in `training_log.csv` (`10_acq_release.py
  compliance-init` creates it), add the WAVV user id to `ACQ_TRAINED_CALLERS`.
- [ ] **Recording disclosure at the start of every call.** NJ is one-party
  consent, but absentee owners live in all-party states (CA, FL, PA, WA, MD, MA,
  IL…). One sentence covers all of them.

Systems:
- [ ] Section 4 GHL build is done and `npm run ghl:provision` shows no missing pieces.
- [ ] Section 5 WAVV settings are done. **The voicemail recording slot is empty.**
- [ ] Vercel env vars are set (section 6). The webhook is registered; the test
  event shows `state: "ingested"`.
- [ ] 25-record test batch pushed and checked (section 9).
- [ ] 10 test calls (to your own and team phones) made. Check:
  - the disposition applies;
  - the recording appears;
  - the transcript and AI note arrive;
  - the call shows on `/admin/calls`.

## 3. Data: pull → clean → release (commands)

```bash
pip install pandas openpyxl pyarrow requests tzdata
# one export per cohort query; inspect EVERY new export format first
python scripts/09_acq_ingest.py inspect ~/Downloads/batchleads_vacant_camden.csv
python scripts/09_acq_ingest.py add ~/Downloads/batchleads_vacant_camden.csv \
    --provider batchleads --cohort vacant_equity --skip-trace batchskiptracing
#   cohorts: vacant_equity tax_delinquent absentee_landlord inherited
#            preforeclosure free_clear other_distress
#            land_infill land_acreage land_strategic mpower_2019
python scripts/09_acq_ingest.py build            # report: dupes, suppression, lanes, phones
                                                 # (--dial-states NJ default: other states -> mail lane)
python scripts/10_acq_release.py scrub-export    # unscrubbed / expiring numbers -> vendor
python scripts/10_acq_release.py scrub-apply ~/Downloads/scrub_result.csv --source "DNC.com"
python scripts/09_acq_ingest.py build
python scripts/10_acq_release.py plan --callers 2 --hours 30 --dials-per-hour 40
python scripts/10_acq_release.py wave --size 25 --dry-run
python scripts/10_acq_release.py wave --size 25            # test batch
cd site && npm run ghl:push -- ../data/processed/acq/waves/W01.jsonl
python scripts/10_acq_release.py mail-export               # no-phone owners -> letters
```

Weekly:
- Re-scrub with `scrub-export`, then `scrub-apply`, then `build`, then `patch`,
  then `ghl:push patch_*.jsonl`. This removes numbers that became DNC from
  released contacts.
- Then cut the next `wave`.
- Download the internal DNC list (`/admin/calls`, "Internal DNC CSV") to
  `data/processed/acq/internal_dnc.csv` before every `build`. A number that ever
  opted out is never re-released.

What `build` enforces:
- **Dedupe:**
  - a parcel is county+APN, else address+ZIP;
  - an owner is name + mailing address;
  - a phone number lives on exactly one owner.
- **Suppression:**
  - vendor MLS status active/pending, plus `suppress_active_listings.csv`. **Keep
    an MLS export fresh for all 10 counties.** MOMLS covers Monmouth/Ocean only;
    the South Jersey counties are Bright MLS. The vendor's MLS flag is the only
    backstop until you have that feed.
  - a sale in the last 12 months;
  - not 1–4 units;
  - equity under 10%;
  - land that is landlocked, has wetlands over 20% (10% for infill), is
    flood-constrained, or has slope over 15%.
- **Phones:**
  - callable only with a clean scrub ≤31 days old;
  - never on the internal DNC;
  - never flagged by the vendor.
  - `--trust-vendor-scrub` (off by default) lets BatchLeads' own DNC flag count
    as the scrub. Use it only if the vendor scrubs under your SAN.
- **Lanes:**
  - `power`: multi-line OK after sign-off;
  - `manual`: FL/OK/MD, single line;
  - `mail_only`;
  - `suppressed`.
- **Call window:** expressed on the caller's clock (ET). It is the intersection
  across every zone in the owner's mailing state. Example: Texas spans Central
  and Mountain, so `11a-9p ET`.
- **Score:** the cohort base, plus stacked distress, equity, hold length,
  out-of-state, and land quality. Every point comes with a written reason.

## 4. GHL build (HouseSoldNJ sub-account)

1. **Private Integration Token.** Settings → Private Integrations → new token.
   Scopes:
   - contacts, opportunities: read and write;
   - locations/customFields: read and write;
   - objects/schema, objects/record: read and write;
   - associations, associations/relation: read and write;
   - workflows.readonly, locations.readonly.
   Put it in `site/.env.local` as `GHL_TOKEN` and `GHL_LOCATION_ID` (also in
   Vercel).
2. **Property custom object (UI only — the API needs an agency token).**
   Settings → Objects → Create:
   - singular *Property*, plural *Properties*, key `property`;
   - primary display field **Property Address** (text).
3. `cd site && npm run ghl:provision`. It creates:
   - every contact and opportunity field;
   - both pipelines with exact stage names;
   - the Property fields and the contact↔property association.
   It then prints the leftover manual steps. Re-run until it's clean. Mark
   **Acq Property ID** searchable.
4. **Settings → Objects → Opportunities:** enable **Allow Multiple Opportunities
   per Contact**.
5. **Labs → "Show & Require Opportunity Fields Conditionally"**. Make these
   required on *Qualified Warm*, *Qualified Hot* and Land *Qualified*:
   - Owner Confirmed, Motivation, Property Condition, Seller Timeline;
   - Asking Price, Occupancy, Decision Makers, Next Action, Next Follow Up.
   On *Under Contract*, require **Deal Path** and **Path Disclosed In Writing**.
   (CLAUDE.md: the seller learns buy / assign / list in writing before signing.)
6. **Users.** One GHL user per caller, plus Sum. Put Sum's user id in
   `GHL_OWNER_USER_ID` (Warm/Hot cards and Sum's tasks get assigned to it).
7. **Smart lists.**

   *Dial queues (contact smart lists; WAVV dials these; every one also has
   "DND is off" and "tag is not `dnc`"):*

   | List | Filters | When |
   |---|---|---|
   | Q1 Inbound (consented) | tag `acq:inbound`, Dial Lane = inbound | First, always. Under 5 min while staffed |
   | Q2 Power 9a-8p | Dial Lane = power, Call Window ET = `9a-8p ET`, Next Call Due ≤ today or empty, Asset Class ≠ land | Main queue |
   | Q3 Power late windows | Dial Lane = power, Call Window ET ≠ `9a-8p ET`, Next Call Due ≤ today | Only at or after the window's start (10a/11a/12p ET) |
   | Q4 Manual (FL/OK/MD) | Dial Lane = manual, Next Call Due ≤ today | **Single line only** |
   | Q5 Land | Asset Class = land, Dial Lane in power/manual, Next Call Due ≤ today | Separate WAVV campaign |

   Sort every queue by Lead Score, highest first.

   *Sum's views (pipeline filters / smart lists):*

   | View | Filter |
   |---|---|
   | 🔥 Hot — act now | stage Qualified Hot (and tag `alert:hidden-hot`) |
   | Today | tasks due today + opportunity Next Follow Up = today |
   | Appointments | stage Consultation Booked / calendar |
   | Offers to make | stage Offer Ready |
   | Offers outstanding | stages Offer Made, Negotiating |
   | Contracts pending | Contract Status = Verbal yes / PSA sent |
   | Under contract | stages Under Contract, Title / DD, Disposition |
   | Stale warm | tag `warm`, Last Successful Contact before 7 days ago |
   | Caller QA | tag `qa:review` / `qa:missing-fields` / `compliance:violation` |
8. **Two workflows, nothing more.** Their triggers and actions are in
   `WORKFLOWS` in `site/src/lib/acq/schema.ts`:
   - **ACQ · Hot / Booked alert** (tag `hot` or `booked`): push + SMS to Sum's
     own cell.
   - **ACQ · Inbound speed-to-lead** (tag `acq:inbound`): SMS to the consented
     web lead + "call in 5 min" task.
   Cold contacts carry SMS DND and the `no-sms` tag, so no workflow can text them.

## 5. WAVV settings

1. HighLevel Agency → App Marketplace → WAVV → install to the HouseSoldNJ
   sub-account → activate each caller as their own user.
2. **Dispositions** (Agency View → WAVV Admin → Dispositions). Use exactly these
   labels; the webhook sends the label text:

   | Label | Tag |
   |---|---|
   | No Answer | wavv-no-answer |
   | Voicemail | wavv-voicemail |
   | Wrong Number | wavv-wrong-number |
   | DNC | wavv-dnc |
   | Not Interested | wavv-not-interested |
   | Callback Requested | wavv-callback |
   | Warm Lead | wavv-warm |
   | Hot Lead | wavv-hot |
   | Appointment Booked | wavv-booked |
   | Already Listed | wavv-listed |
   | Property Sold | wavv-sold |
   | Wrong Owner | wavv-wrong-owner |
3. **Dialer settings:**
   - **Record Calls ON** and **Call Transcription ON** (transcripts need recording).
   - **Voicemail drop: no recording uploaded.**
   - **Timezone Protection ON.** It uses the area code; our audit uses the
     mailing state, and the two together cover ported cells.
   - **Nuisance Protection ON** (re-call wait).
   - **Lines: 1** until counsel signs off. Never more than 1 on Q4.
4. **Integrations → API keys:** create a key and set it as `WAVV_API_KEY`
   (transcripts + daily reconciliation).
5. **Integrations → Webhooks:**
   - URL `https://www.housesoldnj.com/api/hooks/wavv`;
   - events `call.ended`, `call.recorded` (started/incoming are optional);
   - copy the `whsec_…` signing secret into `WAVV_WEBHOOK_SECRET`.

## 6. Environment (Vercel → Project → Settings → Environment Variables)

| Var | What |
|---|---|
| `GHL_TOKEN`, `GHL_LOCATION_ID` | sub-account PIT + location id (web leads → GHL, middleware) |
| `GHL_OWNER_USER_ID` | Sum's GHL user id (assignment + tasks) |
| `WAVV_WEBHOOK_SECRET` | `whsec_…` from the WAVV webhook |
| `WAVV_API_KEY` | WAVV public API key (transcripts, reconciliation) |
| `ANTHROPIC_API_KEY` | Claude call review (already used by the photo check) |
| `GHL_COLD_SMS_DND` | `off` only if GHL rejects `dndSettings` on import (default on) |
| `ACQ_TRAINED_CALLERS` | comma list of WAVV user ids with a signed training acknowledgement; any other caller's call is flagged as a violation |
| `DATABASE_URL`, `CRON_SECRET`, `RESEND_API_KEY` / `SLACK_WEBHOOK_URL` | existing: call log, daily reconcile, alerts |

## 7. What happens after every disposition (implemented in `dispositions.ts`)

Every call does the following:
- increments Call Attempts and sets Last Call Date / Last Disposition;
- for a live owner conversation, also increments Conversations and sets Last
  Successful Contact;
- runs the compliance audit.

| Disposition | Middleware action |
|---|---|
| No Answer / Voicemail | Card → Attempting. Next Call Due on the 1,1,2,3,7,7,9-day cadence (Sundays roll to Monday). Rotate to the next number every 2nd miss. At attempt 8: lane `recycle` for 90 days, card abandoned |
| Wrong Number | Number → Invalid Phones; next number becomes primary, due now. None left → lane `reskip` + `needs-reskip` |
| DNC | **Person** + every number to the internal DNC list. DND on all channels, lane `suppressed`, card lost "DNC / opt-out". Overrides everything, forever |
| Not Interested | Card lost, recycle 180 days. If the caller set a future Next Follow Up instead → Follow-Up stage (nurture) |
| Callback Requested | Follow-Up stage, Next Call Due = Next Follow Up (else tomorrow), dated task for the caller |
| Warm Lead | Qualified Warm if the 9 fields are filled (else Contacted + `qa:missing-fields` + 10-min caller task). Assigned to Sum, caller attributed, alert |
| Hot Lead | Same, to Qualified Hot. **Alert to Sum regardless.** Task "call today". **Property report built** (comps, MLS history, flood, photo check, buy/assign/list worksheet) and linked on the card |
| Appointment Booked | Consultation Booked (always), alert, prep task, property report |
| Already Listed | Property suppressed (NJ REC: end the call, never solicit it), card lost. Single-property owner → lane `suppressed`, recheck in 90 days for an expired listing |
| Property Sold | Card lost; single-property owner suppressed |
| Wrong Owner | Number removed, `research:wrong-owner`, research task (if "he passed away" → estate lead) |

Automation never moves a card backwards. It never closes a deal past
Consultation Booked; Sum gets a review task instead.

Compliance audit on every outbound call (deterministic, no AI). Violations alert
immediately and tag `compliance:violation`:
- outside 8am–9pm in any of the owner's zones;
- a cold contact with no scrub, or a scrub over 31 days old;
- a suppressed contact dialed.

Policy breaches (9am–8pm, Sundays, federal holidays) and dropped connects show on
`/admin/calls`.

## 8. The AI layer (what it is and is not)

- **Is:** Claude (`claude-opus-5-5`, structured output) reads each WAVV
  transcript of 15 s or longer and returns:
  - the 12-line acquisition summary on the opportunity (motivation, condition,
    timeline, asking, occupancy, decision makers, liens, listing status,
    objections, next action, temperature + reason, key quote);
  - compliance signals;
  - a 1–5 QA score on the 8 dimensions, plus a coaching note.
- **Acts on disagreement:**
  - missed opt-out → auto-DNC;
  - "it's listed" → property suppressed;
  - hidden hot → alert;
  - inflated hot → QA;
  - missing recording or license disclosure, or a caller quoting price → QA flag.
- **Is not:** a caller, a texter, or the source of truth. It never overwrites
  caller fields. No AI voice, no voicemail drops, no bulk SMS. The cold lists
  carry zero consent artifacts.
- **Timing:** WAVV has no transcript-ready event. The transcript is fetched after
  `call.recorded` and retried on the next webhooks plus the daily cron (up to 15
  tries). The daily cron also pulls the last 26 h of WAVV calls, to catch any
  webhook that never arrived.
- **Cost:** one Claude call per real conversation, a few thousand tokens. Pennies
  per call at the volumes here.

## 9. Test batch (before the first live wave)

1. Run `10 wave --size 25`, then `ghl:push --limit 25`. In GHL check:
   - the contact shows Phone 2/3, Dial Lane, Call Window, Signals and SMS DND;
   - the Property record is linked;
   - one opportunity sits at New / Ready to Call;
   - no duplicates were created;
   - the tags `acq:cold`, `lane:*`, `no-sms` are present.
2. Make 10 test calls to your own and your team's phones, one per disposition
   that matters (No Answer ×2 → number rotation; Wrong Number; Callback; Hot with
   empty fields; Hot with full fields; DNC). On `/admin/calls` and in GHL,
   confirm:
   - each disposition applied;
   - the recording and transcript arrived;
   - the AI note posted;
   - the Hot alert reached your phone;
   - the property report was linked.
3. Release the first live wave at the size `10 plan` gives. Supervise the first
   50–100 calls live.

## 10. Caller script (compliance lines are not optional)

> "Hi, is this {first name}? This is {caller} calling for Sumeet Sancheti — he's
> a licensed real estate agent with Coldwell Banker Realty here in New Jersey,
> and he also buys properties directly. **This call may be recorded.** I'm
> calling about {property street} — is that still yours?"

- **Confirm the owner first.** If it's someone else: "Who would I speak with
  about the property?" If "he passed away": slow down, offer condolences, and
  ask who is handling the estate. That's a lead.
- **Motivation before price:** "What's got you thinking about it?" / "What would
  you do if it sold?"
- **Capture:** condition, timeline, occupancy, decision makers, what they hope
  to get ("roughly where would it need to be for you?"). **Never** say a number,
  an offer, a commission, or listing terms. "Sumeet will go over real numbers
  with you."
- **Listed with an agent?** Thank them and end the call. Disposition *Already
  Listed*. (NJ REC: never solicit another broker's listing.)
- **"Stop calling" in any words:** apologize, confirm they won't be called
  again, disposition *DNC*. Never argue.
- **Fill the fields during the call. Disposition last. Notes within 5 minutes.**
- **Hot** = confirmed owner/decision-maker + real intent + identifiable
  motivation + actionable timeline + meaningful property info + open to an
  offer.
- **Warm** = confirmed owner willing to discuss, with urgency, price or timing
  unresolved.
- **Neither:** "might sell someday", only asks what you'd pay, or no actual
  selling indication.

## 11. Operating rhythm

- **Daily (Sum):**
  - work Sum's views top to bottom: Hot, Today, Appointments, Offers…;
  - read every 🤖 call-review and ⚠️ compliance alert the same day.
- **Daily (callers):** Q1 first, then Q2, then Q3 after the window opens, then
  Q4/Q5. Respect Next Call Due.
- **Weekly:**
  - listen to the `/admin/calls` listen-list (2 successful, 2 ordinary, 1 weak
    per caller) and compare it with their notes;
  - re-scrub and patch;
  - cut the next wave;
  - export the dial log CSV to `compliance/`.
- **Scorecard (calibration for the first 2 weeks, not firing lines):**
  - per caller at 30 h: 1,200+ dials, 60+ conversations, 6+ qualified, 2+ booked;
  - notes within 5 min: 100%;
  - compliance violations: 0.
  - At 40 h, scale proportionally.
- **Funnel by caller × county × cohort × asset × source** is on `/admin/calls`.
  Offer, contract and close counts come from the GHL pipeline report. Cost per
  qualified lead / contract / close = spend (BatchLeads + skip + scrub + WAVV
  seats + caller pay) ÷ those counts. Decide the next pull's cohort and county
  mix from 30–60 days of this, not from intuition.

## 12. Verify on the first live run (could not be tested from the dev sandbox)

- The PIT's ability to create opportunity fields with `options`, and Property
  fields through custom-fields v2. The provisioner prints manual steps for any
  refusal.
- That `dndSettings` on contact update is accepted. If not, set
  `GHL_COLD_SMS_DND=off` and rely on the `no-sms` tag plus the workflow filter.
- WAVV `userId` format. If it isn't a GHL user id, caller tasks go unassigned;
  map them in WAVV.
- WAVV `GET /calls` response field name (`data` vs `calls`). Both are handled.
- BatchLeads / Land Portal export headers. Run `09 inspect` on each, and add any
  unmapped header to `ALIASES` in `scripts/acq_common.py`.
