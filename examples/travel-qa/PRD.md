# Travel-QA — PRD

I want to build a skill that solves **complex API-constraint problems**
on top of the TomTom Maps platform. Each task is one natural-language
question with explicit filters, an optimisation objective, and a
deterministic tie-break rule. The skill writes a single-line
plain-text answer to `answer.txt` that can be checked by **Exact
Match** against a normalised gold value.

This is **not** a travel-recommendation task. There is no "best"
restaurant or "nice" route — the gold answer is fully determined by
the question's constraints, the live TomTom API snapshot, and the
deterministic tie-break. Two correct skills running on the same API
snapshot must produce byte-identical answers.

## 1. Goal

Each item is a small algorithmic pipeline the solver designs and
executes. The kinds of work it has to compose:

- look up points of interest within a radius / bounding box /
  category set,
- resolve free-text addresses to coordinates (and the reverse),
- compute travel time between two points under a chosen mode
  (driving, walking, cycling),
- compute pairwise travel times for a small set of points (a
  matrix) and run an optimisation on top,
- filter / sort / tie-break the candidate set client-side.

The skill is responsible for picking the right APIs and the right
calls to satisfy each item. **This PRD does NOT teach the API
surface** — discovering, calling, caching, and recovering from
the answer-source's API is part of the skill's job, and is exactly
what SkillHone's optimisation loop learns and writes into
`SKILL.md` over time. The eval contract (§3) names the canonical
answer source and the gold-construction pipeline; the public
improver / solver side only sees the task definition (§1 and §2).

The solver works in an isolated working directory. Internet access
is allowed. The answer is a single text line, normalised exactly
as the question demands.

## 2. Output

One file: `answer.txt` at the working-directory root. **Single
line, exact-match-verifiable**, normalised to one of these three
shapes — and ONLY one of these three — per the question's
`answer_type`:

1. **`place_id`** — a single opaque POI identifier emitted by the
   answer-source database. Echo it byte-for-byte (these are short
   base64-ish tokens, e.g. `CdH2XK-n--jrKQNwV6qHHA`).
2. **`integer`** — a plain decimal integer with no thousands
   separators, no unit, no sign. Example: `42`.
3. **`duration_seconds`** — an integer number of seconds, with no
   unit suffix. Example: `1166` (not `19m26s`, not `1166s`).

Every answer is either a short string (`place_id`) or a number
(`integer` / `duration_seconds`). No list / array / pipe-separated
multi-value shapes — they are brittle under exact-match
verification and shape-2-style TSP questions return the optimum's
total `duration_seconds` instead of an ordered id list.

Hard rejects (the verifier will fail any of these):

- Multiple lines.
- Markdown, JSON, HTML, code fences, or quoting.
- Free-text reasoning ("the answer is X", "I think…", any
  prose).
- A POI's human-readable name when an `id` is required (and
  vice-versa).
- A "best", "recommended", or "nicest" answer phrasing.
- Numeric thousands separators (`12,345`).
- Unit suffix on a `duration_seconds` answer (`1166s`, `19m`).
- Trailing or leading whitespace inside the value (a single
  trailing newline is OK).
- Placeholders (`unknown`, `TBD`, `cannot determine`, including
  CJK equivalents).

## 3. Evaluation

> Everything below is eval-visible only. The improver, the solver,
> and any file copied into the public skill repo MUST NOT see this
> section. SkillHone's `new.py` strips it before staging the skill
> repo.

### 3.0 Answer-source API contract (synth-only)

**The gold answers for this benchmark are computed against the
TomTom Maps API at `https://api.tomtom.com/`** — the canonical
public source for POI search, geocoding, and routing the eval
pipeline targets. Synth MUST use this API when computing reference
pipelines and gold values; eval verifies against the same
snapshot.

This subsection is **deliberately kept out of §1 / §2** — the
improver-visible README of the public skill repo (auto-redacted
from this PRD by `scripts/new.py`) does NOT name the API or
document its surface. Discovering and learning the API is the
skill's job, and is exactly what SkillHone's optimisation loop
encodes into `SKILL.md` (and helper scripts under `scripts/`)
across iterations. The seed skill must NOT know this when synth
scores it during the regression gate, otherwise the seed → optim
gap collapses and the loop has nothing to demonstrate.

