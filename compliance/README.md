# Compliance file

Append-only. This directory is the defense file if outreach is ever challenged.

- dial_log.csv        every outbound dial: ts, ref_id, number, disposition,
                      scrub_batch_date, agent
- scrub_log.csv       every DNC/litigator scrub batch: date, source, n_records,
                      n_suppressed, file_hash
- mail_returns.csv    returned mail pieces: date, ref_id, USPS reason code
- optouts.csv         any opt-out, honored immediately, never re-contacted
- skiptrace_raw/      unmodified vendor return files

Retention: 7 years minimum. Never edit rows; corrections are new rows.
Hard rules: no AI voice / ringless VM / bulk SMS on this list (no consent
artifacts). Manual human dials only, 8am-9pm recipient local time, scrub <=31
days old at time of dial.
