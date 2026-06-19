# Vouch — Night-Shift Handover

Turns a hotel's overnight front-desk log into an **action-first morning handover** — what's on fire,
what's pending, what's just FYI — with every statement grounded in the source and nothing resolved on
an earlier shift re-reported. It runs unattended, so **code owns every decision an operator acts on**;
the model only does language.

**Live:** <https://vouchtest.yoss.cloud> · **Design:** [plan.md](plan.md) · [DECISIONS.md](DECISIONS.md) · [CLAUDE.md](CLAUDE.md)

## Quickstart

Requires Node 20+ and a DeepSeek API key.

```bash
cp .env.example .env          # set DEEPSEEK_API_KEY=...  (UPPERCASE); PORT defaults to 3000
npm install
npm run dev                   # or: npm run build && npm start
npm test                      # 92 offline tests (no network/key)
```

With no key the service still runs (deterministic mode): structured events surface fully and free-text
blocks appear verbatim (no translation), and it logs that the model is unavailable.

## Sample curl

```bash
curl -s "https://vouchtest.yoss.cloud/handover?date=2026-05-30&format=json"   # action-first JSON (bundled sample)
curl -s "https://vouchtest.yoss.cloud/handover?date=2026-05-30&format=html"   # server-rendered operator view
curl -s  https://vouchtest.yoss.cloud/health
```

## Input contract — `POST /handover`

The **primary interface**: input arrives as data, not a file.

```jsonc
{
  "hotel":     { "id": "...", "name": "...", "rooms": 40, "timezone": "+08:00" },   // required
  "events":    [ { "id", "timestamp" /* ISO 8601 */, "type", "room"|null, "guest"|null, "description", "status" } ],  // optional
  "nightLogs": "free-text shift notes, any language",                              // optional
  "asOfDate":  "2026-05-30"                                                          // optional → defaults to the most recent shift in the input
}
```

`events` and `nightLogs` are **each optional** — a night logged only in the system, only as free text,
or both. The response:

```jsonc
{ "hotel_id", "as_of", "all_clear",
  "sections": { "EMERGENCY": [], "ON FIRE": [], "FLAGGED": [], "PENDING": [], "FYI": [] },
  "suppressed": [ { "key": "room:215" } ] }   // resolved on an earlier shift — tracked, not re-reported
```

Each item: `{ room, status (still_open | newly_resolved | new_tonight), severity, summary, source_ids[], flagged_reason? }`.
Bad input returns a clean `4xx` with a helpful message (out-of-range date, empty body, malformed
`events`) — never a 500 or a stack trace.

**Example (your own data):**

```bash
curl -s -X POST https://vouchtest.yoss.cloud/handover -H 'Content-Type: application/json' -d '{
  "hotel": { "id": "demo-1", "name": "Demo Inn", "rooms": 12, "timezone": "+00:00" },
  "events": [
    { "id": "e1", "timestamp": "2026-07-01T23:40:00+00:00", "type": "maintenance", "room": "5", "guest": null, "description": "Boiler down, no hot water on floor 1. Logged for the morning team.", "status": "unresolved" }
  ],
  "nightLogs": "Quiet night. Guest in 8 said the hallway light flickers; will check at sunrise.",
  "asOfDate": "2026-07-02"
}'
```

## Architecture — model-owns / code-owns

1. **Ingest (code):** normalize `events.json` + segment night-logs into citable verbatim blocks; tz-aware shift-bucketing (23:00–07:00 across two dates).
2. **Reconcile (code):** group events into issue threads (`room → guest → id`), classify per target morning, suppress earlier-resolved.
3. **Enrich (model):** DeepSeek segments / translates / classifies / summarizes each free-text block **in isolation**.
4. **Ground + flag (code):** every claim's quote must be verbatim in its cited source; summaries can't invent rooms/amounts/names; manipulation / contradiction / incomplete → `flagged`.
5. **Render (code):** action-first JSON + zero-dependency HTML. **Code owns inclusion, severity, and validation; the model only does language.**

## Tests & deploy

```bash
npm test          # 92 offline unit tests           npm run typecheck
node --env-file=.env --import tsx eval/mornings.ts   # live verification against DeepSeek
```

A pre-commit hook gates typecheck + unit tests. Deployed on a Windows VPS under PM2
(`ecosystem.config.cjs`) behind a Cloudflare Tunnel → `localhost:3003`.
