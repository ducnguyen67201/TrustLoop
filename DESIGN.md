# DESIGN.md

Design source of truth for TrustLoop app surfaces.

This repo is building operator tooling, not marketing pages.
The UI should feel calm, sharp, and credible under pressure. When an engineer is triaging a customer escalation, the product should read like a reliable instrument panel, not a startup landing page stuffed into a settings screen.

## Product Feel

- Evidence first. Show the thing that helps the user act.
- Calm under load. Low chrome, few colors, clear hierarchy.
- Utility over performance. Copy should orient, explain status, or unlock action.
- Trust is visual. Freshness, provenance, and recoverability must be obvious.

## Stack Constraints

- Use shadcn/ui only for primitives and composed components.
- Use Tailwind utilities plus the CSS variables already defined in `apps/web/src/app/globals.css`.
- Do not introduce a second design language via CSS modules, ad hoc inline styles, or another component library.

## Typography

- Current font source of truth is `apps/web/src/app/globals.css`.
- Use the existing mono family for both body and headings. This is unusual, but it fits the product if hierarchy is handled with size, spacing, and weight instead of decorative font changes.
- Headings should be short and operational. Example: `Index health`, `Repository scope`, `Search ready`.
- Body copy should stay tight. If cutting 30% improves clarity, cut it.

## Color System

- Respect the existing theme tokens in `apps/web/src/app/globals.css`.
- Base surfaces are warm neutrals and taupe-adjacent grays.
- Yellow `--primary` is the main accent. Reserve it for primary actions, active selections, and the highest-signal affordance on the screen.
- Violet chart colors are for charts and analytics only. Do not repurpose them as the default accent for product UI.
- Status should not become a rainbow. Most status expression should come from copy, icon, and hierarchy. Use destructive styling only for actual failure states.

## Surface and Chrome

- Prefer open layout over nested cards.
- Panels are allowed when they group a real working area. Decorative card grids are not.
- Borders should be light and structural, not loud.
- Shadows should be minimal. If removing a shadow does not hurt clarity, remove it.
- Use the existing radius scale sparingly. Do not round everything into pills and bubbles.

## Layout Rules

- App screens should read as one composition with a clear working path.
- Default app structure:
  - primary workspace area
  - secondary context if needed
  - one accent action at a time
- Avoid dashboard mosaics made of stacked cards. This product is task-driven, not widget-driven.

## Copy Rules

- Every line of copy must do one of three jobs:
  - orient the user
  - explain current system state
  - make the next action obvious
- No generic SaaS phrases like `Welcome`, `all-in-one`, `unlock the power`, or mood copy that says nothing.
- Empty states should feel specific and helpful, never like placeholders.

## Component Vocabulary

- Tables, lists, inline status rows, dialogs, sheets, tabs, breadcrumbs, and command surfaces should come from shadcn.
- A card only earns its existence when the card itself is the interaction.
- Evidence should usually render as dense rows with clear metadata, not as oversized promotional tiles.
- Status badges should be used sparingly. Over-badging makes the whole page look like a color legend instead of a tool.

## Motion

- Motion is allowed only when it improves comprehension.
- Good uses:
  - staged sync progress
  - evidence reveal after retrieval
  - immediate confirmation after relevance feedback
- Bad uses:
  - decorative floating elements
  - attention-seeking loops
  - animation that competes with system status

## Trust Cues

These are first-class design elements, not metadata scraps.

- freshness timestamp
- indexed commit SHA
- last successful sync
- degraded or fallback mode notice
- clear recovery path after failure

If a user can ask "can I trust this result?", the answer should already be visible in the UI.

## GitHub Indexing Pattern

For the GitHub indexing feature in `Settings > Integrations`, the default page shape is:

1. `Connection Status`
2. `Repository Scope`
3. `Index Health`

Rules for this screen:

- Keep the page low-chrome and left-aligned.
- Each zone should read as a working area, not a tile in a dashboard.
- Primary action should be singular per zone.
- File path, line span, snippet, freshness, and ranking receipts lead the evidence layout.
- Sync progress should show staged system work, not an indeterminate spinner alone.

## Anti-Slop Rules

Reject these by default:

- three-column feature grids
- centered-everything layouts
- blue-purple or purple gradient defaults
- colored-circle icons as decoration
- ornamental blob backgrounds
- generic hero language applied inside app UI
- repeated cards where a simple list or section would be clearer

## Implementation Notes

- Start from existing tokens, not taste in the moment.
- Preserve consistency across `apps/web` by composing small feature components and moving stateful behavior into hooks.
- If a new screen needs a visual rule that is not covered here, add it to this file before repeating the pattern three times in code.
