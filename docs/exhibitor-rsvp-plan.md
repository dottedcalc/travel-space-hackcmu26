# Sequential exhibitor RSVP implementation plan

Status: implemented. The notes below preserve the original design plan. See README.md for current behavior and model limitations. The existing simulator acquired service-rate and facility behavior independently during implementation; the RSVP layer passes those supported inputs through and reports completed service counts explicitly.

## Outcome and workflow

Add a reservation layer that calls the existing crowd simulator as a black-box evaluator. Organizer-defined exhibitor order determines whose turn it is. Each exhibitor chooses their booth size, compares up to five simulated placements against the latest confirmed layout, and chooses which booth to reserve. Every confirmation changes the input for the next exhibitor.

Organizer prepares map and order → current exhibitor reviews profile → chooses size → system filters seats → shortlists five → simulates each → exhibitor compares and selects → atomic confirmation → next exhibitor → final layout simulation.

## Current application and integration points

- `components/event-workspace.tsx` currently lets a selected company claim an open booth directly. That action supplies the same popularity value, 2, for every new reservation.
- `lib/event.ts` stores companies as name/category pairs. Booth items contain geometry, company, category, popularity, and dwell time. There are no historical profiles, prices, size catalog, reservation order, or scenario records.
- `lib/simulation.ts` exposes `simulate(FairEvent)`. Results include representative agents and weights, paths, intended routes, per-booth queue records, heat, density, completed/missed visits, and layout findings. Only occupied booths and food stations attract visitors; vacant booths still occupy physical floor space.
- `lib/simulation-worker.ts` already runs simulation off the main browser thread. Reuse its execution pattern through a separate RSVP worker.
- The claims endpoint and `db/event-store.ts` already use workspace revisions to reject competing writes. Extend this mechanism to reserve a booth, store its RSVP record, and advance the turn together.
- Existing local application edits must be preserved during implementation.

## 1. Establish persistent inputs and turn state

Introduce types in `lib/rsvp-types.ts` and extend event validation and persistence:

- `ExhibitorProfile`: stable company ID, category, historical visitor count and observation period, peak arrival rate, dwell time, audience interests, staff, equipment/interaction/storage areas, declared service capacity, popularity, preferred/minimum size, budget, and location/neighbor preferences. Record whether values are supplied, estimated, or missing.
- `BoothSizeOption`: Small, Medium, Large, or Custom with actual width/depth, organizer-defined capacity range, and compatible seat footprints. Size names alone never determine physical fit.
- `SeatReservationPolicy`: seat ID, allowed sizes, price when configured, facilities, protected circulation areas, fixed frontage, and organizer restrictions.
- `ReservationState`: ordered company IDs, current turn, and pending/confirmed/skipped statuses. Default new registrations to registration order; allow organizer ordering before or between turns. Reordering invalidates outstanding recommendations.
- `RSVPRecord`: request ID, company ID, order, profile snapshot, selected size/seat, source revision, candidate summaries and metrics, scoring version/weights, acknowledged advisory warnings, and server timestamp.

For the prototype, keep these small records in the existing event JSON and commit them through its single revision-checked update. Do not store full simulation trajectories in that JSON. Update every reader/writer, including organizer saves and company rename, so new fields survive round trips. Protect reservation state from being overwritten through generic layout updates.

Backfill stable IDs for existing registered companies and reconcile occupied booths with those IDs without changing their placements. Treat existing reservations as confirmed legacy allocations; allow one new reservation per exhibitor turn. A release marks its record released, invalidates recommendations, and requires organizer requeueing for another turn.

## 2. Recommend size, then let the exhibitor choose

Add a profile-and-size step to the exhibitor page. Show estimated peak occupancy, recommended dimensions/capacity, the assumptions used, and editable historical inputs.

As a starting estimate, multiply peak visitor arrival rate by average interaction time using matching units. Estimate required area from visitor interaction space plus non-overlapping staff, equipment, and storage allowances. Map that area to organizer-defined size options. When data are incomplete, use clearly labeled organizer defaults and lower confidence rather than manufacturing historical figures.

