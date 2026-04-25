# Graph Report - tehsudihfsdhfjsdfbj  (2026-04-25)

## Corpus Check
- 555 files · ~293,976 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1611 nodes · 1922 edges · 52 communities detected
- Extraction: 77% EXTRACTED · 23% INFERRED · 0% AMBIGUOUS · INFERRED: 438 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 75|Community 75]]
- [[_COMMUNITY_Community 76|Community 76]]
- [[_COMMUNITY_Community 83|Community 83]]
- [[_COMMUNITY_Community 84|Community 84]]
- [[_COMMUNITY_Community 94|Community 94]]
- [[_COMMUNITY_Community 96|Community 96]]

## God Nodes (most connected - your core abstractions)
1. `GET()` - 56 edges
2. `update()` - 48 edges
3. `create()` - 33 edges
4. `handleGoogleOAuthCallback()` - 15 edges
5. `add()` - 14 edges
6. `getConversationSessionContext()` - 14 edges
7. `resolveConversationIdentity()` - 14 edges
8. `runTeamTurn()` - 13 edges
9. `compileDigest()` - 12 edges
10. `agentTeamRunWorkflow()` - 11 edges

## Surprising Connections (you probably didn't know these)
- `computeRunRollup()` --calls--> `GET()`  [INFERRED]
  packages/rest/src/services/agent-team/run-event-service.ts → apps/web/src/app/api/slack/oauth/callback/route.ts
- `main()` --calls--> `GET()`  [INFERRED]
  scripts/check-docs-links.mjs → apps/web/src/app/api/slack/oauth/callback/route.ts
- `sendWithRetry()` --calls--> `GET()`  [INFERRED]
  packages/sdk-browser/src/transport.ts → apps/web/src/app/api/slack/oauth/callback/route.ts
- `canRouteTo()` --calls--> `assertValidMessageRouting()`  [INFERRED]
  packages/types/src/agent-team/agent-team-routing-policy.ts → apps/queue/src/domains/agent-team/agent-team-run-routing.ts
- `restoreAnalysisContext()` --calls--> `loadAnalysisContext()`  [INFERRED]
  packages/types/src/support/state-machines/analysis-state-machine.ts → apps/queue/src/domains/support/support-analysis.activity.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.02
Nodes (70): buildRoleExecutionBatches(), extractApiKeyPrefix(), generateWorkspaceApiKeyMaterial(), hashApiKeySecret(), verifyApiKeySecret(), createTRPCContext(), resolveApiKeyAuth(), resolveWorkspaceContext() (+62 more)

### Community 1 - "Community 1"
Cohesion: 0.04
Nodes (61): InvalidDraftDispatchTransitionError, restoreDraftDispatchContext(), transitionDraftDispatch(), InvalidDraftTransitionError, restoreDraftContext(), transitionDraft(), findOrCreateUserFromProfile(), run() (+53 more)

### Community 2 - "Community 2"
Cohesion: 0.04
Nodes (58): buildTeamTurnUserMessage(), buildToolTraceMessages(), resolveProviderConfig(), createAgentForRole(), extractToolCalls(), formatDialogueMessages(), logLocalAgentDebug(), logToolUsage() (+50 more)

### Community 3 - "Community 3"
Cohesion: 0.05
Nodes (29): captureClicks(), captureConsoleErrors(), captureExceptions(), captureNetworkFailures(), captureRouteChanges(), currentUrl(), pushEvent(), startCapture() (+21 more)

### Community 4 - "Community 4"
Cohesion: 0.06
Nodes (33): isRoleTarget(), canRouteTo(), buildOpenQuestionRow(), claimNextQueuedInbox(), getRunProgress(), getRunProgressSnapshot(), initializeRunState(), loadTurnContext() (+25 more)

### Community 5 - "Community 5"
Cohesion: 0.08
Nodes (40): buildReturnPath(), disconnectGitHubAction(), getActionErrorMessage(), getString(), githubSettingsPath(), preparePrIntentAction(), refreshGitHubReposAction(), searchEvidenceAction() (+32 more)

### Community 6 - "Community 6"
Cohesion: 0.07
Nodes (34): assign(), writeAuditEvent(), closeAsNoAction(), extractEventThreadTs(), extractSlackMessageTs(), loadConversationDeliveryContext(), loadReplyPayloadForCommand(), normalizeReplyPayload() (+26 more)

