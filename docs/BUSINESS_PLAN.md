# Business Plan — Multi-State Launch (Houses + Land)

Drafted 2026-08-13. Companion to docs/PLAYBOOK.md (NJ old-list revival, which
continues as its own track). This doc covers the NEW engine: fresh LandInsights
data, outsourced cold callers (Vita Talent Staffing), and PPC on HouseSoldNJ.com.
**Launch is NJ-only; PA and FL expand later on performance triggers, running the
same system (§2).** Verify every legal statement with counsel per state before
first dial — statutes cited are current as of drafting.

## 1. Thesis and model

Buy-side direct-to-seller acquisition of off-market houses AND vacant land,
monetized through a stacked exit menu (not assignment-only):

1. **Assignment** — default for fees under ~$15k.
2. **Double close** — fees over ~$15k (transactional funding $1.5-3k), and the
   default structure anywhere assignment is legally awkward (see PA below).
3. **Novation / list-side** — Sum is a licensed NJ agent: every dead NJ buy-lead
   is a live listing lead. Dual-track "cash offer vs. list it" presentation is
   the single biggest closing-rate lever this business has and most competitors
   can't offer it.
4. **Buy and hold / flip selectively** — only when a deal pencils far inside MAO.

Two product lines, one system:

| | Houses | Land |
|---|---|---|
| Avg fee target | $15-25k (NJ), $12-18k (PA), $15-20k (FL) | $8-15k |
| Competition | Heavy (every wholesaler mails these) | Light — callers reach owners nobody has called |
| Cycle time | 30-60 days | 45-120 days (dispo slower) |
| Primary channels | PPC + cold call + mail | Cold call + blind-offer mail |
| Dispo | Cash-buyer list (script 03 harvest) | Neighbors, builders, Land.com/LandWatch, FB land groups |

Land is the wedge in the outer-NJ counties (Cumberland, Cape May, Burlington
pinelands edges) now, and in Lancaster/Berks + FL when expansion triggers fire;
houses carry the NJ core.

## 2. Market rollout — NJ first, expand on triggers, same system

Launching 13 counties in 3 states at once guarantees mediocre data, spam-flagged
numbers, and zero follow-up depth everywhere. **Launch is NJ-only**: every
caller-hour, PPC dollar, and mail piece concentrates in the 8 NJ counties.
Concentration compounds everything that actually wins deals — number
reputation, follow-up depth, dispo-bench density, market knowledge on
appointments — and NJ is the one state where the license already works, the
SR1A/MOD-IV pipeline is native, and the legal regime is the simplest
(one-party recording, 8am-9pm, no FTSA caps, no Act 52).

**County waves inside NJ (Monmouth, Ocean, Middlesex, Hudson, Bergen,
Burlington, Cape May, Cumberland):**
- **Wave 1 (wk 3):** Monmouth / Ocean / Middlesex houses — existing turf,
  buyer depth from the script 03 harvest.
- **Wave 2 (wk 5-6):** Burlington houses (cheapest entry, Philly-side investor
  demand) + Cumberland / Cape May land.
- **Wave 3 (wk 9+):** Hudson / Bergen — highest prices, heaviest competition,
  best per-deal fees; enter with a proven pitch, not a rookie one.

Adding these counties is a config change to scripts 02-08, not new build — the
state files are statewide.

**Out-of-state expansion — trigger-based, not calendar-based.** PA first
(Chester, Lancaster, Berks/Reading), then FL (Martin, Palm Beach). Expand only
when ALL of these are true:
1. NJ at ≥3 contracts/month for 2 consecutive months;
2. QA-passed lead cost inside $100 for 4+ straight weeks;
3. follow-up SLAs green (no aging pipeline violations);
4. 3+ months of opex banked from deal flow, not savings;
5. a lead manager in seat, freeing Sum's calendar for the new market's
   appointments;
6. the state's legal gate is clear — for PA that's Act 52 licensing (§4).
   Cheap head start: begin the PA salesperson coursework in the background
   during NJ ramp so the gate is already open the day the triggers fire.

Expansion is the SAME system pointed at a new state — new list pull, new
compliance config in the dialer, new attorney/title bench, same CRM, same
scripts, same QA, same KPIs. The market-open rule below is the entire
expansion playbook. Market intel for when the time comes: Reading is PA's
volume market, Lancaster mid-market + land/farmette dispo, Chester the fee
market; FL opens land-first (Palm Beach Acreage/Loxahatchee, western
Martin/Indiantown) under the tightened FTSA config (§4).

