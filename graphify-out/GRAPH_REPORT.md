# Graph Report - tehsudihfsdhfjsdfbj  (2026-04-23)

## Corpus Check
- 448 files · ~237,344 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1248 nodes · 1342 edges · 49 communities detected
- Extraction: 81% EXTRACTED · 19% INFERRED · 0% AMBIGUOUS · INFERRED: 254 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 75|Community 75]]
- [[_COMMUNITY_Community 76|Community 76]]
- [[_COMMUNITY_Community 88|Community 88]]
- [[_COMMUNITY_Community 89|Community 89]]

## God Nodes (most connected - your core abstractions)
1. `GET()` - 40 edges
2. `handleGoogleOAuthCallback()` - 15 edges
3. `compileDigest()` - 10 edges
4. `sendDraftToSlackWorkflow()` - 9 edges
5. `buildThreadSnapshot()` - 9 edges
6. `githubSettingsPath()` - 9 edges
7. `hybridSearch()` - 8 edges
8. `writeAuditEvent()` - 8 edges
9. `sendReplyWithRecordedAttempt()` - 8 edges
10. `resolveSlackBotToken()` - 8 edges

## Surprising Connections (you probably didn't know these)
- `restoreAnalysisContext()` --calls--> `loadAnalysisContext()`  [INFERRED]
  packages/types/src/support/state-machines/analysis-state-machine.ts → apps/queue/src/domains/support/support-analysis.activity.ts
- `reciprocalRankFusion()` --calls--> `GET()`  [INFERRED]
  packages/rest/src/codex/hybrid-search.ts → apps/web/src/app/api/auth/google/start/route.ts
- `disconnectGithubInstallation()` --calls--> `disconnectGitHubAction()`  [INFERRED]
  packages/rest/src/codex/github/installation.ts → apps/web/src/app/[workspaceId]/settings/github/actions.ts
- `handleGithubInstallationCallback()` --calls--> `handleGithubOAuthCallback()`  [INFERRED]
  packages/rest/src/codex/github/installation.ts → apps/web/src/server/http/rest/codex/github-oauth-callback.ts
- `consumeOauthStateCookie()` --calls--> `GET()`  [INFERRED]
  packages/rest/src/security/oauth-state.ts → apps/web/src/app/api/auth/google/start/route.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.03
Nodes (50): extractApiKeyPrefix(), generateWorkspaceApiKeyMaterial(), hashApiKeySecret(), verifyApiKeySecret(), createTRPCContext(), resolveApiKeyAuth(), resolveWorkspaceContext(), locationOf() (+42 more)

### Community 1 - "Community 1"
Cohesion: 0.05
Nodes (26): captureClicks(), captureConsoleErrors(), captureExceptions(), captureNetworkFailures(), captureRouteChanges(), currentUrl(), pushEvent(), startCapture() (+18 more)

### Community 2 - "Community 2"
Cohesion: 0.08
Nodes (41): buildReturnPath(), disconnectGitHubAction(), getActionErrorMessage(), getString(), githubSettingsPath(), preparePrIntentAction(), refreshGitHubReposAction(), searchEvidenceAction() (+33 more)

### Community 3 - "Community 3"
Cohesion: 0.08
Nodes (32): InvalidDraftDispatchTransitionError, restoreDraftDispatchContext(), transitionDraftDispatch(), InvalidDraftTransitionError, restoreDraftContext(), transitionDraft(), loadDispatch(), loadDraft() (+24 more)

### Community 4 - "Community 4"
Cohesion: 0.09
Nodes (28): fetchFileContents(), fetchLatestCommitSha(), fetchRepoTree(), createDraftPullRequest(), tryGetFileSha(), formatVector(), generate(), getCached() (+20 more)

### Community 5 - "Community 5"
Cohesion: 0.09
Nodes (27): buildAuthorizationUrl(), autoJoinUserFromVerifiedGoogleProfile(), buildRedirectUri(), determineOutcome(), handleGoogleOAuthCallback(), handleGoogleOAuthStart(), redirectToLogin(), resolveWorkspaceAfterLogin() (+19 more)

### Community 6 - "Community 6"
Cohesion: 0.09
Nodes (25): createSupportAgent(), extractToolCalls(), getDefaultModel(), parseAgentOutput(), resolveProviderConfig(), runAnalysis(), renderPromptDocument(), renderPromptSection() (+17 more)