### Community 7 - "Community 7"
Cohesion: 0.09
Nodes (32): buildAuthorizationUrl(), autoJoinUserFromVerifiedGoogleProfile(), buildRedirectUri(), determineOutcome(), handleGoogleOAuthCallback(), handleGoogleOAuthStart(), redirectToLogin(), resolveWorkspaceAfterLogin() (+24 more)

### Community 8 - "Community 8"
Cohesion: 0.08
Nodes (28): anchorize(), collectMarkdownFiles(), extractAnchors(), isExternal(), main(), splitAnchor(), walk(), createConsentManager() (+20 more)

### Community 9 - "Community 9"
Cohesion: 0.13
Nodes (34): asRecord(), attachSessionToConversation(), buildConversationSessionContext(), buildSessionBrief(), buildSessionCandidate(), chooseBestEmailIdentity(), clearPrimaryMatch(), currentIdentityIsStrong() (+26 more)

### Community 10 - "Community 10"
Cohesion: 0.09
Nodes (16): extractRawFiles(), isRecord(), normalizeSlackMessageEvent(), readString(), shouldDropIngressEvent(), fetchEmail(), getCachedProfile(), refreshProfile() (+8 more)

### Community 11 - "Community 11"
Cohesion: 0.11
Nodes (20): InvalidAnalysisTransitionError, restoreAnalysisContext(), transitionAnalysis(), findByEmails(), buildSnapshot(), buildThreadSnapshot(), callAgentService(), emitAnalysisCompletedEvent() (+12 more)

### Community 12 - "Community 12"
Cohesion: 0.08
Nodes (12): ConversationView(), NoWorkspacePage(), useAnalysis(), useAuthSession(), useConversationPolling(), useConversationReply(), useEventReassign(), useReassignCandidates() (+4 more)

### Community 13 - "Community 13"
Cohesion: 0.12
Nodes (19): createSupportAgent(), renderPromptDocument(), renderPromptSection(), renderProseSection(), resolveModel(), hasUniformPrimitiveArray(), hasUniformPrimitiveObjectArray(), isRecord() (+11 more)

### Community 14 - "Community 14"
Cohesion: 0.12
Nodes (15): generate(), fetchFileContents(), fetchLatestCommitSha(), fetchRepoTree(), createDraftPullRequest(), tryGetFileSha(), buildChunkContent(), chunkFile() (+7 more)

### Community 15 - "Community 15"
Cohesion: 0.12
Nodes (6): createConversationContext(), InvalidConversationTransitionError, restoreConversationContext(), transitionConversation(), tryConversationTransition(), ctx()

### Community 16 - "Community 16"
Cohesion: 0.16
Nodes (13): WorkspaceHomePage(), WorkspaceSettingsPage(), replaceWorkspaceInPath(), workspaceAgentTeamPath(), workspaceAiAnalysisPath(), workspaceApiKeysPath(), workspaceGeneralPath(), workspaceGithubPath() (+5 more)

### Community 17 - "Community 17"
Cohesion: 0.22
Nodes (13): processSlackWebhookFromHttpRequest(), handleSlackEventsWebhook(), assertReplayWindow(), buildSlackBaseString(), computeSlackSignature(), getSlackSigningSecret(), toBuffer(), verifyRequest() (+5 more)

### Community 18 - "Community 18"
Cohesion: 0.29
Nodes (13): addReaction(), buildSlackMessageText(), findReplyByClientMsgId(), formatAttachmentLines(), isRecord(), isTransientSlackError(), readString(), removeReaction() (+5 more)

### Community 19 - "Community 19"
Cohesion: 0.18
Nodes (6): createAgentTeamRouter(), Input(), buildRouter(), createAppRouter(), createSupportAnalysisRouter(), workspaceRoleProcedure()

### Community 20 - "Community 20"
Cohesion: 0.25
Nodes (11): archiveAgentTeamEvents(), archiveAndDropPartition(), assertSafePartitionName(), cutoffDate(), isoDate(), listPartitions(), logSkippedPartition(), readPartitionBatch() (+3 more)

### Community 21 - "Community 21"
Cohesion: 0.18
Nodes (4): decodeBase64Chunk(), extractOriginalViewport(), fitInside(), initPlayer()

### Community 22 - "Community 22"
Cohesion: 0.26
Nodes (9): handleGithubOAuthCallback(), redirectToSettings(), base64UrlDecode(), base64UrlEncode(), generateGithubInstallUrl(), getSigningKey(), hmacSign(), verifyAndDecodeGithubState() (+1 more)