Rule: a market is "open" only when it has (1) scrubbed list loaded, (2) buyer
bench of 10+ verified names, (3) compliance config set in the dialer, (4) an
attorney + title/escrow contact who closes assignments/double closes in that
state.

## 3. Lead engine — three channels, one CRM

### 3a. Cold calling (Vita Talent Staffing callers) — the volume channel

- **Lists**: LandInsights for both land and houses (First American-sourced;
  ~$0.05/record a la carte or ~$4.5k/yr unlimited; built-in scrub drops
  landlocked/wetland/flood parcels; skip trace $0.02-0.04/record). House lists:
  stack 2+ distress signals (absentee + equity ≥40%, tax delinquent, pre-probate/
  inherited, code violations, tired landlord ≥15-yr hold). Land lists: 1-40 acre
  parcels, out-of-county owners, ≥10-yr hold, no improvements. Every list gets
  the PLAYBOOK treatment before dialing: dedupe on the property key, suppress
  active MLS listings (data/processed/suppress_active_listings.csv), DNC +
  litigator scrub, log to compliance/.
- **Vendor reality check**: Vita Talent could not be independently verified from
  public sources at drafting. Before signing: demand sample call recordings,
  TCPA training evidence, a named-agent (not pooled) model, 30-day replacement
  guarantee, and written confirmation callers will follow OUR compliance config.
  Market rate for experienced real-estate cold-calling VAs is ~$6-12/hr; budget
  $8-10 fully loaded. If they fail the audit, 20four7VA / HireTrainVA-class
  vendors are drop-in substitutes.
- **Dialing tech**: click-to-dial or single-line preview ONLY (hard rule below).
  Rotate 3-5 local-presence DIDs per caller, register every number (Free Caller
  Registry + carrier registration), monitor spam labeling weekly, retire flagged
  numbers. No voicemail drops.
- **Script spine (houses)**: permission open → 4-pillar qualification
  (condition, timeline, motivation, price) → NJ calls include license-status
  disclosure at first contact (REC rule) → book appointment for Sum same/next
  day. Callers set appointments; they do not negotiate price. Land script adds:
  road access, utilities, back taxes, "would you take X range" temperature check.
- **Per-caller math (plan on the conservative end)**: 6 productive hrs/day,
  120-200 preview dials, 20-35 live contacts, 1-2 qualified leads/day. Two
  callers ≈ 40-70 qualified leads/mo at ~$3.5-4.5k/mo total caller cost →
  $60-100/qualified lead, 3-6% lead→contract → 1.5-4 contracts/mo once follow-up
  compounds (months 1-2 will be roughly half that).

### 3b. PPC on HouseSoldNJ.com — the intent channel

- **Site**: rebuild as a conversion page, not a brochure: one hero with address
  + phone form above the fold, 2-step form (address → contact), instant
  click-to-call, testimonials/proof, county landing pages
  (housesoldnj.com/monmouth-county etc.), <2s mobile load. Carrot-style
  template or lean Next.js — either is fine; conversion structure matters more
  than stack. Target 15-25% form conversion on paid traffic.
- **Domain strategy**: the NJ-branded domain HELPS Quality Score and trust in
  NJ — run all NJ spend on it. Do NOT stretch "HouseSoldNJ" to PA/FL: buy two
  sibling domains later (e.g., a PA and an FL equivalent) and clone the build.
  PPC for PA/FL waits until those markets' phones are already producing —
  cold calls prove a market before paid dollars do.
- **Campaigns**: exact/phrase only. Tier 1 "sell my house fast [county/city]",
  "we buy houses [city]", "cash for my house". Tier 2 situational: probate,
  inherited house, behind on payments, hoarder house, fire damage. Aggressive
  negatives from day 1 (realtor, zillow, agent, salary, jobs, "how to", listings).
  Call-only ads 8am-8pm + landing-page campaigns. Call tracking (CallRail or
  equivalent) with recording disclosure, dynamic number insertion.
- **2026 benchmarks**: seller-intent clicks in competitive metro markets run
  $30-100+; realistic blended CPL $150-350 in NJ; budget $3-5k/mo at launch →
  ~12-25 leads/mo. PPC leads close 5-10% (they raised their hand) → ~1-2
  deals/mo at maturity, $2.5-6k cost per deal. Kill/scale rules in §9.
