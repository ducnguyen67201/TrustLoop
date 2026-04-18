# UI Conventions

## Component Library: shadcn/ui only

All UI in `apps/web` must use **shadcn/ui**. No other component libraries are permitted.

### What is allowed

- shadcn/ui components installed via `npx shadcn@latest add <component>`
- Tailwind CSS utility classes
- shadcn CSS variables defined in `src/app/globals.css`
- Lucide React icons (bundled with shadcn)
- Composing shadcn primitives into project-specific components

### What is NOT allowed

- Third-party component libraries (MUI, Chakra UI, Ant Design, Mantine, etc.)
- Using Radix primitives directly instead of the shadcn wrapper
- CSS modules, styled-components, Emotion, or inline `style` objects
- Hand-rolling components that shadcn already provides (Dialog, Dropdown, Toast, etc.)

## Theme

- **Preset:** `b5wjYaOsi`
- **Style:** Lyra
- **Base color:** Taupe
- **Primary:** Yellow
- **Chart color:** Violet
- **Fonts:** Geist Mono (heading + body)
- **Radius:** None (0)
- **Icon library:** Remix Icon (via Lucide)

The theme is defined as CSS variables in `apps/web/src/app/globals.css` with both light and dark mode support.

## Adding new components

```bash
cd apps/web
npx shadcn@latest add <component-name>
```

This installs the component into `src/components/ui/` with the project theme already applied.

## Component structure

- **One responsibility per component.** Break pages and features into small, focused components. A page file should compose components, not contain all the markup.
- **File organization:**
  - `src/components/ui/` — shadcn-managed primitives (do not manually edit)
  - `src/components/` — project-specific composed components
  - `src/hooks/` — custom hooks

### Example structure for a feature

```
src/
  app/dashboard/page.tsx          # composes DashboardHeader, StatCards, ActivityFeed
  components/
    dashboard/
      dashboard-header.tsx        # header section
      stat-cards.tsx              # stats grid
      activity-feed.tsx           # recent activity list
  hooks/
    use-dashboard-stats.ts        # fetches + transforms dashboard data
    use-activity-feed.ts          # pagination, polling logic
```

## Custom hooks

- Extract state management, data fetching, side effects, and reusable logic into custom hooks (`use*.ts`).
- Keep components declarative — they receive data and render. Hooks own the "how."
- Name hooks after what they provide, not what they do internally (e.g., `useDashboardStats` not `useFetchAndTransform`).
- Co-locate hooks with the feature they serve when single-use; promote to `src/hooks/` when shared.

## Commenting in UI code

Comments in UI code serve both human developers and AI agents working on the codebase.

- **Component-level:** Add a one-line comment at the top of each component describing its purpose and where it is used.
- **Props:** Comment non-obvious props or prop patterns (e.g., render props, compound component APIs).
- **Layout:** Comment intent behind non-obvious layout decisions (e.g., "sticky below header", "grid shifts to single column on mobile").
- **Conditional rendering:** Comment the business reason behind conditionals, not the mechanic (e.g., `/* show upgrade CTA only for free-tier workspaces */` not `/* if plan is free */`).
- Do not comment obvious Tailwind classes or self-evident JSX structure.

## Customizing components

- Customize behavior by composing shadcn components, not by forking them.
- If a shadcn component needs project-specific variants, extend it using `cva` (class-variance-authority) in a wrapper component.
- Keep wrapper components in `src/components/` (not in `src/components/ui/` which is shadcn-managed).