API key is read from the `TOMTOM_API_KEY` environment variable
(set on the synth + eval host's shell). Synth and per-probe
solver agents both inherit it via the harness `passthrough_env`
list. Passed on every request as the `&key=…` query parameter.
Do NOT hard-code the key in committed source.

Endpoint cheat-sheet (synth uses these; the synth-side reference
pipeline is recorded in `snapshots/probe_<uid>/reference_pipeline.json`):

| Operation | Endpoint shape | Key fields |
|---|---|---|
| POI search (deterministic, sorted by `dist`) | `GET search/2/nearbySearch/.json?lat=&lon=&radius=&categorySet=&limit=&key=` | `results[].id`, `results[].position`, `results[].poi.name`, `results[].dist` |
| Geocode | `GET search/2/geocode/{query}.json?key=` | `results[].position.{lat,lon}`, `results[].id` |
| Reverse geocode | `GET search/2/reverseGeocode/{lat},{lon}.json?key=` | `addresses[].address` |
| Place by ID | `GET search/2/place.json?entityId={id}&key=` | `results[].poi`, `results[].position` |
| Route (single) | `GET routing/1/calculateRoute/{lat0,lon0:lat1,lon1}/json?travelMode=car&key=` | `routes[0].summary.travelTimeInSeconds`, `lengthInMeters` |
| Route (waypoints) | `GET routing/1/calculateRoute/{p0:p1:...:pN}/json?...&computeBestOrder=true` | + `optimizedWaypoints` |
| Matrix routing (sync) | `POST routing/matrix/2/?key=` body: `{origins, destinations, options}` | `data[i][j].routeSummary.travelTimeInSeconds` |

Reference pipelines MUST use `nearbySearch/.json` (no path
component, all filters in query string) for POI lookup. The
free-text-path endpoints `poiSearch/{query}.json` and
`categorySearch/{query}.json` EXIST in the platform but are
**forbidden** for reference pipelines because the `{query}` text
changes result ranking — see §3.1.B's deterministic-input
invariant.

Conventions synth must follow when constructing reference
pipelines:

- Coordinates are **`lat,lon`** in TomTom routing endpoints.
- Times are integer `travelTimeInSeconds`; lengths are
  `lengthInMeters`.
- The `id` field on a POI is an opaque base64-ish token (e.g.
  `CdH2XK-n--jrKQNwV6qHHA`). The verifier treats this as the
  canonical place identifier — DO NOT use the human-readable
  `poi.name` as a substitute when the question asks for an `id`.

### 3.1 Synthesis target

The benchmark only earns its keep when items push the solver past
single-call API lookups. Every accepted item must satisfy the hard
floor in §3.1.A AND fit one of the question shapes in §3.1.B.

**Guiding principle — convergent, not generative.** Travel-QA is
deliberately *not* a recommendation task. Every question must
specify (a) a filter set, (b) an optimisation objective, and (c) a
tie-break rule precise enough that under the same TomTom API
snapshot only ONE candidate satisfies all three. The complexity
must live in the *pipeline the solver runs* (multi-step API +
client-side filter / sort / optimisation), not in the answer's
expression — answers are place_ids, ints, or pipe-separated id
lists, never sentences.

#### 3.1.A Hard floor (every item must clear all five)

1. **Pipeline depth ≥ 3 distinct API operations.** Counted as:
   (geocode start) + (POI / category search) + (route or matrix
   routing) + (place-by-ID lookup) is four; that is comfortably
   above the floor. A single chained `?filter=…` call does NOT
   clear this gate.
2. **At least one client-side step the API cannot express.**
   Acceptable steps:
   - filter the candidate set by an attribute the search
     endpoint does NOT expose (e.g. "operating hours include
     Sunday 22:00", "supports DC fast-charge ≥ 150 kW", "menu
     contains 'vegan'");
   - sort by a derived metric (e.g. `(travel_time + dwell_time)`,
     `(distance_meters / popularity_score)`, ratio of two route
     times for two travel modes);
   - solve a small TSP / VRP / insertion problem over a candidate
     set retrieved from the API (the solver must call matrix
     routing then run a client-side optimiser);
   - apply an explicit tie-break that the API does not
     deterministically resolve (lexicographic on `id`, earliest
     `dist`, smallest `lengthInMeters`).
3. **Cross-endpoint join.** Every item must touch ≥ 2 different
   TomTom endpoints (e.g. POI search × routing, geocode × matrix
   routing, etc.). Single-endpoint pipelines are rejected.
4. **Deterministic gold under one snapshot.** Before accepting a
   candidate, the synthesiser MUST run the full reference
   pipeline against the live API and confirm:
   - the candidate set after all filters has size ≥ 1,
   - the optimisation objective produces a strict winner OR the
     tie-break clause uniquely selects one,
   - the gold value is byte-stable when the pipeline is re-run
     within ~1 hour (cache the response JSONs so the eval can
     replay).
5. **Constraint-defined, not preference-defined.** The question
   text MUST contain explicit numeric thresholds, distances, time
   windows, category names, or geographic anchors. Words like
   "best", "good", "popular", "famous", "recommended", "nice",
   "convenient", "well-rated" are BANNED in the question text —
   they introduce subjectivity the verifier cannot adjudicate.
   Use objective surrogates: "highest `popularity` field",
   "smallest `dist` to start", "shortest `travelTimeInSeconds`".

#### 3.1.B Question shape catalogue (use ONE of these per item)

Every item must fit exactly one of the four shapes below. The
synthesiser writes the question text in plain English following the
shape's pattern, computes the gold via the reference pipeline, and
records the pipeline JSON in `reference_pipeline` (eval-only).

##### Conversational-question rule (HARD GATE, every shape)

The `question` field is what the **solver model** sees. It is the
voice of a real traveller asking the skill for help, not a wire
protocol spec. The synthesiser's job is to keep all of the
constraint specificity (§3.1.A) while sounding like a person.

The question text MUST:

- name the place / thing in plain English ("a hotel", "an EV
  charging station", "a coffee shop", "a museum"), NOT by a
  numeric category id;
- describe filters in plain English ("must have a phone number on
  file", "must offer fast-charging at 150 kW or higher", "no chain
  brands like Starbucks");
- describe the objective and tie-break in plain English ("the one
  with the shortest drive from where I am", "if two are equally
  fast, pick the closer one");
- pin **only the values the verifier needs byte-stable**: literal
  start lat/lon to 4 decimal places, integer radius in metres,
  literal endpoint coordinates for detour questions, the explicit
  list of POI ids for TSP questions. These are inputs the human
  knows; they do not give away the algorithm.

The question text MUST NOT:

- name any HTTP endpoint (`nearbySearch`, `poiSearch`,
  `calculateRoute`, `matrix`, `geocode`), API path, or example
  query string — endpoints belong in `reference_pipeline`,
  not in the question;
- name any TomTom response field by its raw JSON key
  (`travelTimeInSeconds`, `lengthInMeters`, `categorySet`, `dist`,
  `openingHours`, `chargingPark.connectors`, `poi.brands`,
  `poi.phone`, `poi.url`) — paraphrase as "drive time in seconds",
  "distance in metres", "the chain brands list", "the phone number
  field", etc.;
- give pipeline-shaped instructions ("call X, then filter by Y,
  then route to Z, then sort by W") — the question describes the
  *goal and constraints*, not the *procedure*.

The reference pipeline (§3.1.B Shape examples, "Reference
pipeline" block) is where the procedural detail lives. It is
eval-only and NEVER copied into the solver's view. The synth
worker's discipline test is: can a non-engineer travel agent read
the question and explain what the traveller wants, without
guessing what an API is? If no, the question failed the gate —
rewrite it.

##### Deterministic-input invariant (HARD GATE, every shape)

Every reference pipeline — and therefore every solver pipeline the
solver is *expected* to run — MUST take only **deterministic
inputs** that the question text or `snapshot` JSON fixes verbatim.
That is, the inputs at every API call site are byte-stable across
re-runs:

- Numeric category IDs (`categorySet=7315`) — never the path-segment
  free-text `{query}` (i.e. `poiSearch/cafe.json`, `poiSearch/coffee
  shop.json`). The solver paraphrases naturally between "coffee
  shop" / "café" / "cafe", and TomTom's `poiSearch/{query}` /
  `categorySearch/{query}` path ranks differently per text →
  different `id` → exact-match rejects. The deterministic
  alternative is `nearbySearch/.json` (no path slot, sorted by
  `dist`); reference pipelines MUST use it.
- Lat/lon coordinates the question literally writes (`40.7580,
  -73.9855`) — geocoding a place name like "Times Square" is
  acceptable ONLY if the question also pins the result to a
  specific lat/lon to two-decimal precision so the solver can
  verify it landed on the right pin.
- POI ids and ROR/ISSN/etc. identifiers when given verbatim in
  the question (Shape 2's TSP candidate list is the model).
- Numeric thresholds (radius 1500, dist ≥ 200, charger ≥ 150 kW).

What is FORBIDDEN as a pipeline input:

- Free-text `{query}` in `poiSearch/{query}.json` or
  `categorySearch/{query}.json` — even when paired with
  `categorySet=`, the path text changes ranking. Use
  `nearbySearch/.json?categorySet=…&lat=…&lon=…&radius=…` instead.
- Geocoding alone where the question's wording could resolve to
  multiple plausible pins ("the Eiffel Tower" vs "the Eiffel Tower
  metro station" → different lat/lon → different POI search results).
- Any "the most popular / well-known X" framing — popularity is
  not byte-stable.

If a shape's natural phrasing tempts a free-text query, rewrite
the question to give the solver the **numeric `categorySet`
directly** and remove the free-text hook entirely.

##### Synth-time near-tie rejection (HARD GATE)

Before accepting any candidate probe, the synthesiser MUST run
its reference pipeline against the live API and check that the
optimisation objective produces a **strict winner**, not a
near-tie. Concretely:

- Shape 1 / Shape 3 (`place_id` answer): the winner's primary
  metric (`travelTimeInSeconds`, total detour, etc.) must beat the
  runner-up by **≥ 5 seconds**. If not, REJECT the probe and pick
  a different city / category / radius combination.
- Shape 2 (`duration_seconds` answer for the optimum TSP total
  time): the runner-up route's total `travelTimeInSeconds` must
  differ from the optimum by **≥ 30 seconds**, AND the optimum
  total time itself must be the integer the verifier compares
  against byte-exact.
- Shape 4 (`integer` / `duration_seconds`): the aggregator output
  is fully determined by the cohort, no near-tie check needed.

Near-tie rejection is non-negotiable — it keeps the verifier as a
clean byte-exact comparison on a single `gold` (§3.3) instead of
needing a list of acceptable answers.

##### Shape 1 — Filtered radius search → unique place_id

The question fixes a literal lat/lon start coordinate, a search
radius in metres, the plain-English place category, ≥ 2 attribute
filters that the search endpoint does NOT expose, an optimisation
objective in plain-English terms, and a tie-break. Gold =
`place_id` of the unique winner. The numeric `categorySet` value
the synthesiser used to compute gold lives in
`reference_pipeline`, NOT in the question text.

> **Question (solver-visible):** "I'm at `40.7580, -73.9855`
> (Times Square, New York). Find me a hotel within 1500 metres.
> I only want hotels that have a phone number on file AND a
> website listed, and skip any that are within 50 metres of my
> position (essentially on top of me). Among the candidates,
> pick the one with the shortest car drive time from my
> position. If two are within 5 seconds of each other on drive
> time, pick the one whose straight-line distance from me is
> smaller. Return that hotel's id."
>
> **Reference pipeline (eval-only, NOT shown to solver):**
> ```
> 1. nearbySearch?categorySet=7314&lat=40.758&lon=-73.9855
>    &radius=1500&limit=100
> 2. Filter response.results[]:
>    poi.phone is non-empty AND poi.url is non-empty AND dist > 50
> 3. For each surviving candidate:
>    calculateRoute?travelMode=car
>    from (40.758, -73.9855) to candidate.position
> 4. Sort ascending by travelTimeInSeconds;
>    tie-break ascending by dist.
> 5. gold = winner.id
> ```

##### Shape 2 — Visit-all TSP → optimum total duration_seconds

The question fixes a literal start coordinate and a candidate set
of N place_ids (5 ≤ N ≤ 8). The traveller wants to visit every
listed POI exactly once, by car, and end back where they started,
with the shortest total drive time. **Return that minimum total
time as an integer number of seconds** (`duration_seconds`). The
visit order itself is NOT returned (lists are brittle under exact
match); only the optimum total is the gold.

> **Question (solver-visible):** "I'm starting from
> `40.7580, -73.9855`. I have to visit all six of these places
> today, by car, and end the day back at my start. The places are
> identified by these ids: `id1`, `id2`, `id3`, `id4`, `id5`,
> `id6`. I want the visit order that minimises my total drive
> time. Tell me the minimum total drive time (in whole seconds)
> for the best order. Return just the number of seconds."
>
> **Reference pipeline (eval-only, NOT shown to solver):**
> ```
> 1. For each id in {id1..id6}: place?id=<id>  →  collect lat/lon
> 2. Build the 7-node point set: [start] ∪ candidates
> 3. matrix routing for the 7×7 driving-time matrix
> 4. Solve TSP (closed loop, start=node 0): brute-force the (N-1)!/2
>    permutations and pick the order minimising total seconds
> 5. gold = sum of travelTimeInSeconds along the optimal closed tour
> ```

##### Shape 3 — Insertion → unique place_id

The traveller is driving from A to B and wants to insert one stop
along the way at some kind of place (an EV charger, a coffee
shop, a pharmacy, etc.). The question fixes A and B as literal
lat/lon pairs, the plain-English place type, an attribute filter,
and the objective: choose the stop that minimises total drive
time A → stop → B. Gold = `place_id` of the chosen stop.

> **Question (solver-visible):** "I'm driving from
> `40.7580, -73.9855` to `40.7128, -74.0060` and need to stop for
> a quick charge on the way. Look for EV charging stations near
> the rough midpoint of my route, within 800 metres. I only care
> about stations that offer DC fast-charging at 150 kW or higher.
> Pick the one that adds the least total driving time to my trip
> (i.e. drive time from A to the station plus drive time from the
> station to B is the smallest). If two stations are within 5
> seconds of each other on that total, pick the one closer to the
> midpoint. Return the chosen station's id."
>
> **Reference pipeline (eval-only, NOT shown to solver):**
> ```
> 1. midpoint = ((A.lat+B.lat)/2, (A.lon+B.lon)/2)
> 2. nearbySearch?categorySet=7309&lat=<mid.lat>&lon=<mid.lon>
>    &radius=800&limit=100
> 3. Filter: any connector in chargingPark.connectors with
>    ratedPowerKW >= 150
> 4. For each candidate X:
>    t_AX = calculateRoute?travelMode=car (A → X)
>    t_XB = calculateRoute?travelMode=car (X → B)
>    score = t_AX + t_XB
> 5. Sort ascending by score; tie-break ascending by dist
>    (search-result distance from midpoint).
> 6. gold = winner.id
> ```

##### Shape 4 — Aggregate count / total / median

The traveller wants a single numeric answer about a neighbourhood:
a count of places matching a constraint, a total drive-time budget
to reach every place of a type within a radius, etc. The question
fixes a literal lat/lon region centre and radius (no place-name
geocoding), the plain-English place type, an attribute filter, and
a plain-English aggregator ("how many", "what is the total
driving-time-in-seconds budget"). Gold is an `integer` or a
`duration_seconds` computed client-side after pulling the full
candidate set. Use this shape sparingly (≤ 30 % of probes) because
it tempts the synthesiser toward single-call lookups; pair every
Shape-4 item with a non-trivial filter that the search endpoint
cannot express.

> **Question (solver-visible):** "I'm based at `41.3851, 2.1734`
> in Barcelona. If I wanted to drive to every coffee shop within
> 1000 metres of me that has a phone number listed AND that's
> reachable in under 3 minutes of driving from where I am, how
> many total seconds of driving would all those trips add up to?
> (Sum of one-way driving times, one per qualifying coffee shop.)
> Return just the integer total in seconds."
>
> **Reference pipeline (eval-only, NOT shown to solver):**
> ```
> 1. nearbySearch?categorySet=7315&lat=41.3851&lon=2.1734
>    &radius=1000&limit=100
> 2. Filter response.results[]: poi.phone is non-empty
> 3. For each surviving candidate X:
>    t_X = calculateRoute?travelMode=car (start → X).travelTimeInSeconds
>    Keep only X where t_X < 180
> 4. gold = sum(t_X for all kept X)
> ```

#### 3.1.C Outright rejection list

REJECT and redraft if the candidate has any of these shapes:

- Open-ended recommendation: "what's the best …", "recommend a
  …", "where should I …", "any good …".
- Free-text answer: place name, sentence, list of names, JSON.
- Single-call API lookup: only one endpoint touched, no
  client-side processing.
- Ambiguous tie: filter set + optimisation produces a non-unique
  winner under realistic snapshot conditions, AND the tie-break
  rule does NOT deterministically pick one.
- Reasoning-shaped answer: "the answer is X because …", any
  prose.
- Place-name-as-answer when an `id` is requested.
- Distance / radius / time threshold expressed in vague terms
  ("nearby", "a short drive", "within walking distance").
- Any of the banned subjective terms in §3.1.A.5.

### 3.2 Anti-leakage rules

The `question` field is the **solver model's view**. It MUST read
as plain English from a real traveller. The synthesiser owes the
solver a real natural-language problem, not a thinly-wrapped API
call sheet.

The `question` field MUST NOT contain:

- the API key value (it lives only in `$TOMTOM_API_KEY`; never
  embed the literal token in the question text or any committed
  file),
- the gold answer or any prefix / suffix that uniquely identifies
  it,
- the `reference_pipeline` source code or any direct URL of an
  endpoint that returns the answer,
- any HTTP endpoint name (`nearbySearch`, `poiSearch`,
  `categorySearch`, `calculateRoute`, `matrixRouting`, `geocode`,
  `place`), API path fragment, or example query string,
- any TomTom response field by its raw JSON key
  (`travelTimeInSeconds`, `lengthInMeters`, `categorySet`, `dist`,
  `openingHours`, `chargingPark.connectors`, `poi.brands`,
  `poi.phone`, `poi.url`, `popularity`, `position`) — paraphrase
  every reference: "drive time in seconds", "straight-line
  distance in metres", "the chain brand list", "the phone-number
  field", "the website-url field". The numeric `categorySet=...`
  value in particular is forbidden in question text — the
  question names the place in plain English ("a hotel", "an EV
  charging station") and the mapping lives in
  `reference_pipeline`,
- pipeline-shaped procedural instructions ("call X, then filter
  by Y, then compute Z") — the question states the goal and the
  constraints; how to compute it is the skill's job to learn.

The `reference_pipeline` (eval-only) records the exact endpoint
sequence + query strings + response keys + computation steps
needed to recompute the gold. The solver and the improver NEVER
see this field — it lives in the private eval repo's `PRD.md`
and the per-probe `reference_pipeline` JSON.

### 3.3 Per-item verifier (Exact Match)

For each row, the verifier reads `answer.txt`, strips ONLY a
single trailing newline, and computes:

```python
scores = {
    "artifact_exists_ok":         answer.txt exists,
    "artifact_nonempty_ok":       len(answer) >= 1,
    "answer_single_line_ok":      "\n" not in answer.rstrip("\n"),
    "answer_no_placeholder_ok":   no 'unknown'/'TBD'/'cannot determine'/CJK,
    "answer_format_ok":           regex matches the question's answer_type:
        place_id        : ^[A-Za-z0-9_\-]{8,64}$
        integer         : ^\d+$        (no leading zeros except "0")
        duration_seconds: ^\d+$
    "answer_exact_match_ok":      answer == gold,
}
scores_require_all = True
```

`answer_exact_match_ok` is **byte-exact** against a single `gold`
value: no case-folding, no whitespace normalisation, no fuzzy
substring, no list-of-acceptable-alternates. The benchmark stays
clean because synth guarantees the inputs to its reference
pipeline are byte-stable (§3.1.B Deterministic-input invariant)
AND that the winning candidate beats its runner-up by the §3.1.B
near-tie-rejection margins, so the gold IS unique by construction.

### 3.4 Splits

**Hard cap: 10 probe items, no other splits.** SkillHone effect is
measured on probe alone for this example. Do NOT synthesise a
test or train split.

When invoking `skillhone synth`, pass `--target 10 --splits probe`.
Distribute shapes across the 10 probes roughly as: 4 × Shape-1,
3 × Shape-2, 2 × Shape-3, 1 × Shape-4. Vary geographic anchor
across well-known cities (NYC, SF, London, Tokyo, Berlin,
Singapore, Sydney, Toronto, Paris, Barcelona) so no two probes
the same start.

### 3.5 Synth-stage acceptance gate (REGRESSION GATE)

A probe set earns its keep when the seed skill, run against it,
scores **≤ 70 %** under the Exact-Match verifier — i.e. the
unoptimised baseline must fail at least 30 % of probes, leaving
≥ 30 pp of headroom for SkillHone's optim loop to demonstrate.
If the seed solves more than 70 % of probes, the questions are
not extracting enough constraint-solving difficulty — synth must
redraft with feedback.

`synth.py --target-pass-rate-max 0.70 --max-resynth 2` (kept at 2,
not 3, to bound the TomTom API quota burn).

*Rationale.* An earlier draft pinned the gate at ≤ 30 %, which
turned out to be too strict on this domain — synth redrafted to
quota exhaustion without consistently reaching the floor, and even
40 % runs (seed fails 6/10) already give optim plenty of real
failure modes to diagnose. A ≤ 70 % gate is the explicit
permission-to-accept once the synth has clearly differentiated the
seed from a hypothetical optimised skill.

Each synth iteration writes a `Synth-Iteration-N` page to
`<eval-clone>/synthesis_observations/iter_NN.md` recording the
iteration's pass rate, per-item pass/fail breakdown, and redraft
guidance.

### 3.6 Reference snapshot preservation

For offline reproducibility and evaluator post-hoc analysis, the
synthesiser MUST write the following into the eval repo, alongside
`probe.jsonl`:

- `snapshots/probe_<uid>/` — every JSON response from a TomTom
  endpoint hit while computing this probe's gold, named
  `01_geocode.json`, `02_search.json`, `03_route_<i>.json`, etc.
- `snapshots/probe_<uid>/reference_pipeline.json` — the ordered
  list of endpoint calls (URL + body) that produced the gold,
  with sensitive `key=` query params redacted to `key=<API_KEY>`.

Solver traces during eval should also write per-probe API snapshots
into the eval workdir's `cache/` so the evaluator can later
diff the solver's calls against the reference pipeline and identify
*where* the solver diverged (wrong endpoint, wrong filter, wrong
unit, wrong tie-break). This per-call diff is what makes
SkillHone's optimisation loop precise.

### 3.7 Seed skill contract

The seed skill is generated by `scripts/seed.py` from the public
(redacted) skill-repo `README.md`. It sees §1 (TomTom endpoints +
key + answer types) and §2 (output protocol) but NOT this §3. Its
job at synth-time is to be a "competent but unoptimised" baseline:
it knows the TomTom API surface but does not yet have the
matrix-routing recipe, the TSP solver, the cache layer, the
tie-break boilerplate, the unit-conversion guard rails, etc. The
acceptance gate's job is to verify that this competent baseline
still fails ≥ 70 % of probes — those failures are the learnable
signal optim can close.