Map attraction to the simulator's existing popularity range (1–3) and dwell range (10–180 seconds) through a documented adapter. Keep original values in the profile and disclose clipping. Staffing and declared service capacity inform size guidance but cannot become multiple service counters in the unchanged simulator.

An undersized recommendation is an advisory warning that the exhibitor can acknowledge. Physical minimums, restricted areas, budget limits, and organizer hard constraints remain enforced. Do not invent a queue-overflow percentage before a supported estimate exists.

## 3. Filter and shortlist feasible seats

Implement pure functions in `lib/rsvp.ts`:

1. Select unoccupied organizer-provided seats compatible with the chosen dimensions. Use a deterministic footprint inside the seat's permitted envelope; preserve other seats and facilities. Do not automatically merge seats.
2. Validate room containment, overlap, entrance/exit access, access to the booth's front queue, declared protected circulation areas, required facilities, budget when provided, and organizer restrictions.
3. Run or retrieve one current-layout baseline for preliminary traffic estimates and venue-impact comparisons. Key it to the complete relevant input version. This is one baseline per turn, followed by at most five candidate simulations.
4. Normalize size fit, estimated visibility, baseline traffic near the frontage, walkable entrance proximity, category/neighbor preference, and configured cost. Use documented weights and deterministic seat-ID tie breaking. Missing optional terms are excluded and remaining weights renormalized.
5. Keep the best five feasible seats. Show fewer when fewer exist. If none remain, explain the specific limiting constraints and offer a size change or organizer assistance without advancing the turn.

The existing engine always queues at a booth's bottom/front edge. Store orientation requirements, but only offer compatible frontage in this implementation. Arbitrary queue orientation requires a separately scoped simulator change. Existing layout/path checks plus organizer-defined exclusions are planning constraints; they do not establish emergency-egress certification.

## 4. Evaluate counterfactuals without changing crowd behavior

Add `lib/rsvp-simulation.ts` as the adapter and `lib/rsvp-worker.ts` as its worker entry point. Each scenario clones the same confirmed snapshot and adds the current company's attraction only at the candidate seat. Previews never mutate saved reservations.

Fair comparison needs more than the existing fixed seed: `createRoute` also depends on active-item order. The adapter must give the current company the same simulation identity and active-list position in every candidate, preserve stable identities/order for confirmed exhibitors, and map simulation IDs back to seat IDs. Retain all vacant seat footprints. Verify that candidate scenarios produce identical intended company itineraries, arrival times, and visitor profiles before geometry affects movement.

Run scenarios serially in a worker to bound CPU and memory; report progress such as “Comparing booth 3 of 5.” Keep compact summaries for all candidates and full playback for the selected scenario, recomputing deterministically if needed. Cancel work when size, company profile, layout, attendance, order, or turn changes. Tag requests with input fingerprints so late results cannot replace current recommendations.

Build `lib/rsvp-metrics.ts` to extract weighted company-level results from queue records and intended routes. Distinguish intended visits, completed interactions, pass-by exposure, and missed intended visits; do not present the event-wide visit count as the current company's visitors. Match the existing completed-visit convention and include waits still ongoing at closing with clear units and denominator definitions.

Report company score and venue score separately on a 0–100 scale, then rank with `0.7 × companyScore + 0.3 × venueScore`. Normalize against documented event-wide reference ranges fixed across all candidates, not each candidate's own values. Persist the weights and reference version. Hard invalidity cannot be canceled out by a high company score.

Company metrics: completed interactions, estimated nearby exposure, average admitted queue wait, missed intended-visit rate, and explicitly labeled preference fit. Venue metrics: peak local density, traffic balance over walkable cells, low-traffic-area coverage, route accessibility, and neighboring booth visit/wait changes relative to baseline. Use density values consistently; the engine's `peak` is a visitor count within a fixed patch, not a density value.