### Community 7 - "Community 7"
Cohesion: 0.1
Nodes (22): InvalidAnalysisTransitionError, restoreAnalysisContext(), transitionAnalysis(), extractEmails(), findByEmails(), buildSnapshot(), buildThreadSnapshot(), callAgentService() (+14 more)

### Community 8 - "Community 8"
Cohesion: 0.09
Nodes (15): extractRawFiles(), isRecord(), normalizeSlackMessageEvent(), readString(), shouldDropIngressEvent(), fetchEmail(), getCachedProfile(), refreshProfile() (+7 more)

### Community 9 - "Community 9"
Cohesion: 0.09
Nodes (12): ConversationView(), NoWorkspacePage(), useAnalysis(), useAuthSession(), useConversationPolling(), useConversationReply(), useEventReassign(), useReassignCandidates() (+4 more)

### Community 10 - "Community 10"
Cohesion: 0.09
Nodes (11): run(), main(), requireEnv(), main(), main(), main(), requireEnv(), buildTemporalConnectionOptions() (+3 more)

### Community 11 - "Community 11"
Cohesion: 0.13
Nodes (17): writeAuditEvent(), handleSlackOAuthCallback(), redirectToSettings(), base64UrlDecode(), base64UrlEncode(), completeInstall(), disconnect(), exchangeCode() (+9 more)

### Community 12 - "Community 12"
Cohesion: 0.15
Nodes (16): assign(), extractEventThreadTs(), extractSlackMessageTs(), loadConversationDeliveryContext(), loadReplyPayloadForCommand(), normalizeReplyPayload(), resolveDeliveryThreadTs(), retryDelivery() (+8 more)

### Community 13 - "Community 13"
Cohesion: 0.12
Nodes (6): createConversationContext(), InvalidConversationTransitionError, restoreConversationContext(), transitionConversation(), tryConversationTransition(), ctx()

### Community 14 - "Community 14"
Cohesion: 0.17
Nodes (12): WorkspaceHomePage(), WorkspaceSettingsPage(), replaceWorkspaceInPath(), workspaceAiAnalysisPath(), workspaceApiKeysPath(), workspaceGeneralPath(), workspaceGithubPath(), workspaceIntegrationsPath() (+4 more)

### Community 15 - "Community 15"
Cohesion: 0.29
Nodes (11): assertReplayWindow(), buildSlackBaseString(), computeSlackSignature(), getSlackSigningSecret(), toBuffer(), verifyRequest(), buildCanonicalIdempotencyKey(), extractRoutingFields() (+3 more)

### Community 16 - "Community 16"
Cohesion: 0.18
Nodes (5): Input(), buildRouter(), createAppRouter(), createSupportAnalysisRouter(), workspaceRoleProcedure()

### Community 17 - "Community 17"
Cohesion: 0.26
Nodes (9): handleGithubOAuthCallback(), redirectToSettings(), base64UrlDecode(), base64UrlEncode(), generateGithubInstallUrl(), getSigningKey(), hmacSign(), verifyAndDecodeGithubState() (+1 more)

### Community 18 - "Community 18"
Cohesion: 0.23
Nodes (8): computeCutoff(), countSoftDeletedRecords(), hardDeleteById(), lowerFirst(), purgeDeletedRecords(), runPurgeDeletedRecords(), purgeDeletedRecords(), purgeDeletedRecordsWorkflow()

### Community 19 - "Community 19"
Cohesion: 0.2
Nodes (4): decodeBase64Chunk(), extractOriginalViewport(), fitInside(), initPlayer()

### Community 20 - "Community 20"
Cohesion: 0.35
Nodes (9): aggregateErrors(), buildLastActions(), compileDigest(), extractConsoleErrors(), extractNetworkFailures(), extractRouteHistory(), extractRouteUrl(), findFailurePoint() (+1 more)

### Community 21 - "Community 21"
Cohesion: 0.29
Nodes (7): jsonWithCors(), sessionCorsHeaders(), withCorsHeaders(), handleSessionIngest(), handleSessionIngestOptions(), handleReplayChunk(), handleReplayChunkOptions()

