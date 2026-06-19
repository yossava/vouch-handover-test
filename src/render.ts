import type { Handover, HandoverItem } from "./handover.js";
import type { Severity } from "./severity.js";

const SECTION_LABEL: Record<Severity, string> = {
  emergency: "EMERGENCY",
  on_fire: "ON FIRE",
  flagged: "FLAGGED",
  pending: "PENDING",
  fyi: "FYI",
};
const SECTION_ORDER: Severity[] = ["emergency", "on_fire", "flagged", "pending", "fyi"];

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

function roomOf(key: string): string | null {
  return key.startsWith("room:") ? key.slice("room:".length) : null;
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
  for (const s of SECTION_ORDER) sections[SECTION_LABEL[s]] = h.buckets[s].map(toResponseItem);
  return {
    hotel_id: hotelId,
    as_of: h.targetMorning,
    all_clear: h.allClear,
    sections,
    suppressed: h.suppressed.map((key) => ({ key })),
  };
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
/** Escape guest-controlled text before it ever reaches HTML (XSS). */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPES[c]!);
}

export function toHtml(h: Handover, hotelId: string): string {
  const e = escapeHtml;
  const sections = SECTION_ORDER.map((s) => {
    const items = h.buckets[s];
    if (items.length === 0) return "";
    const lis = items
      .map((i) => {
        const room = roomOf(i.key);
        const refs = i.refs.map(e).join(", ");
        const reason = i.flaggedReason ? ` <em>— ${e(i.flaggedReason)}</em>` : "";
        return `      <li><span class="tag">${e(i.status)}</span> ${room ? `Room ${e(room)}: ` : ""}${e(i.summary)} <small>[${refs}]</small>${reason}</li>`;
      })
      .join("\n");
    return `  <section><h2>${e(SECTION_LABEL[s])}</h2>\n    <ul>\n${lis}\n    </ul>\n  </section>`;
  })
    .filter(Boolean)
    .join("\n");

  const clear = h.allClear ? `  <p class="clear"><strong>No actionable items — all clear.</strong></p>\n` : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Handover — ${e(hotelId)} — ${e(h.targetMorning ?? "")}</title>
<style>body{font-family:system-ui,sans-serif;max-width:52rem;margin:2rem auto;padding:0 1rem;line-height:1.5}h1{font-size:1.25rem}h2{font-size:.95rem;border-bottom:1px solid #ccc}.tag{font-size:.7rem;background:#eee;padding:.05rem .35rem;border-radius:.25rem}small{color:#666}</style>
</head><body>
  <h1>Night-shift handover — ${e(hotelId)} — morning of ${e(h.targetMorning ?? "unknown")}</h1>
${clear}${sections}
</body></html>`;
}
