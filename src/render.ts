import type { Handover, HandoverItem } from "./handover.js";
import type { Severity } from "./severity.js";

const SECTION_ORDER: Severity[] = ["emergency", "on_fire", "flagged", "pending", "fyi"];
const SECTION_META: Record<Severity, { label: string; emoji: string; tally: string }> = {
  emergency: { label: "EMERGENCY", emoji: "🚑", tally: "emergency" },
  on_fire: { label: "ON FIRE", emoji: "🔥", tally: "on fire" },
  flagged: { label: "FLAGGED", emoji: "🚩", tally: "flagged" },
  pending: { label: "PENDING", emoji: "⏳", tally: "pending" },
  fyi: { label: "FYI", emoji: "ℹ️", tally: "FYI" },
};

function roomOf(key: string): string | null {
  return key.startsWith("room:") ? key.slice("room:".length) : null;
}

// ---------- JSON ----------

export interface ResponseItem {
  room: string | null;
  status: string;
  severity: Severity;
  summary: string;
  source_ids: string[];
  flagged_reason?: string;
}

export interface HandoverResponse {
  hotel_id: string;
  as_of: string | null;
  all_clear: boolean;
  sections: Record<string, ResponseItem[]>;
  suppressed: { key: string }[];
}

function toResponseItem(i: HandoverItem): ResponseItem {
  const item: ResponseItem = {
    room: roomOf(i.key),
    status: i.status,
    severity: i.severity,
    summary: i.summary,
    source_ids: i.refs,
  };
  if (i.flaggedReason) item.flagged_reason = i.flaggedReason;
  return item;
}

/** Action-first JSON: ordered sections, each item tagged with status + cited source_ids. */
export function toResponseJson(h: Handover, hotelId: string): HandoverResponse {
  const sections: Record<string, ResponseItem[]> = {};
  for (const s of SECTION_ORDER) sections[SECTION_META[s].label] = h.buckets[s].map(toResponseItem);
  return {
    hotel_id: hotelId,
    as_of: h.targetMorning,
    all_clear: h.allClear,
    sections,
    suppressed: h.suppressed.map((key) => ({ key })),
  };
}

// ---------- HTML ----------

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
/** Escape guest-controlled text before it ever reaches HTML (XSS). */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPES[c]!);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDate(iso: string, withYear = false): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const label = `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? ""}`;
  return withYear ? `${label} ${m[1]}` : label;
}

function stateBadge(item: HandoverItem): string {
  if (item.status === "new_tonight") return "NEW tonight";
  if (item.status === "newly_resolved") return "RESOLVED overnight";
  if (item.status === "still_open") return item.since ? `OPEN since ${fmtDate(item.since)}` : "OPEN";
  return item.status;
}

const STYLE = `
:root{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
body{max-width:50rem;margin:1.5rem auto;padding:0 1rem;line-height:1.45;color:#1a1a1a}
header h1{font-size:1.2rem;margin:0}
.sub{color:#555;margin:.15rem 0}
.tally{font-weight:600;margin:.35rem 0 1rem}
.allclear{background:#e8f5e9;border:1px solid #66bb6a;padding:.5rem .75rem;border-radius:.3rem}
section{margin:1.1rem 0}
h2{margin:0 0 .4rem;font-size:1rem}
.sec{color:#fff;padding:.18rem .55rem;border-radius:.25rem;font-size:.8rem;letter-spacing:.03em}
.sec-emergency{background:#c0392b}.sec-on_fire{background:#d35400}.sec-flagged{background:#8e44ad}.sec-pending{background:#2563eb}.sec-fyi{background:#6b7280}
ul{list-style:none;margin:0;padding:0}
li{padding:.5rem .6rem;border-left:3px solid #ccc;margin:.35rem 0;background:#fafafa;border-radius:0 .2rem .2rem 0}
.li-emergency{border-left-color:#c0392b}.li-on_fire{border-left-color:#d35400}.li-flagged{border-left-color:#8e44ad}.li-pending{border-left-color:#2563eb}.li-fyi{border-left-color:#6b7280}
.state{font-size:.7rem;font-weight:600;background:#eaeaea;color:#333;padding:.05rem .4rem;border-radius:.25rem;white-space:nowrap}
.refs{font-size:.7rem;color:#999}
.warn{color:#8e44ad;font-weight:700;font-size:.85rem;margin-top:.25rem}
.reason{font-size:.8rem;color:#666}
.sides{font-size:.82rem;background:#f3e9fa;border-radius:.25rem;padding:.3rem .5rem;margin-top:.25rem}
.sides div{margin:.1rem 0}
footer{margin-top:2rem;padding-top:.6rem;border-top:1px solid #ddd;font-size:.78rem;color:#666}`;

function renderItem(item: HandoverItem, sev: Severity): string {
  const e = escapeHtml;
  const room = roomOf(item.key);
  const roomHtml = room ? `<strong>Room ${e(room)}</strong> — ` : "";
  const refs = item.refs.length ? ` <span class="refs">${item.refs.map(e).join(", ")}</span>` : "";
  let extra = "";
  if (sev === "flagged") {
    extra += `\n        <div class="warn">⚠ review — do not action</div>`;
    if (item.flaggedReason) extra += `\n        <div class="reason">${e(item.flaggedReason)}</div>`;
    if (item.contradiction) {
      extra += `\n        <div class="sides"><div>① ${e(item.contradiction.a)}</div><div>② ${e(item.contradiction.b)}</div></div>`;
    }
  }
  return `      <li class="li-${sev}">${roomHtml}${e(item.summary)} <span class="state">${e(stateBadge(item))}</span>${refs}${extra}</li>`;
}

/** Server-rendered, dependency-free handover for a 7am operator scanning in 60 seconds. */
export function toHtml(h: Handover, hotel: { id: string; name: string }, generatedAt: string): string {
  const e = escapeHtml;
  const active = SECTION_ORDER.filter((s) => h.buckets[s].length > 0);
  const tally = active.map((s) => `${h.buckets[s].length} ${SECTION_META[s].tally}`).join(" · ") || "nothing logged";
  const dateLabel = h.targetMorning ? `Morning of ${fmtDate(h.targetMorning, true)}` : "Morning (date unknown)";

  const sections = active
    .map((s) => {
      const meta = SECTION_META[s];
      const lis = h.buckets[s].map((i) => renderItem(i, s)).join("\n");
      return `  <section>\n    <h2><span class="sec sec-${s}">${meta.emoji} ${e(meta.label)} · ${h.buckets[s].length}</span></h2>\n    <ul>\n${lis}\n    </ul>\n  </section>`;
    })
    .join("\n");

  const banner = h.allClear
    ? `  <p class="allclear">✅ <strong>All clear</strong> — no actionable items this shift.</p>\n`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Handover — ${e(hotel.name)} — ${e(h.targetMorning ?? "")}</title>
<style>${STYLE}</style>
</head>
<body>
  <header>
    <h1>${e(hotel.name)}</h1>
    <div class="sub">${e(dateLabel)}</div>
    <div class="tally">${e(tally)}</div>
  </header>
${banner}${sections}
  <footer>Generated ${e(generatedAt)}. Flagged items need human review before any charge or credit.</footer>
</body>
</html>`;
}