### Community 22 - "Community 22"
Cohesion: 0.42
Nodes (8): buildTrpcQueryUrl(), getStoredCsrfToken(), logTrpcHttp(), nowMs(), resolveErrorMessage(), resolveTrpcData(), trpcMutation(), trpcQuery()

### Community 23 - "Community 23"
Cohesion: 0.22
Nodes (4): ConflictError, PermanentExternalError, TransientExternalError, ValidationError

### Community 24 - "Community 24"
Cohesion: 0.33
Nodes (6): createWithPassword(), findAuthByEmail(), findIdentityByEmail(), normalizeEmail(), getGoogleJwks(), verifyIdToken()

### Community 25 - "Community 25"
Cohesion: 0.22
Nodes (2): SummaryCards(), formatDurationMs()

### Community 26 - "Community 26"
Cohesion: 0.25
Nodes (2): handleAddMember(), handleUpdateRole()

### Community 27 - "Community 27"
Cohesion: 0.25
Nodes (2): buildSessionDigestFixture(), reconstructSessionDigest()

### Community 28 - "Community 28"
Cohesion: 0.46
Nodes (7): anchorize(), collectMarkdownFiles(), extractAnchors(), isExternal(), main(), splitAnchor(), walk()

### Community 30 - "Community 30"
Cohesion: 0.33
Nodes (2): SidebarMenuButton(), useSidebar()

### Community 33 - "Community 33"
Cohesion: 0.6
Nodes (5): containsAny(), firstLines(), main(), maskDatabaseUrl(), runPrismaStatus()

### Community 44 - "Community 44"
Cohesion: 0.4
Nodes (2): handleSubmit(), loginUser()

### Community 45 - "Community 45"
Cohesion: 0.67
Nodes (2): createMockClient(), createRealisticDelegate()

### Community 46 - "Community 46"
Cohesion: 0.67
Nodes (2): createMockDelegate(), createMockRawClient()

### Community 47 - "Community 47"
Cohesion: 0.67
Nodes (2): applySoftDeleteFilter(), isSoftDeleteModel()

### Community 48 - "Community 48"
Cohesion: 0.83
Nodes (3): createWorkspaceForUser(), main(), parseArgs()

### Community 49 - "Community 49"
Cohesion: 0.5
Nodes (1): InvalidFsmTransitionError

### Community 50 - "Community 50"
Cohesion: 0.67
Nodes (2): buildCookieValue(), hmacHex()

### Community 51 - "Community 51"
Cohesion: 0.83
Nodes (3): base64UrlEncode(), buildState(), hmacSign()

### Community 55 - "Community 55"
Cohesion: 0.67
Nodes (2): buildCustomerProfileMap(), getConversationTimeline()

### Community 56 - "Community 56"
Cohesion: 0.5
Nodes (2): sweepStaleDraftDispatches(), sendDraftSweepWorkflow()

### Community 62 - "Community 62"
Cohesion: 0.67
Nodes (2): handleOpenGitHub(), openGitHubPopup()

### Community 68 - "Community 68"
Cohesion: 0.83
Nodes (3): LoginPage(), parseGoogleStatus(), translateGoogleStatus()

### Community 69 - "Community 69"
Cohesion: 0.5
Nodes (2): RequestAccessForm(), useWorkspaceAccessRequest()

### Community 70 - "Community 70"
Cohesion: 0.83
Nodes (3): main(), parseFrontmatter(), stripQuotes()

### Community 75 - "Community 75"
Cohesion: 0.67
Nodes (1): robots()

### Community 76 - "Community 76"
Cohesion: 0.67
Nodes (1): RootLayout()

### Community 88 - "Community 88"
Cohesion: 1.0
Nodes (2): formatAnnotationTime(), SystemAnnotation()

### Community 89 - "Community 89"
Cohesion: 1.0
Nodes (2): ConfidenceBadge(), getConfidenceLevel()

