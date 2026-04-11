# Changelog

All notable changes to TrustLoop will be documented in this file.

## [0.1.0.0] - 2026-04-11

### Added
- **Google sign-in.** New users can click "Continue with Google" on `/login` and land in TrustLoop without ever creating a password. Google is now the primary sign-in CTA; email/password is available behind a disclosure link. No existing users are affected.
- **Workspace auto-join by verified email domain.** When a user signs in with Google at a domain that already has a TrustLoop workspace (e.g. `@acme.com` → the Acme workspace), they join it automatically as a MEMBER. No admin invite required. Email must be Google-verified as a defense-in-depth check against domain spoofing. Personal email domains (gmail, outlook, etc.) are explicitly blocked from matching.
- **Warm `/no-workspace` experience for new customers.** First-time users from a domain without a TrustLoop workspace land on a friendly "Your team hasn't set up TrustLoop yet — email hello@trustloop.com" page. The TrustLoop team provisions workspaces manually during customer onboarding.
- **Funnel-level audit events.** `auth.google.first_sign_in` fires on first-ever Google sign-in with the user's email domain and whether it matched a workspace. `auth.google.auto_joined` fires when auto-join actually happens. Every callback also emits a structured log line with the outcome (`new_user_auto_joined` / `new_user_no_workspace` / `returning_user`) for future support questions.
- `AuthIdentity` model linking `(provider, providerAccountId)` to `User`, with schema hooks for GitHub, Microsoft, and SAML providers later at ~30 minutes each.
- `Workspace.emailDomain` column with partial unique index for auto-join lookups.
- `User.name` and `User.avatarUrl` nullable columns, populated from the Google profile on first sign-in.

### Changed
- `User.passwordHash` is now nullable. Google-only users have no password.
- Password login in `auth-router.ts` now rejects null-hash users with the same generic 401 as a wrong-password attempt. No information leaks about which accounts exist or which provider they're linked to.
- `UserIdentity` TS type in `user-service.ts` renamed to `UserIdentityRecord` to free the name for the new Prisma model.

### Infrastructure
- `jose@6.2.2` added to `@shared/rest` for Google id_token verification with JWKS caching and rotation.
- `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, and `GOOGLE_OAUTH_REDIRECT_PATH` env vars added to the shared schema (all optional — Google sign-in is hidden when unset).
- New routes `/api/auth/google/start` and `/api/auth/google/callback`.
- New `auth.providers` publicProcedure on the tRPC auth router for CLI/test clients.

## [0.0.1.0] - 2026-04-03

### Added
- Soft delete support for all Tier 1 models (User, Workspace, WorkspaceMembership, WorkspaceApiKey, SupportInstallation, SupportConversation, SupportDeliveryAttempt, SupportTicketLink)
- Prisma Client extension that auto-filters soft-deleted records from all read queries
- Partial unique indexes so disconnecting and reconnecting Slack (or removing and re-adding members) no longer hits unique constraint errors
- Cascade soft delete services for workspace, installation, and conversation hierarchies
- Typed `resurrectOrUpsert()` helper that handles the check-deleted / resurrect / or-create pattern
- `cascadeDeactivateUser()` function that soft-deletes a user and hard-deletes their sessions
- Purge function for permanently removing records past 90-day retention
- Spec document covering model classification, schema changes, and edge cases

### Changed
- Slack disconnect now soft-deletes the installation and cascades to conversations
- Workspace member removal now soft-deletes instead of hard-deleting
- Conversation upsert now checks for and resurrects soft-deleted records with the same canonical key
- Session resolution now blocks soft-deleted users at request time
- FK cascade rules changed from CASCADE to RESTRICT on soft-deletable parent models