- **Speed to lead is the whole game**: form or call answered <5 minutes, 24/7.
  Missed PPC calls are burned money — route to Sum's cell + a caller on
  staggered hours; after-hours to a live answering service. (AI voice is fine
  INBOUND per PLAYBOOK — a 24/7 AI receptionist that qualifies and books is
  compliant here and worth testing.)

### 3c. Direct mail — the moat channel

Continues per PLAYBOOK for the old list; extend to new lists: houses get the
3-touch First-Class letter sequence ($0.75-0.95/piece) on the top-stacked
segments; land gets **blind-offer or offer-range letters** (the land industry's
workhorse — response 1-3% vs 0.5-1% for plain letters). Mail is also the legal
pressure-release valve: every phone-hostile record (DNC-listed, litigator-list,
FL 3-attempt cap reached) automatically falls into the mail track instead.
Budget $1-1.5k/mo Phase 1.

## 4. Compliance gates — per state (blockers, not paperwork)

Only the NJ column is operative at launch. The PA/FL columns are pre-researched
expansion intel — kept current so the trigger-fire in §2 doesn't stall on legal
homework.

Federal baseline everywhere (unchanged PLAYBOOK hard rules): **no AI outbound
voice, no ringless VM, no bulk SMS — zero consent artifacts exist on any of
these lists.** FCC 24-17 puts AI voice inside TCPA §227(b), $500-1,500/call,
private right of action, uncapped. Human-initiated dialing only. Federal DNC +
litigator scrub, ≤31-day refresh. Revocations honored immediately
(compliance/optouts.csv). Append-only dial logs in compliance/ per state.

| | NJ | PA | FL |
|---|---|---|---|
| Wholesaling legality | Legal; Sum licensed → REC disclosure rules apply (PLAYBOOK) | **Act 52 (eff. 2025-01-04): residential wholesaling requires a PA real estate license** + written disclosure (not buying yourself, assignment fee amount) + seller cancellation right | Legal, no wholesaling statute; Ch. 475 rails: assignable contract + EMD actually delivered, advertise the CONTRACT not the property, §475.278 disclosures; unlicensed-brokerage penalty $5k/violation |
| Call hours (local) | 8am-9pm | 8am-9pm | **8am-8pm** |
| Attempt caps | Federal norms | Federal norms | **3 attempts / 24 hrs same subject (FTSA)** |
| State DNC | Federal registry (NJ incorporates it) | PA state list (quarterly) + federal; clean within 30 days | FDACS state list + federal |
| Telemarketer registration | Registration statute exists (N.J.S.A. 56:8-121) | Registration + **$50k surety bond**; criminal exposure if required and skipped | FTSA/FTA licensing regime |
| Call recording | One-party | **TWO-party consent** | **TWO-party consent** |
| Assignment mechanics | Express clause + attorney PSA (avoids 3-day attorney review) | Act 52 disclosures baked into contract; double close is the clean structure | Assignable PSA + EMD + §475.278 disclosure pack |

**The registration question (all three states).** Registration statutes cover
soliciting the *sale of goods or services to* the consumer. A pure
offer-to-purchase call arguably isn't that — but the moment a caller pitches
Sum's *listing services* ("we can also list it for you"), it plainly is.
Operating decision: **outbound scripts are offer-to-purchase only; the
list-option is raised by Sum on the appointment, never by callers on the dial.**
Get a one-time counsel opinion per state on registration anyway and file it in
compliance/ — the PA bond is cheap insurance against a criminal statute if
counsel says register.

**The PA gate (pick one before any PA dial):**
1. Sum obtains a PA salesperson license (75-hr pre-license, education waivers
   available for out-of-state licensees; must affiliate with a PA broker) →
   full menu available. This is the recommended path — it also unlocks the
   dual-track list option in PA.
2. Counsel-approved principal-purchase model only (actually buy, double close,
   never assign) structured to sit outside Act 52's wholesale-transaction
   definition — narrower and needs written sign-off.

