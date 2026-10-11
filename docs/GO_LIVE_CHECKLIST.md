# Go-live checklist — Sunday setup → Monday training/test → Tuesday dialing

Click-by-click version of what is left. `docs/ACQUISITION_SYSTEM.md` is the
design reference. Menu names in GHL/WAVV move between releases; if a path below
does not match, search the setting name in the settings search box.

Order matters: **Vercel vars (3) before the merge (4); WAVV webhook (2.7)
after the merge.** Env vars only reach production on the next deploy, and the
merge is that deploy.

---

## 1. GHL (HouseSoldNJ sub-account)

### 1.1 Make Acq Property ID searchable
1. Settings → Objects → **Property**.
2. Open the field **Acq Property ID** (folder "Acquisition System") → edit.
3. Turn on **Searchable** (some builds put this under the object's
   "Searchable properties" list instead) → Save.
4. Check: Objects → Property records → search box finds a record by its ID
   (only testable after the 25-record push).

### 1.2 Allow multiple opportunities per contact
1. Settings → Objects → **Opportunities** (older builds: Settings → Opportunities
   / Pipelines settings).
2. Turn on **Allow Multiple Opportunities per Contact** → Save.
   Needed because one owner can hold a residential AND a land deal.

### 1.3 Workflows: publish our 2, leave the other 6 in draft
Automation → Workflows. Leave every GHL template workflow in **Draft**.

**A. ACQ · Hot / Booked alert** (your draft "Hot/Booked Lead Alert")
1. Trigger: **Contact Tag** → Tag Added → `hot`. Add a second trigger: Contact
   Tag → Tag Added → `booked`.
2. Actions, in order:
   - **Internal Notification** → SMS → to Sum (user) / Sum's own cell.
     Body: `HOT: {{contact.name}} {{contact.phone}} — {{contact.primary_property}} — {{contact.signals}}`
   - **Internal Notification** → In-App/Push → same text.
   - **Assign to User** → Sum (leave "only unassigned" off).
3. Settings (gear): **Allow re-entry ON** (a lead can go hot twice).
4. Toggle **Publish** → Save.

**B. ACQ · Inbound speed-to-lead**
1. Trigger: Contact Tag → Tag Added → `acq:inbound`.
2. First action: **If/Else** → branch "STOP" if contact has tag `no-sms` OR
   `dnc` → End. Only web-form leads with stored consent continue.
3. On the continue branch:
   - **Send SMS**: `Hi {{contact.first_name}}, it's Sumeet with House Sold NJ — got your info. Calling you in a few minutes. Reply STOP to opt out.`
   - **Internal Notification** → SMS + push to Sum: `NEW WEB LEAD {{contact.name}} {{contact.phone}}`
   - **Add Task** → "Call within 5 min", due now, assigned to Sum.
4. **SMS needs an approved A2P 10DLC registration** on the sending number
   (Settings → Phone Numbers → Trust Center). If it is not approved, delete the
   Send SMS action for now and publish with notification + task only.
5. Publish → Save.

Test both: add tag `hot` to a test contact of your own → you get the SMS/push.

### 1.4 Smart lists (Contacts → Smart Lists → + Add filter → Save as smart list)
Every dial queue also has: **DND = off for calls** and **Tags does not include `dnc`**.
Sort every queue by **Lead Score**, descending.

| Name | Filters |
|---|---|
| Q1 Inbound (consented) | Tag includes `acq:inbound`; Dial Lane is `inbound` |
| Q2 Power 9a-8p | Dial Lane is `power`; Call Window ET is `9a-8p ET`; Asset Class is not `land`; Next Call Due is before tomorrow OR is empty |
| Q3 Power late windows | Dial Lane is `power`; Call Window ET is not `9a-8p ET`; Next Call Due before tomorrow OR empty — dial only after the window opens |
| Q4 Manual (FL/OK/MD) | Dial Lane is `manual`; Next Call Due before tomorrow OR empty — **single line only** |
| Q5 Land | Asset Class is `land`; Dial Lane is `power` or `manual`; Next Call Due before tomorrow OR empty |

**Date filter caveat:** if your GHL date filter only takes a fixed date (no
relative "today"/"in the next 0 days"), tell Claude — the daily cron can stamp a
`due` tag instead, which is a 20-line change. Do not edit fixed dates by hand
every morning.

**Sum's views** (Opportunities → pipeline view → filter → save view, or smart lists):

| View | Filter |
|---|---|
| 🔥 Hot — act now | Stage = Qualified Hot, plus contacts tagged `alert:hidden-hot` |
| Today | Tasks due today; opportunity Next Follow Up = today |
| Appointments | Stage = Consultation Booked |
| Offers to make | Stage = Offer Ready |
| Offers outstanding | Stage = Offer Made or Negotiating |
| **Offers out, follow-up due** | Stage = Offer Made or Negotiating; Next Follow Up on/before today |
| Contracts pending | Contract Status = Verbal yes or PSA sent |
| Under contract | Stage = Under Contract, Title / DD or Disposition |
| Stale warm | Tag `warm`; Last Successful Contact more than 7 days ago |
| Caller QA | Tag `qa:review`, `qa:missing-fields` or `compliance:violation` |

