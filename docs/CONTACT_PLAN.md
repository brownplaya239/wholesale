# Contact & conversion plan — first cycle

> REVISED 2026-08-11: Sum is a licensed NJ agent. See "Licensed-agent
> addendum" at the bottom — it changes the scripts, the letter, adds an MLS
> suppression step, and adds the listing conversion track. Where the
> addendum conflicts with the base plan below, the addendum wins.

Working the outputs: hot_list.csv (132), doorknock_routes.csv (94 stops),
call_first.csv (38, 6 out-of-state), mail_touch1_all.csv (654),
skiptrace_upload.csv (445 owners). Benchmarks to expect: 1–3% overall
response, ~15–30 real conversations this cycle, 20–30 conversations per
signed contract. The game is speed-to-contact and follow-up, not volume.

## Week 0 — unlocks (2 evenings of work)

1. OPRA emails ×5 (docs/OPRA_REQUEST.md) — starts the 7-day clock on owner
   names. MOD-IV is the must-have; SR1A optional (no buyer list needed).
2. Hand-addressed First-Class letters to the freshest estate transfers
   (deed < 12 months: S Bay Ave Highlands, Pennbrook Far Hills, Quaker Ln
   Colonia, 5th St Union City, Church St Belford). Real stamp, blue ink,
   letter template from the playbook. These 5 outrank the other 649 pieces.
3. Skip-trace: two quotes on 445 uniques, order same day (~$31–67). Demand
   phone_type + last_seen_date. Raw return -> compliance/skiptrace_raw/.
4. Vacancy: Smarty bulk on vacancy_check_upload.csv (391 recs, ~$12) ->
   save data/processed/vacancy_flags.csv (ref_id,vacant) -> rerun script 05
   so S3 populates and re-segments.
5. Compliance rails: FTC DNC portal registration (first 5 area codes free)
   + litigator scrub account (~$75). Log both in compliance/scrub_log.csv.
6. Phone setup: one dedicated number (Google Voice/OpenPhone) on every
   letter; voicemail: "You've reached [name], I buy houses in [county] —
   leave the property address and I'll call back today." Missed inbound is
   the most expensive failure in this whole system: answer live 8am–8pm.
7. Tracking: one spreadsheet (or the CSVs + a status column). Columns:
   ref_id, channel, last_touch, disposition, next_action_date. A lead
   without a next_action_date is a dead lead.

## Week 1 — contact wave

8. Bulk mail touch 1: upload mail_touch1_all.csv (Click2Mail/Lob),
   First-Class, windowed, "Return Service Requested", NCOA on (~$490–620).
9. Knock routes (any order, 2–3 hrs each):
   - Route 1 Sat AM: Rt-36 coastal — Monmouth Beach → Sea Bright →
     Highlands → Belford → Keansburg → Long Branch (~14 stops)
   - Route 2: Union City ×12 — park once, walk. Bring Spanish letters.
   - Route 3: Watchung/Warren/Bernardsville/Far Hills loop (~11)
   Door script: "Hi, I'm [name] — I buy and fix up houses around [town],
   and I was reaching out about [address]." If they're not the owner
   ("that was my mother's") THAT is the lead — slow down, be human.
   No answer: letter through the door, handwritten "sorry I missed you",
   log the stop. Vacant: photos (condition = underwriting input), note on
   door, flag for the municipal abandoned-list OPRA.
10. Log every knock and every returned mail piece (mail_returns.csv).

## Week 2 — dial wave (only after scrubs)

11. Scrub traced numbers (federal+NJ DNC ≤31 days old + litigator), log
    batch, then dial: call_first out-of-state 6 → rest of call_first →
    no-answer knock doors → S2 remainder. Manual dial, human, 8am–9pm
    their local time, ~5 days behind the mail drop.
    Opener: "I sent you a letter last week about [address] — I'm a local
    buyer, not an agent. Is that property something you'd consider selling?"
    Log every dial (dial_log.csv). Two attempts + VM, then 3-day spacing.
