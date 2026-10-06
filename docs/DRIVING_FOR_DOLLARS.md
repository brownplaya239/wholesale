# HouseSoldNJ driving-for-dollars workspace

Route: `/admin/driving-for-dollars`, behind the existing admin session. An
individual lead report links into this workspace and lets you add its property.
Imported lists use separate tables from inbound seller inquiries: importing a
vendor CSV does not create consent, trigger lead delivery, enqueue enrichment,
contact sellers, or send addresses to an AI service.

## Existing project setup

Use the current HouseSoldNJ Vercel project and Google Cloud project. Do not
create another repository, database or billing account for this feature.

* Existing `DATABASE_URL` (Neon/Postgres) and `ADMIN_PASSWORD` power persistence
  and login. Schema v5 adds `inspection_properties` and append-only
  `inspection_review_events`; existing lead data is retained.
* The browser map uses `NEXT_PUBLIC_GOOGLE_MAPS_KEY` if set, otherwise the
  existing `NEXT_PUBLIC_GOOGLE_PLACES_KEY`. Enable **Maps JavaScript API** for
  that key and allow the site's exact hostnames in HTTP-referrer restrictions:
  `https://housesoldnj.vercel.app/*`, your production custom domain(s), and
  `http://localhost:8765/*` for this development preview. Add any preview
  hostname explicitly when testing a Vercel preview.
* This viewer uses Google's Data layer for property points, so no new Map ID
  is required. Satellite/road basemaps and Street View are loaded through
  Maps JavaScript. Only the selected property's nearby panorama is requested;
  property imports do not fetch imagery.
* Optional `GOOGLE_MAPS_SERVER_KEY` supplies Street View Static / Maps Static
  to the existing report-image pipeline, independently of the browser key.
  This is server-only. Use server-appropriate restrictions; a laptop's fixed
  IP restriction is not appropriate for Vercel's changing server egress.
  See Google's security guidance for the deployment's supported protection.
* `D4D_GOOGLE_DERIVED_CONTENT_ALLOWED=false` is the default. Google imagery is
  displayed live, without bulk image storage or AI calls. Saved condition
  scores can use field inspection, owner-provided photos or appropriately
  licensed imagery. Set this variable to `true` only if the project's imagery
  agreement permits saving Google-derived scores. This switch does not grant
  rights and does not alter the preexisting report AI workflow.

References: [API setup](https://developers.google.com/maps/documentation/javascript/get-api-key),
[key security](https://developers.google.com/maps/api-security-best-practices),
[Street View](https://developers.google.com/maps/documentation/javascript/streetview),
[Maps terms §3.2.3](https://cloud.google.com/maps-platform/terms).

## Import and inspect

1. Sign in, open **Driving for dollars**, and click **Import list**.
2. Upload a CSV with `Address` and `City` headers (the original NJ CSV works),
   or assessment JSON `{ "rows": [...] }`. CSV names/phones are ignored.
   The prepared `NJ_Inspection_Import.json` contains every original Lead ID,
   known NJGIS centroid and public-record screening facts. It stays outside Git.
3. Review the import counts and confirm. Addresses normalize suffixes and
   punctuation, retaining town and unit distinctions. Duplicate source IDs
   group under a property; reimports preserve reviews and source IDs.
4. Filter the queue by list, notices, flood-zone flags, deed-age proxies,
   unresolved location or unreviewed status. Raw CSVs need on-demand address
   location; a geocoder result stays a candidate until confirmed. Unknown
   locations are not plotted. Coordinates without a corroborated parcel
   identifier do not produce a guessed outline.
5. Select a property. Street View searches within 50 m and points toward the
   property's location. Check the house number, frontage, parcel and condo
   unit. A nearest panorama may show the wrong building. NJGIS outlines are
   fetched by the imported parcel identifier, not traced from Google imagery.
6. Record review visibility, identity, imagery/inspection date, source,
   severity, observations and reviewer. Unknown is distinct from an inspected
   zero. Obscured roofs/windows remain unknown. Vacant appearance does not
   establish legal vacancy. Satellite acquisition date is not supplied.
7. Complete current foreclosure, tax/redemption and code checks with source
   references. Historical tax notices, annual deed fields and mailing
   addresses alone do not establish current title, debts or distress.
8. Save and move to the next property. Concurrent changes return a conflict
   instead of overwriting another review. Export produces one CSV row per
   original Lead ID, including duplicate IDs, to join back to the assessment.

## Scoring

Physical condition: roof 15, landscaping 8, windows 12, exterior 15, vacant
appearance 10 (60 total). Each is severity 0–3, scaled to its weight. Both
physical reviews, identity, date/reference and all five observations are
required. Public records: foreclosure 20, unpaid tax/municipal lien 10,
unresolved code 10 (40 total); a completed current review, all inputs and a
reference are required. Full score is unavailable unless both are complete.
Grades: A ≥70, B ≥45, C ≥20, D below 20, U incomplete.

Prospecting proxy remains separate: deed age ≥10 years =15 or ≥5 years =8,
different mailing address =10, out-of-state mailing =5. A newer-sale conflict
suppresses deed-age points. Deed age is not confirmed continuous ownership.
Completed priority =70% of distress plus up to 30 prospecting points.

## Validation

`cd site; npm run test:unit` covers import validation, quoted CSVs, PII
exclusion, towns/units, unknown versus zero, scoring bounds, permissions,
CSRF, atomic dedupe, reimports, review audit and optimistic concurrency using
local PGlite. `npm run build` must pass. Use a local database for testing:
never point development or test imports at production without intending it.