## Knowledge Gaps
- **Thin community `Community 25`** (9 nodes): `summary-cards.tsx`, `timeline-utils.ts`, `SummaryCards()`, `computeTimelineRange()`, `formatDurationMs()`, `formatFullDate()`, `formatShortDate()`, `generateDateMarkers()`, `isOpen()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 26`** (9 nodes): `page.tsx`, `page.tsx`, `handleAddMember()`, `handleCopyId()`, `handleRename()`, `handleSwitch()`, `handleUpdateRole()`, `roleBadgeClass()`, `roleDescription()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 27`** (8 nodes): `prompt-format-benchmark-fixtures.test.ts`, `session-digest.ts`, `buildSessionDigestFixture()`, `parseAction()`, `parseConsoleEntry()`, `parseError()`, `parseNetworkFailure()`, `reconstructSessionDigest()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 30`** (7 nodes): `sidebar.tsx`, `cn()`, `handleKeyDown()`, `SidebarMenu()`, `SidebarMenuButton()`, `SidebarMenuItem()`, `useSidebar()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 44`** (5 nodes): `login-form.tsx`, `sdk.ts`, `handleSubmit()`, `initSDK()`, `loginUser()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 45`** (4 nodes): `createMockClient()`, `createRealisticDelegate()`, `load()`, `hard-delete-integration.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 46`** (4 nodes): `createMockDelegate()`, `createMockRawClient()`, `importHardDelete()`, `hard-delete.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 47`** (4 nodes): `soft-delete.ts`, `applySoftDeleteFilter()`, `isSoftDeleteModel()`, `lowerFirst()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 49`** (4 nodes): `defineFsm()`, `InvalidFsmTransitionError`, `.constructor()`, `fsm.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 50`** (4 nodes): `buildCookieValue()`, `buildRequestWithCookie()`, `hmacHex()`, `oauth-state.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 55`** (4 nodes): `support-projection-service.ts`, `buildCustomerProfileMap()`, `getConversationTimeline()`, `listConversations()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 56`** (4 nodes): `send-draft-sweep.activity.ts`, `send-draft-sweep.workflow.ts`, `sweepStaleDraftDispatches()`, `sendDraftSweepWorkflow()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 62`** (4 nodes): `github-connection-section.tsx`, `handleOpenGitHub()`, `openGitHubPopup()`, `StatusBadge()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 69`** (4 nodes): `request-access-form.tsx`, `use-workspace-access-request.ts`, `RequestAccessForm()`, `useWorkspaceAccessRequest()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 75`** (3 nodes): `robots.ts`, `robots.ts`, `robots()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 76`** (3 nodes): `layout.tsx`, `layout.tsx`, `RootLayout()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 88`** (3 nodes): `system-annotation.tsx`, `formatAnnotationTime()`, `SystemAnnotation()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 89`** (3 nodes): `confidence-badge.tsx`, `ConfidenceBadge()`, `getConfidenceLevel()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `GET()` connect `Community 0` to `Community 1`, `Community 2`, `Community 4`, `Community 5`, `Community 11`, `Community 17`, `Community 20`, `Community 28`?**
  _High betweenness centrality (0.136) - this node is a cross-community bridge._
- **Why does `emitConversationChanged()` connect `Community 12` to `Community 0`, `Community 8`, `Community 3`?**
  _High betweenness centrality (0.046) - this node is a cross-community bridge._
- **Why does `reciprocalRankFusion()` connect `Community 4` to `Community 0`?**
  _High betweenness centrality (0.038) - this node is a cross-community bridge._
- **Are the 31 inferred relationships involving `GET()` (e.g. with `resolveApiKeyAuth()` and `reciprocalRankFusion()`) actually correct?**
  _`GET()` has 31 INFERRED edges - model-reasoned connections that need verification._
- **Are the 10 inferred relationships involving `handleGoogleOAuthCallback()` (e.g. with `GET()` and `consumeOauthStateCookie()`) actually correct?**
  _`handleGoogleOAuthCallback()` has 10 INFERRED edges - model-reasoned connections that need verification._
- **Are the 6 inferred relationships involving `sendDraftToSlackWorkflow()` (e.g. with `markDraftSending()` and `sendDraftActivity()`) actually correct?**
  _`sendDraftToSlackWorkflow()` has 6 INFERRED edges - model-reasoned connections that need verification._
- **Are the 5 inferred relationships involving `buildThreadSnapshot()` (e.g. with `fetchEmail()` and `extractEmails()`) actually correct?**
  _`buildThreadSnapshot()` has 5 INFERRED edges - model-reasoned connections that need verification._