12. Qualify on every contact (4 things, in their words): condition,
    occupancy (who's living there / is it empty), timeline & why now,
    price expectation. Motivated + flexible timeline + realistic-ish price
    = book the appointment ON THAT CALL.

## Weeks 3–4 — follow-up machine

13. Touch 2 mail (~3–4 wks after touch 1, gated on response), second knock
    pass on any warm door, returned-mail vacancy flags feed the knock list.
14. OPRA files arrive: 02 all --modiv-dir DIR (+ --sr1a-dir if requested)
    → rerun 04/05/06. Owner names upgrade ~4,600 records; re-trace only
    names that changed; refresh S2. Mail touch 2 goes out personalized.
15. Every "no" gets a next_action_date 30–60 days out. Estate sellers say
    no twice before yes; the money is in touch 4+, where competitors quit.

## Conversion rail (someone says "maybe")

- Same-day: comp it yourself (arm's-length, ≤90d, ≤0.5mi, same
  municipality; assessed×equalization ratio as cross-check). MAO per
  playbook: ARV_p25 × (1 − 15-20%) − rehab_high − holding − closing.
  Three prices: reservation (MAO, never spoken), opening (8–15% under),
  their anchor. Anchor >35% over MAO = polite exit + 60-day follow-up.
- Walk the property before any number leaves your mouth if at all
  possible; unwalked interiors carry the top of the rehab range.
- Offer in writing within 24h of the appointment, even (especially) when
  it's low — paper anchors.
- Attorney PSA with inspection window before signature (the $500–1,500
  becomes urgent the day of the first real appointment — book the attorney
  NOW so they're ready). Buying as principal; if double-closing, line up
  transactional funding ($1.5–3k) when the deal is real.
- Estate specifics: confirm who has authority (executor/administrator —
  ask "has the estate been through surrogate's court?"). Multiple heirs =
  all sign. Attorney handles the letters-testamentary check.

## Weekly scorecard (10 min, honest)

letters_sent, returns, knocks, door_contacts, dials, phone_contacts,
appointments, offers_written, contracts_or_listings. If contacts ≥15 and
appointments = 0, the problem is script/offer, not the list — revisit
before spending on touch 2.

## Licensed-agent addendum (controls over the base plan)

**0. Before anything ships — broker + MLS**
- If licensed as a salesperson: confirm with the broker of record that
  (a) this solicitation campaign runs under the firm's identity per office
  policy and NJ advertising rules, and (b) the affiliation agreement
  permits buying as principal (some offices require running it through the
  office / broker sign-off). If broker of record: your call, same rules.
- Export active + under-contract listings for the 5 counties from MLS ->
  data/processed/suppress_active_listings.csv (address + city columns) ->
  re-run 05 and 06. NJ REC prohibits soliciting another broker's active
  listing; this is the automated guardrail. Refresh the export before
  every mail drop and knock day.

**1. Disclosure — every first contact, no exceptions**
- Letters: signature block shows name, "NJ Licensed Real Estate
  Salesperson" (or Broker-Salesperson), brokerage name, phone. No "I'm not
  an agent" anywhere — that language is retired.
- Door/phone: license comes up in the first breath, and honestly:
  "I'm [name], a licensed agent with [brokerage] — but I'm not here
  fishing for a listing; I also buy houses myself."
- Any principal purchase: written disclosure IN THE OFFER AND CONTRACT
  that the buyer is a NJ real estate licensee (buying for own account /
  via [LLC] of which the licensee is a member). Attorney bakes this in.
- When buying as principal, add the fairness file: written note advising
  the seller they may seek their own appraisal/representation + keep the
  comp file you based the price on. That's the REC-audit defense if a
  below-market estate purchase is ever questioned.

**2. The letter, revised (dual-track)**

> Dear [Name],
>
> My name is [Name] — I'm a licensed real estate agent with [Brokerage],
> and I'm writing about the property at [Address].
>
> I work with owners in whichever way serves them better. If a fast,
> as-is sale matters most, I buy properties myself, for cash, on your
> timeline — no repairs, no showings. If top price matters more than
> speed, I can tell you honestly what it would bring on the open market
> and handle the sale properly.
>
> Either way, the first conversation is free and carries no obligation.
> Call or text me directly at [phone] — I answer personally.
>
> [Name]
> NJ Licensed Real Estate Salesperson, [Brokerage]
> [Phone] · [Email]

**3. Dual-track qualification (replaces the buy-only rail)**
Same 4 questions (condition, occupancy, timeline, price expectation),
now routed two ways:
- Deep discount + speed/certainty need + condition issues -> PRINCIPAL
  BUY: cash offer per the MAO rail, licensee disclosure in writing.
- Price-focused, no urgency, retail-able condition -> LISTING: CMA
  appointment, standard listing agreement. A Monmouth listing at 2.5%
  often out-earns a thin flip — take the listing without ego.
- Genuinely torn -> present BOTH numbers side by side ("I'll buy it for
  $X cash this month, or list it at $Y and you likely net $Z after
  commission and time — here's the tradeoff"). This two-option close is
  the strongest frame in the stack AND the most defensible, because the
  seller sees the market number next to your cash number.
- Never do: quote a cash price while withholding your view of market
  value. As a licensee, lowballing an estate without the market context
  in writing is how REC complaints get written.

**4. Economics update**
Funnel value roughly doubles: expect more listings than buys from this
list (most heirs want market price). 15–30 conversations -> realistic
first-cycle outcome is 1 purchase AND 2–4 listings. The scorecard counts
both as conversions.