**The FL dialing config (hard-coded in the dialer):** 8am-8pm ET, 3-attempt/24h
cap enforced by the system not the caller, FDACS+federal scrub, click-to-dial
only (FTSA's autodialer definition is broader than federal), recording
disclosure in the first breath of every recorded call. Same recording
disclosure on PA calls, or simply don't record PA/FL calls and QA from the
dialer's disposition notes + live monitoring instead.

## 5. The lead-to-deal system (one pipeline, every channel)

**Stack** (keep it to one pane of glass): an investor CRM that natively does
list stacking, drip sequences, KPI dashboards, and integrates a compliant
dialer — ReSimpli-class all-in-one, or REISift + smrtPhone if you want the
best-of-breed pair. CallRail on PPC. Non-negotiables: every lead source tagged
at intake; every call disposition logged; DNC/optout suppression enforced at
the dialer level; the compliance/ export is automatic, append-only.

**Stages and SLAs:**

| Stage | Definition | SLA / owner |
|---|---|---|
| New | Raw inbound (PPC form/call) or caller-flagged | Touch <5 min PPC / same day cold-call (caller → lead mgr) |
| Qualified | 4 pillars captured, motivation real | Appointment set <24h (caller) |
| Appointment | Sum call/visit; comp file built (script 07) | Held <72h of qualification; offer made AT the appointment |
| Offer out | Three-price frame per PLAYBOOK (reservation/opening/anchor) | Follow-up T+2, T+7, then cadence below |
| Contract | Signed PSA + assignment clause / Act 52 pack / §475.278 pack | Same-day: EMD, title open, dispo blast |
| Dispo | Marketed to bench; showings batched | Assigned/closed inside inspection window |
| Closed / Dead | Dead ≠ deleted → drip + (NJ) list-track review | Every dead lead gets a 90-day pulse |

**Follow-up is where the money is** — industry-wide, well over half of
contracts come after touch 5+, and almost nobody calls back month 3+. Cadence
after an unconverted offer: day 2, day 7, day 14, day 30, then every 30-45 days
until sold (check SR1A/recorder), listed (suppress), or DNC. Every price-anchor
mismatch gets a diarized "market check-in" call — sellers' anchors decay.
The CRM enforces this; humans don't remember 400 open follow-ups.

**Offer discipline**: houses underwrite per PLAYBOOK (comp engine, rehab tiers,
MAO formula, three-price frame). Land: MAO = 25-40% of retail comp value
(LandInsights comping tool + county sold data), retail via price-per-acre bands
on truly comparable parcels (access/utilities/zoning matched — never blend
improved and raw comps).

**Dispo depth = closing rate.** A contract you can't sell isn't a deal. Keep
building the bench: script 03 buyer harvest (extend county coverage as Phase 1
opens), every PPC "investor looking to buy" call captured, land buyers from
Land.com/LandWatch sold listings, FB land groups, builders (Lancaster/Chester),
and the neighbor letter (both adjacent owners get first look on every land
contract — highest-probability buyer in land). Target ≥25 verified names per
open market; blast within 1 hour of contract; require non-refundable EMD from
end buyers.

## 6. Team, comp, cadence

| Role | Who / when | Comp |
|---|---|---|
| Acquisitions + dispo closer | Sum (day 1) | Owner economics |
| Cold callers x2 → x4-6 | Vita Talent (day 1; scale a pod per market at ~40 leads/mo/market) | ~$8-10/hr + $25-50/QA-passed qualified lead + $250/closed deal sourced |
| Lead manager | Month 2-3: promote best caller | Base + $100/contract |
| Transaction coordinator | Per-deal contractor (day 1) | $350-500/close |
| PPC operator | Freelance/agency, month 1 | $500-1k/mo mgmt |
| Counsel + title, per state | Before each phase opens | Per-deal |

QA: score 2 recorded (NJ) or live-monitored (PA/FL) calls per caller per day
against a rubric (compliance items are auto-fail). Lead bonus pays only on
QA-passed leads — this single rule keeps outsourced callers honest.

Cadence: daily 15-min huddle (dials, contacts, leads, appointments — leading
indicators only); weekly pipeline review (offers out, aging follow-ups, dispo);
monthly per-channel CAC and cost-per-deal review against §9 kill lines.

## 7. Budget and unit economics (NJ-only steady state, ~month 4)

| Line | $/mo |
|---|---|
| Callers (2 FTE, loaded) | 3,500-4,500 |
| Data + skip trace (LandInsights) | 300-500 |
| CRM + dialer + numbers + call tracking | 400-600 |
| PPC spend + management | 3,000-5,000 |
| Direct mail | 1,000-1,500 |
| Compliance (scrubs, counsel amortized), misc | 300-500 |
| **Total** | **~8,500-12,600** |

Expected output at maturity (month 4-6, NJ alone): cold call 1.5-3 contracts/mo,
PPC 1-2, mail 0.5-1 → **2.5-5 closings/mo** at NJ's blended $15-22k fee →
$40-90k/mo gross against ~$9-13k opex. Ramp honestly: months 1-2 = 1-2 deals
total (pipeline filling), month 3 = 2-3. Cost-per-deal by channel: cold call
$1.5-3.5k, PPC $2.5-6k, mail $3-6k. Twelve-month conservative case, NJ-only:
20-30 deals, $350-550k gross — before any expansion revenue. Cash reserve at
start: ~$35-45k (3 months opex + EMD float + one transactional-funding round).
When the §2 triggers fire, each new state adds roughly $4-6k/mo (a 2-caller
pod + data + its share of mail) and should be funded from NJ deal flow, not
new capital.

## 8. 90-day launch calendar (all NJ)

- **Wk 1-2 — Infrastructure.** CRM + dialer + numbers registered; NJ compliance
  config per §4 loaded; NJ counsel engaged (opinion letter, PSA template);
  Vita Talent audit + 2 callers contracted; LandInsights account, wave-1 pulls
  (Monmouth/Ocean/Middlesex houses); scrub + suppress + load; HouseSoldNJ.com
  rebuild started. Optional background thread: enroll in PA pre-license
  coursework so the Act 52 gate is open before it's needed.
- **Wk 3-4 — Phones live (wave 1).** Callers ramp on the house lists; Sum runs
  every appointment; mail drop 1 on stacked segments; buyer-bench blast to
  script 03 harvest output; site done, PPC in learning mode at $100-150/day.
- **Wk 5-8 — First contracts + wave 2.** Follow-up cadence compounding; first
  1-2 contracts expected; PPC first optimization pass (search-terms scrub,
  county bid tiers); wave-2 lists pulled + scrubbed (Burlington houses,
  Cumberland/Cape May land); land dispo channels stood up (neighbor letters,
  Land.com/LandWatch, builder contacts).
- **Wk 9-12 — Wave 3 + deepen.** Hudson/Bergen lists live; caller #3 only if
  QA-passed-lead cost is inside $100; dispo bench pushed past 25 verified
  names; dead-lead list-track review (licensed dual-track) running; first
  reading of the §2 expansion triggers — expected verdict at day 90 is
  "not yet," and that's fine.
- **Post-90 — Expansion on triggers, not dates.** When §2 fires: PA first
  (gate must be clear), FL after, each via the market-open rule. Same system,
  new state.

## 9. Kill criteria and risk rails (decide now, not in the moment)

- **PPC**: if after $6k cumulative spend CPL >$450 or zero contracts by $10k —
  pause, fix landing/tracking/speed-to-lead, don't "give it one more month."
  Scale +25%/mo only while cost-per-contract <$6k.
- **Callers**: QA-passed lead cost >$150/lead for 4 consecutive weeks → swap
  callers or vendor. Any compliance auto-fail twice by the same caller →
  off the account, logged.
- **A market**: 90 days open with <2 contracts and no dispo-bench growth →
  freeze it, recycle budget into the best-performing county. Counties are an
  allocation decision, not an identity.
- **Number reputation**: any DID spam-flagged → retire immediately; >30% of
  pool flagged → stop dialing, rebuild pool, slow the pace.
- **Legal drift**: NJ wholesaling statute risk is live (PLAYBOOK watch-list:
  CT/OK/MD/TN/OR/IL precedents); Act 52 shows how fast this moves. Quarterly
  counsel check-in per open state; FL text/call litigation is a plaintiff-bar
  industry — the FTSA config is never relaxed.
- **Concentration**: no single channel >60% of contracts by month 6; no
  single buyer taking >40% of assignments (bench decay risk).

## 10. Why this wins (the honest version)

The edge is not the lists — everyone can buy LandInsights data. It's the
compounding assets: (1) dual-track licensed offer (buy OR list) that closes
sellers competitors lose; (2) a follow-up machine that's still calling in month
4 when every other buyer quit; (3) a verified buyer bench built from recorded
deeds, not Facebook; (4) clean compliance while the plaintiff bar feeds on
sloppy operators; (5) land+houses on one system, so slow seasons in one product
line don't idle the team. Protect those five and the deal flow follows.
