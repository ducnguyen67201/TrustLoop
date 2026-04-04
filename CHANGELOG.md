# Changelog

All notable changes to TrustLoop will be documented in this file.

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