### Community 23 - "Community 23"
Cohesion: 0.23
Nodes (8): computeCutoff(), countSoftDeletedRecords(), hardDeleteById(), lowerFirst(), purgeDeletedRecords(), runPurgeDeletedRecords(), purgeDeletedRecords(), purgeDeletedRecordsWorkflow()

### Community 24 - "Community 24"
Cohesion: 0.2
Nodes (4): buildInitialNodePositions(), computeAutoLayout(), hasStoredLayout(), buildFlowNodes()

### Community 25 - "Community 25"
Cohesion: 0.29
Nodes (7): jsonWithCors(), sessionCorsHeaders(), withCorsHeaders(), handleSessionIngest(), handleSessionIngestOptions(), handleReplayChunk(), handleReplayChunkOptions()

### Community 26 - "Community 26"
Cohesion: 0.42
Nodes (8): buildTrpcQueryUrl(), getStoredCsrfToken(), logTrpcHttp(), nowMs(), resolveErrorMessage(), resolveTrpcData(), trpcMutation(), trpcQuery()

### Community 27 - "Community 27"
Cohesion: 0.22
Nodes (4): ConflictError, PermanentExternalError, TransientExternalError, ValidationError

### Community 28 - "Community 28"
Cohesion: 0.22
Nodes (2): SummaryCards(), formatDurationMs()

### Community 29 - "Community 29"
Cohesion: 0.25
Nodes (2): handleAddMember(), handleUpdateRole()

### Community 30 - "Community 30"
Cohesion: 0.25
Nodes (2): buildSessionDigestFixture(), reconstructSessionDigest()

### Community 31 - "Community 31"
Cohesion: 0.29
Nodes (4): if(), handleOpenGitHub(), openGitHubPopup(), StatusBadge()

### Community 32 - "Community 32"
Cohesion: 0.36
Nodes (6): getAgentRoleColor(), getAgentRoleColorStyle(), getAgentRoleTargetColorStyle(), getRoleVisual(), isRoleSlug(), TeamGraphRoleNode()

### Community 34 - "Community 34"
Cohesion: 0.33
Nodes (2): SidebarMenuButton(), useSidebar()

### Community 37 - "Community 37"
Cohesion: 0.6
Nodes (5): containsAny(), firstLines(), main(), maskDatabaseUrl(), runPrismaStatus()

### Community 39 - "Community 39"
Cohesion: 0.47
Nodes (4): previousDayStart(), rollupAgentTeamMetricsForDay(), roundNullable(), agentTeamMetricsRollupWorkflow()

### Community 40 - "Community 40"
Cohesion: 0.33
Nodes (3): AgentTeamPanel(), useAgentTeamRunStream(), useAgentTeamRun()

### Community 51 - "Community 51"
Cohesion: 0.4
Nodes (1): AgentTeamLayoutConflictError

### Community 52 - "Community 52"
Cohesion: 0.4
Nodes (2): handleSubmit(), loginUser()

### Community 53 - "Community 53"
Cohesion: 0.83
Nodes (3): main(), parseFrontmatter(), stripQuotes()

### Community 54 - "Community 54"
Cohesion: 0.67
Nodes (2): createMockClient(), createRealisticDelegate()

### Community 55 - "Community 55"
Cohesion: 0.67
Nodes (2): createMockDelegate(), createMockRawClient()

### Community 56 - "Community 56"
Cohesion: 0.67
Nodes (2): applySoftDeleteFilter(), isSoftDeleteModel()

### Community 57 - "Community 57"
Cohesion: 0.83
Nodes (3): createWorkspaceForUser(), main(), parseArgs()

### Community 58 - "Community 58"
Cohesion: 0.5
Nodes (1): InvalidFsmTransitionError

### Community 68 - "Community 68"
Cohesion: 0.67
Nodes (2): confidenceBadge(), matchSourceLabel()

### Community 75 - "Community 75"
Cohesion: 0.83
Nodes (3): LoginPage(), parseGoogleStatus(), translateGoogleStatus()

### Community 76 - "Community 76"
Cohesion: 0.5
Nodes (2): RequestAccessForm(), useWorkspaceAccessRequest()

### Community 83 - "Community 83"
Cohesion: 0.67
Nodes (1): RootLayout()

### Community 84 - "Community 84"
Cohesion: 0.67
Nodes (1): robots()

### Community 94 - "Community 94"
Cohesion: 1.0
Nodes (2): ConfidenceBadge(), getConfidenceLevel()

