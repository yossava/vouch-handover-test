# Vouch — Night-Shift Handover

A service that turns a hotel's overnight front-desk log into an **action-first morning handover**:
what's on fire, what's pending, what's just FYI — every statement grounded in the source, every
manipulation/contradiction/incomplete entry flagged, and items resolved on earlier shifts not
re-reported. Runs unattended, so it optimizes for **trust** (grounding + reconciliation + resistance
to bad/hostile input) over features.

**Live:** <https://vouchtest.yoss.cloud>

Design and rules: [plan.md](plan.md) · [CLAUDE.md](CLAUDE.md) · [DECISIONS.md](DECISIONS.md).

## Run locally

Requires Node 20+ and a DeepSeek API key.

```bash
cp .env.example .env          # then set DEEPSEEK_API_KEY=...   (note: UPPERCASE)
npm install
npm run dev                   # or: npm run build && npm start   (serves on :3000)
```

The model is optional — with no key the service still runs, surfacing structured events fully and
free-text blocks verbatim (no translation), and logs that it's in deterministic mode.

## Canonical curl — generate a handover

The **primary interface is `POST /handover`**: input arrives as data, not a file. It accepts
`{ hotel, events?, nightLogs?, asOfDate? }` — `events` and `nightLogs` are each optional, and
`asOfDate` defaults to the most recent shift in the input.

```bash
BASE_URL=https://vouchtest.yoss.cloud   # the live deployment (use http://localhost:3000 to run locally)

curl -s -X POST "$BASE_URL/handover" \
  -H 'Content-Type: application/json' \
  -d '{
    "hotel": { "id": "lumen-sg", "name": "Lumen Boutique Hotel", "rooms": 40, "timezone": "+08:00" },
    "events": [
      { "id": "evt_0002", "timestamp": "2026-05-26T00:20:00+08:00", "type": "maintenance", "room": "112", "guest": "Sarah Wong", "description": "Aircon not cooling. Room 112 marked OUT OF ORDER. Needs aircon repair.", "status": "unresolved" },
      { "id": "evt_0023", "timestamp": "2026-05-30T03:50:00+08:00", "type": "damage_report", "room": "226", "guest": "Marcus Tan", "description": "Cracked basin in 226 after checkout. Night staff proposes charging the SGD 500 damage fee. No photos were taken and there is no manager approval on record yet.", "status": "pending" }
    ],
    "nightLogs": "- 208 房的客人说房间的保险箱打不开了，护照和现金锁在里面，明天一早要退房赶飞机。",
    "asOfDate": "2026-05-30"
  }'
```

Returns the action-first JSON: `{ hotel_id, as_of, all_clear, sections, suppressed }`, where
`sections` is `EMERGENCY / ON FIRE / FLAGGED / PENDING / FYI` and each item carries its `status`
(`still_open | newly_resolved | new_tonight`), a grounded `summary`, and the cited `source_ids`.

## Endpoints

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/health` | liveness + loaded-sample summary |
| `GET` | `/handover?date=YYYY-MM-DD&format=json\|html` | runs against the bundled sample; `format` defaults to `json` |
| `POST` | `/handover` | the canonical interface above (data in) |

```bash
curl -s "$BASE_URL/handover?date=2026-05-30&format=json"   # action-first JSON
curl -s "$BASE_URL/handover?date=2026-05-30&format=html"   # server-rendered operator view (no deps, no JS)
curl -s "$BASE_URL/health"
```

Invalid input returns a clean `4xx` with a helpful message (never a 500 or a stack trace) — an
out-of-range date, an empty body, or a malformed `events` array each yield `400`.

## How it stays trustworthy

- **Code owns inclusion + severity**; the model only segments / translates / classifies / summarizes.
  So "ignore all other items" is inert and "all clear" is computed from the absence of items.
- **Two-layer grounding**: every claim's `evidence_quote` must be a verbatim substring of its cited
  source (original language); the summary may not introduce a room/amount/name absent from the
  sources. Failures go to an ungrounded bucket and never ship.
- **Flags** for manipulation (prompt injection), contradictions (disputed/unverified), and incomplete
  actions (a proposed charge with no photos/approval — not charge-ready).
- **Structured logs** (`hotel_id`, `as_of`, every reconcile decision, every model call, every
  grounding rejection) make a bad handover debuggable.

## Tests

```bash
npm test          # 90+ unit tests, fully offline (no network/key)
npm run typecheck
node --env-file=.env --import tsx eval/mornings.ts   # live verification against DeepSeek
```
