# Compliance file

Append-only. This directory is the defense file if outreach is ever challenged.

Governing documents (committed):
- DNC_PROCEDURES.md         the written do-not-call / outbound calling policy
                            (available on request; v1.0, 2026-10-06)
- CALLER_TRAINING.md        training curriculum, role-plays, quiz, sign-off rules
- CALLER_ACKNOWLEDGEMENT.html  one-page form each caller signs before calling

Logs (local only, never in git — created by
`python scripts/10_acq_release.py compliance-init`):
- training_log.csv    one row per training: caller, WAVV id, version, quiz,
                      supervised calls, signed form, next refresher
- incidents.csv       every violation flag, complaint or demand letter + action
- signed/             signed acknowledgement PDFs
- incidents/          recordings/transcripts preserved for incidents

- dial_log.csv        every outbound dial: ts, ref_id, number, disposition,
                      scrub_batch_date, agent
- scrub_log.csv       every DNC/litigator scrub batch: date, source, n_records,
                      n_suppressed, file_hash
- mail_returns.csv    returned mail pieces: date, ref_id, USPS reason code
- optouts.csv         any opt-out received outside a call (date, phone, name,
                      channel, words, received by, GHL suppressed at) — honored
                      immediately, never re-contacted
- skiptrace_raw/      unmodified vendor return files

Acquisition machine (WAVV dialing, 2026-10-01): the call log lives in Postgres
(acq_calls) — export it weekly from /admin/calls ("Dial log CSV",
/api/admin/acq/export?kind=calls) into this folder as dial_log_YYYY-MM-DD.csv.
Internal DNC = acq_suppression (append-only); export with kind=dnc to
data/processed/acq/internal_dnc.csv before every 09 build. `10 scrub-apply`
appends scrub_log.csv automatically.

Retention: 7 years minimum. Never edit rows; corrections are new rows.
Hard rules: no AI voice / ringless VM / bulk SMS / prerecorded voicemail drops
on any cold list (no consent artifacts). Human callers only; WAVV power lane at
1 line until counsel signs off (FL/OK/MD always manual, single line); policy
window Mon-Sat 9am-8pm recipient local time (federal limit 8am-9pm); scrub <=31
days old at time of dial.