### 1.5 Caller users
1. Settings → My Staff (Team) → **Add Employee**: name, email, role **User**.
2. Permissions: Contacts, Conversations, Opportunities, Tasks, Calendars ON.
   Workflows, Settings, Billing, Phone Numbers, Marketing, **Export/Bulk actions
   OFF** (the data is PII and the cold-SMS lockout must not be undone in bulk).
3. Do not hand out Admin. Sum stays Admin.
4. Repeat per caller. After Monday sign-off, their **WAVV** user id goes into
   `ACQ_TRAINED_CALLERS` (step 6.4), not the GHL id.

### 1.6 Delete the two empty default pipelines
Both have 0 opportunities (checked 2026-10-11).
Opportunities → Pipelines → **Marketing Pipeline** → ⋯ / edit → Delete. Same for
**Reactivation/ Win Back Pipeline**. Leave Residential Acquisition and Vacant
Land Acquisition untouched (names and stage names are matched by the code).
Do not build COLD CALL NEW LEAD FLOW or CALLBACKS.

---

## 2. WAVV

### 2.1 Install and seats
1. GHL **Agency view** → App Marketplace → **WAVV** → Install → select the
   HouseSoldNJ sub-account.
2. In WAVV admin, assign a seat to each caller and to Sum; each logs in as
   themselves (the per-call user id is what the compliance audit checks).

### 2.2 Where callers dial from
Dial from the **GHL smart lists Q1–Q5** (select list → WAVV "Start dialing").
The smart lists respect Next Call Due, lanes, DNC and call windows; a
stage-based board does not. If WAVV's setup still asks for call boards / "Order
stages by your workflow":
- create boards Inbound & Callbacks, New, Attempting, Manual (single line);
- **turn OFF "move contact to stage on disposition"** for every disposition —
  the middleware is the only thing that moves stages;
- lines = 1 on every board.

### 2.3 The 12 dispositions (Agency View → WAVV Admin → Dispositions)
Delete or hide WAVV's defaults. Spelling and capitalization exactly:

`No Answer` · `Voicemail` · `Wrong Number` · `DNC` · `Not Interested` ·
`Callback Requested` · `Warm Lead` · `Hot Lead` · `Appointment Booked` ·
`Already Listed` · `Property Sold` · `Wrong Owner`

Tags (optional in WAVV; the middleware adds them anyway): `wavv-no-answer`,
`wavv-voicemail`, `wavv-wrong-number`, `wavv-dnc`, `wavv-not-interested`,
`wavv-callback`, `wavv-warm`, `wavv-hot`, `wavv-booked`, `wavv-listed`,
`wavv-sold`, `wavv-wrong-owner`. No GHL stage or workflow action on any of them.