### Community 96 - "Community 96"
Cohesion: 1.0
Nodes (2): formatAnnotationTime(), SystemAnnotation()

## Knowledge Gaps
- **Thin community `Community 28`** (9 nodes): `summary-cards.tsx`, `timeline-utils.ts`, `SummaryCards()`, `computeTimelineRange()`, `formatDurationMs()`, `formatFullDate()`, `formatShortDate()`, `generateDateMarkers()`, `isOpen()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 29`** (9 nodes): `page.tsx`, `page.tsx`, `handleAddMember()`, `handleCopyId()`, `handleRename()`, `handleSwitch()`, `handleUpdateRole()`, `roleBadgeClass()`, `roleDescription()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 30`** (8 nodes): `prompt-format-benchmark-fixtures.test.ts`, `session-digest.ts`, `buildSessionDigestFixture()`, `parseAction()`, `parseConsoleEntry()`, `parseError()`, `parseNetworkFailure()`, `reconstructSessionDigest()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 34`** (7 nodes): `sidebar.tsx`, `cn()`, `handleKeyDown()`, `SidebarMenu()`, `SidebarMenuButton()`, `SidebarMenuItem()`, `useSidebar()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 51`** (5 nodes): `use-agent-teams.ts`, `AgentTeamLayoutConflictError`, `.constructor()`, `replaceTeam()`, `useAgentTeams()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 52`** (5 nodes): `login-form.tsx`, `sdk.ts`, `handleSubmit()`, `initSDK()`, `loginUser()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 54`** (4 nodes): `createMockClient()`, `createRealisticDelegate()`, `load()`, `hard-delete-integration.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 55`** (4 nodes): `createMockDelegate()`, `createMockRawClient()`, `importHardDelete()`, `hard-delete.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 56`** (4 nodes): `soft-delete.ts`, `applySoftDeleteFilter()`, `isSoftDeleteModel()`, `lowerFirst()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 58`** (4 nodes): `defineFsm()`, `InvalidFsmTransitionError`, `.constructor()`, `fsm.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 68`** (4 nodes): `session-context-bar.tsx`, `browserLabel()`, `confidenceBadge()`, `matchSourceLabel()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 76`** (4 nodes): `request-access-form.tsx`, `use-workspace-access-request.ts`, `RequestAccessForm()`, `useWorkspaceAccessRequest()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 83`** (3 nodes): `layout.tsx`, `layout.tsx`, `RootLayout()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 84`** (3 nodes): `robots.ts`, `robots.ts`, `robots()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 94`** (3 nodes): `confidence-badge.tsx`, `ConfidenceBadge()`, `getConfidenceLevel()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 96`** (3 nodes): `system-annotation.tsx`, `formatAnnotationTime()`, `SystemAnnotation()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `GET()` connect `Community 0` to `Community 2`, `Community 3`, `Community 4`, `Community 5`, `Community 6`, `Community 7`, `Community 8`, `Community 17`, `Community 22`?**
  _High betweenness centrality (0.097) - this node is a cross-community bridge._
- **Why does `update()` connect `Community 1` to `Community 0`, `Community 2`, `Community 4`, `Community 5`, `Community 6`, `Community 7`, `Community 9`, `Community 10`, `Community 11`, `Community 14`, `Community 17`, `Community 18`, `Community 22`?**
  _High betweenness centrality (0.081) - this node is a cross-community bridge._
- **Why does `resolveApiKeyAuth()` connect `Community 0` to `Community 1`?**
  _High betweenness centrality (0.030) - this node is a cross-community bridge._
- **Are the 46 inferred relationships involving `GET()` (e.g. with `main()` and `sendWithRetry()`) actually correct?**
  _`GET()` has 46 INFERRED edges - model-reasoned connections that need verification._
- **Are the 45 inferred relationships involving `update()` (e.g. with `softUpsert()` and `main()`) actually correct?**
  _`update()` has 45 INFERRED edges - model-reasoned connections that need verification._
- **Are the 31 inferred relationships involving `create()` (e.g. with `softUpsert()` and `main()`) actually correct?**
  _`create()` has 31 INFERRED edges - model-reasoned connections that need verification._
- **Are the 10 inferred relationships involving `handleGoogleOAuthCallback()` (e.g. with `GET()` and `consumeOauthStateCookie()`) actually correct?**
  _`handleGoogleOAuthCallback()` has 10 INFERRED edges - model-reasoned connections that need verification._