The engine does not model visitor category interests, true visibility, arbitrary service capacity, or evacuation. Show target-audience visits as unavailable unless supplied by a separately defined supported data source. Label geometric exposure and category adjacency as estimates. Omit unavailable terms from scores and disclose which terms were used. Baseline-to-candidate changes include changed visitor itineraries when a company is added; describe them as scenario differences, not precise causal measurements.

## 5. Build the reservation comparison experience

Extract `components/exhibitor-reservation.tsx` from the existing workspace surface and add `components/rsvp-scenario-comparison.tsx`. Reuse `FloorMap`, heat rendering, and playback controls.

- Show RSVP position and whose turn it is. Other exhibitors can prepare their profile and size while waiting; confirmation is limited to the active turn.
- Present up to five ranked scenario cards plus a comparison table with seat, company score, venue score, estimated completed visits, average queue wait, and congestion.
- Open each scenario in its own detail view/tab with the candidate company highlighted, trajectories, heatmap, queue playback, nearby congestion, benefits, and risks derived from actual metrics.
- Explain recommendation tradeoffs in plain language. Label scenarios “Highest estimated visits,” “Shortest queue,” or “Best venue balance” only when their results support that label.
- Require explicit exhibitor selection and confirmation. A recommendation never reserves automatically.
- Provide loading, partial failure/retry, no-feasible-seat, stale-result, waiting-turn, and already-confirmed states. A failed simulation never receives invented metrics or a recommendation score.

## 6. Confirm, advance, and finalize

Extend the claims request with stable company ID, turn ID, selected size, scenario seat, source revision, input fingerprint, and an idempotency key. On the server, independently recheck the latest turn, seat availability, profile/size compatibility, budget, and hard constraints. Do not trust client-computed scores to establish eligibility; preserve their provenance as preview estimates.

In one revision-checked event update: assign company/profile parameters and selected dimensions to the booth, append the compact RSVP record, mark the turn confirmed, advance to the next pending exhibitor, and increment the revision. A repeat request with the same idempotency key returns its existing reservation instead of advancing twice. A competing or stale request receives a conflict and refreshed state; the exhibitor must review newly calculated options before confirming again.

Invalidate recommendations after confirmations, releases, profile changes, attendance changes, organizer layout edits, and order changes. Existing four-second workspace polling can distribute updated state. When no pending exhibitors remain, run the final layout through the same adapter and expose final results to the organizer. Persist final-run status and compact metrics tied to its input revision so reloads can resume failed or incomplete evaluation without reopening reservations.

The current role picker does not authenticate a company. Turn validation supports the prototype workflow, but real exhibitor access requires server-side identity and organizer/company membership checks before rollout.

## Delivery order and acceptance checks

Implement in six increments: data/contracts and compatibility → profile/size UI → feasibility and shortlisting → simulation adapter/metrics → comparison UI → atomic confirmation and final evaluation.

Add focused tests for:

- Five candidates, fewer than five, no candidates, invalid dimensions, budget, protected areas, and inaccessible queue frontage.
- Profile-derived popularity/dwell, honest missing-data handling, and size-advice overrides versus hard constraints.
- Deterministic candidate visitor inputs despite different seat IDs/list positions; previews leaving the saved layout untouched.
- Correct representative-agent weighting, completed/missed visit definitions, queue units, score normalization, and exclusion of unavailable metrics.
- First reservation invalidating the next exhibitor's previous recommendations and removing the occupied seat from eligibility.
- Wrong-turn attempts, stale revisions, simultaneous confirmations, duplicate request retries, releases/requeueing, and cross-workspace isolation.
- Persistence across organizer saves, company renames, reloads, and legacy-event loading.
- Final simulation completion and retry, canceled worker results, and scenario failure states.

Run the existing crowd simulation regression tests unchanged, the relevant new unit/integration tests, TypeScript checks, lint, and production build. Visually verify the complete exhibitor journey on desktop and mobile. The end-to-end demonstration must show two exhibitors receiving recommendations sequentially from different confirmed-layout revisions.