### 2.4 Dialer settings
- Record Calls **ON**; Call Transcription **ON**.
- Voicemail drop: **no recording uploaded** (and none on any user profile).
- Lines: **1** (until counsel signs off; Q4 is always 1).
- Timezone Protection **ON**; Nuisance Protection **ON**.
- Local presence / caller IDs: NJ local numbers (732/908/856/609 match the
  footprint). Register every outbound number at freecallerregistry.com
  (covers the major carriers' spam-labeling analytics) and set CNAM to
  "House Sold NJ" or the brokerage name where the carrier allows. Callback to
  any of these numbers must reach a person or a voicemail box that names the
  business.

### 2.5 API key
WAVV → Integrations → API keys → Create → copy once into Vercel as
`WAVV_API_KEY` (step 3) and your password manager. Never into chat or git.

### 2.6 Inbound
Point inbound on the caller-ID numbers at Sum / the caller group, with a
voicemail greeting that names the business. Inbound callbacks are Q1-priority.

### 2.7 Webhook — AFTER step 4 is live
WAVV → Integrations → Webhooks → Add:
- URL `https://www.housesoldnj.com/api/hooks/wavv`
- Events: `call.ended`, `call.recorded` (`call.started`, `call.incoming` optional)
- Copy the `whsec_…` secret → Vercel `WAVV_WEBHOOK_SECRET` → **Redeploy**
  (Deployments → latest → ⋯ → Redeploy). Then send WAVV's test event; the
  response should say `"state":"ingested"` (a bad secret returns 401).

---

## 3. Vercel (Project → Settings → Environment Variables)

For each: Add → Key → Value → environment **Production only** (previews must
not touch live GHL) → **Sensitive** ON → Save.

| Key | Value |
|---|---|
| `GHL_OWNER_USER_ID` | `U80nFJIhT5WWX7iXOIgX` |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys → Create. Set a monthly spend limit (Billing → Limits) |
| `WAVV_API_KEY` | from 2.5 |
| `WAVV_WEBHOOK_SECRET` | from 2.7 (added after the merge, then redeploy) |
| `ACQ_TRAINED_CALLERS` | Monday, after sign-offs (6.4) |

---

## 4. Merge to main (makes the webhook route, call review and /admin/calls live)

1. github.com/brownplaya239/wholesale → **Pull requests** → New pull request.
2. base `main` ← compare `claude/ghl-acquisition-machine-6jg3mt` → Create pull request.
3. **Merge pull request** (create a merge commit) → Confirm.
4. Vercel builds `main` automatically → wait for **Ready** (Deployments tab).
5. Check:
   - housesoldnj.com loads and the lead form still submits (test lead with your own number);
   - `https://www.housesoldnj.com/api/hooks/wavv` in a browser returns **405**
     (route exists, only accepts POST);
   - `/admin/calls` loads after admin login (empty is fine).
6. Now do 2.7.

Pre-merge state (2026-10-11): `npm run test:unit` 57/57, `python tests/selftest.py`
143/143, `next build` clean; `main` has not moved since the branch was cut, so no
conflicts. The DB tables create themselves on first use.

---

## 5. Lead pulls → 25-record test push

1. **You:** export from BatchLeads / Land Portal per `docs/LEAD_PULL_SPEC.md`
   (one file per cohort query, named per the spec) → upload to Drive folder
   **HouseSoldNJ Lead Pulls**.
2. **Claude:** pulls them into `data/raw/acq/` (gitignored), then per file
   `09_acq_ingest.py inspect` → `add --provider … --cohort …`, then
   `09_acq_ingest.py build` (NJ mailing states only). You get the report:
   dupes, suppressions, lanes, phone counts.
3. **Claude:** `10_acq_release.py scrub-export` → the file goes to Drive.
   **You:** upload it to the scrub vendor (DNC.com / Blacklist Alliance) under
   **your own SAN**, federal DNC + litigator, download the result → Drive.
   - No SAN yet = Tuesday is blocked. telemarketing.donotcall.gov → first 5
     area codes free, each extra is a per-area-code annual fee. Cover every
     area code you will dial (NJ alone has 10: 201, 551, 609, 640, 732, 848,
     856, 862, 908, 973).
4. **Claude:** `scrub-apply <result> --source "<vendor>"` → `build` →
   `plan --callers N --hours H` → `wave --size 25`.
5. **Claude:** `npm run ghl:push -- ../data/processed/acq/waves/W01.jsonl --limit 25 --verify`
   → reads 3 property records back and lists any field GHL dropped.
6. **You:** spot-check 3 contacts in GHL — Phone 2/3, Dial Lane, Call Window,
   Signals, SMS DND on, tags `acq:cold` + `no-sms`, linked Property record,
   one opportunity at New / Ready to Call, no duplicates.

---

## 6. Monday — training, sign-off, test calls

1. Train every caller on `compliance/CALLER_TRAINING.md` (script, opt-out
   handling, no price/offer/commission talk, recording + license line).
2. Each signs `compliance/CALLER_ACKNOWLEDGEMENT.html` (print → sign → scan).
   Store the scans **outside git** (Drive); log name/date/version in
   `compliance/training_log.csv`.
3. Test calls — 2–3 minimum, ideally one per disposition below — from WAVV to
   your own/team phones placed on a test contact (your number on a test contact
   with `acq:cold`, never a real lead):
   - No Answer ×2 (number rotation + Next Call Due advance)
   - Callback Requested (task + date)
   - Hot Lead with qualification fields filled (alert to your phone, assign to Sum, report link)
   - DNC (contact DND'd, `dnc` tag, row in internal DNC)
   After each, tell Claude the time; Claude checks webhook → call log →
   disposition → GHL → transcript → AI summary and the `/admin/calls` row.
4. Claude reads each caller's **WAVV user id** off the test-call log → you add
   `ACQ_TRAINED_CALLERS=id1,id2` in Vercel → Redeploy. From then on, a call by
   anyone not on the list is flagged as a violation.

## 7. Tuesday — go / no-go

Dial only if all are true:
- every Monday test event arrived end to end with a correct disposition;
- the transcript + AI summary posted on at least one recorded call;
- the Hot alert reached Sum's phone;
- scrub on every released number is ≤31 days old, under your SAN;
- the voicemail-drop slot is empty and lines = 1;
- every dialing caller is on `ACQ_TRAINED_CALLERS`.

Start in Q1, then Q2 from 9:00 local. Sum (or Claude via `/admin/calls`)
reviews the first 50–100 calls the same day.
