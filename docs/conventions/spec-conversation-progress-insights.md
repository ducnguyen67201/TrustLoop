# Conversation Progress Insights — Engineering Spec

Status: **Shipped (v1)**
Date: 2026-04-12
Scope: `apps/web` — new page + sidebar nav

## Problem

Operators have no visibility into how long conversation threads have been open, which are stale, or how quickly threads get resolved. The support inbox shows current status but not duration or processing trends. This makes it hard to spot bottlenecks or threads that have been sitting too long.

## Solution

A new **Insights** page at `/{workspaceId}/insights` providing a GitHub Projects-style roadmap timeline of all conversation threads, plus summary metrics.

## Data Source

All data is fetched from a single tRPC query:

```
supportInbox.listConversations({ limit: 200 })
```

Returns `SupportConversationListResponse` containing `SupportConversation[]`. No new backend endpoints or schema changes required.

### Fields Used

| Field                      | Purpose                                              |
|----------------------------|------------------------------------------------------|
| `status`                   | Color coding, grouping, metric computation           |
| `createdAt`                | Timeline bar start, duration calculation              |
| `updatedAt`                | Timeline bar end (for DONE threads)                   |
| `canonicalConversationKey` | Row label in timeline                                 |
| `customerWaitingSince`     | Tooltip detail                                        |

For open threads (status != DONE), the bar extends to the current time.

## UI Components

### File Map

| File | Role |
|------|------|
| `apps/web/src/app/[workspaceId]/insights/page.tsx` | Page route |
| `apps/web/src/components/insights/conversation-progress.tsx` | Main component (client) |
| `apps/web/src/components/workspace/workspace-shell.tsx` | Sidebar nav (modified) |
| `apps/web/src/lib/workspace-paths.ts` | Path helper (modified) |

### 1. Summary Cards

Four metric cards computed client-side from the conversation array:

| Card | Computation |
|------|-------------|
| **Open Threads** | Count where `status != DONE`, broken down by UNREAD / IN_PROGRESS / STALE |
| **Resolved** | Count where `status == DONE`, with avg resolution time `mean(updatedAt - createdAt)` |
| **Avg Active Duration** | `mean(now - createdAt)` across non-DONE threads |
| **Longest Wait** | `max(now - createdAt)` across non-DONE threads |

### 2. Status Legend

Horizontal row of colored indicators mapping status to bar color:

| Status | Color |
|--------|-------|
| UNREAD | Blue (`bg-blue-500`) |
| IN_PROGRESS | Yellow (`bg-yellow-500`) |
| STALE | Orange (`bg-orange-500`) |
| DONE | Green (`bg-emerald-500`) |

### 3. Timeline Chart

Gantt-style horizontal bar chart inside a `Card`.

**Layout:**
- Left column (280px): conversation key with status-colored dot
- Right area: scrollable timeline with date markers

**Bar positioning:**
- `left%` = `(createdAt - timelineStart) / totalRange * 100`
- `width%` = `(barEnd - createdAt) / totalRange * 100`
- `barEnd` = `now` for open threads, `updatedAt` for DONE

**Features:**
- Auto-computed date markers (12h/1d/1w/1mo intervals based on range)
- Vertical "Now" line with label
- Pulsing dot at the end of open thread bars
- Hover tooltips with full details (key, status, duration, timestamps, customer waiting since)
- Open threads sorted first (oldest → newest), then resolved (newest → oldest)
- 5% padding on each side of the timeline range

**Timeline range algorithm:**
- Scans all conversations for earliest `createdAt` and latest `updatedAt`
- Adds 5% padding (minimum 12 hours) on each side
- Extends end to at least `now + padding`

## Sidebar Integration

"Insights" added as the 4th item in the **Main** nav group with `RiLineChartLine` icon. Active state triggers on `/{workspaceId}/insights` and sub-paths. The placeholder "Analytics" item was removed from the secondary nav group.

## Limitations (v1)

- Client-side computation only — no server-side aggregation or caching
- No historical trends (e.g. week-over-week comparison)
- No filtering by status, date range, or assignee
- Capped at 200 conversations (no pagination on timeline)
- No SLA tracking beyond `customerWaitingSince` in tooltips
- Duration metrics use wall-clock time, not business hours

## Future Enhancements

- Server-side aggregation endpoint for large conversation volumes
- Date range picker and status/assignee filters
- Trend charts (resolution time over time, open thread count over time)
- SLA breach indicators on timeline bars
- Click-through from timeline row to conversation detail
- Business hours calculation for duration metrics
