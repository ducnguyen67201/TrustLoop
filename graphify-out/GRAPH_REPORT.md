# Graph Report - tehsudihfsdhfjsdfbj  (2026-05-03)

## Corpus Check
- 564 files · ~302,689 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2719 nodes · 4230 edges · 50 communities detected
- Extraction: 85% EXTRACTED · 15% INFERRED · 0% AMBIGUOUS · INFERRED: 651 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]

## God Nodes (most connected - your core abstractions)
1. `GET()` - 58 edges
2. `update()` - 48 edges
3. `cn()` - 38 edges
4. `create()` - 33 edges
5. `Badge()` - 30 edges
6. `trpcQuery()` - 25 edges
7. `trpcMutation()` - 23 edges
8. `Alert()` - 17 edges
9. `CardContent()` - 17 edges
10. `useAuthSession()` - 15 edges

## Surprising Connections (you probably didn't know these)
- `computeRunRollup()` --calls--> `GET()`  [INFERRED]
  packages/rest/src/services/agent-team/run-event-service.ts → apps/web/src/app/api/slack/oauth/callback/route.ts
- `readFileData()` --calls--> `GET()`  [INFERRED]
  packages/rest/src/services/support/support-attachment-service.ts → apps/web/src/app/api/slack/oauth/callback/route.ts
- `consumeIngestAttempt()` --calls--> `GET()`  [INFERRED]
  packages/rest/src/security/ingest-rate-limit.ts → apps/web/src/app/api/slack/oauth/callback/route.ts
- `extractBearerToken()` --calls--> `GET()`  [INFERRED]
  packages/rest/src/security/rest-auth.ts → apps/web/src/app/api/slack/oauth/callback/route.ts
- `shouldFlushLastUsedAt()` --calls--> `GET()`  [INFERRED]
  packages/rest/src/security/rest-auth.ts → apps/web/src/app/api/slack/oauth/callback/route.ts

## Communities (237 total, 3 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.02
Nodes (128): main(), registerAgentTeamArchiveSchedule(), main(), registerAgentTeamMetricsRollupSchedule(), create(), get(), list(), mapTeam() (+120 more)

### Community 1 - "Community 1"
Cohesion: 0.02
Nodes (126): AgentTeamPanelPreviewPage(), add(), buildUniqueRoleKey(), isUniqueConstraintError(), updateLayout(), buildRoleExecutionBatches(), NotFound(), buildRedirectUri() (+118 more)

### Community 2 - "Community 2"
Cohesion: 0.02
Nodes (47): getAgentRoleColor(), getAgentRoleColorStyle(), getAgentRoleTargetColorStyle(), getRoleVisual(), isRoleSlug(), TeamGraphRoleNode(), RootLayout(), ConfidenceBadge() (+39 more)

### Community 3 - "Community 3"
Cohesion: 0.02
Nodes (62): AgentTeamPanel(), ConversationView(), useActiveWorkspace(), useAgentTeamRunStream(), useAgentTeamRun(), useAgentTeams(), useAnalysis(), useAuthSession() (+54 more)

### Community 4 - "Community 4"
Cohesion: 0.02
Nodes (13): AddRoleDialog(), CreateTeamDialog(), useWorkspaceAccessRequest(), cn(), RequestAccessForm(), SupportStatusBadge(), Checkbox(), Input() (+5 more)

### Community 5 - "Community 5"
Cohesion: 0.04
Nodes (94): buildReturnPath(), disconnectGitHubAction(), getActionErrorMessage(), getString(), githubSettingsPath(), preparePrIntentAction(), refreshGitHubReposAction(), searchEvidenceAction() (+86 more)

### Community 6 - "Community 6"
Cohesion: 0.03
Nodes (71): captureClicks(), captureConsoleErrors(), captureExceptions(), captureNetworkFailures(), captureRouteChanges(), currentUrl(), pushEvent(), startCapture() (+63 more)

### Community 7 - "Community 7"
Cohesion: 0.03
Nodes (77): isRoleTarget(), canRouteTo(), listAllowedTargets(), buildOpenQuestionRow(), getRunProgress(), getRunProgressSnapshot(), initializeRunState(), isHumanResolutionMessage() (+69 more)

### Community 8 - "Community 8"
Cohesion: 0.05
Nodes (87): aggregateErrors(), buildLastActions(), compileDigest(), extractConsoleErrors(), extractNetworkFailures(), extractRouteHistory(), extractRouteUrl(), findFailurePoint() (+79 more)

### Community 9 - "Community 9"
Cohesion: 0.04
Nodes (72): buildTeamTurnUserMessage(), buildToolTraceMessages(), resolveProviderConfig(), createAgentForRole(), createSupportAgent(), extractToolCalls(), formatDialogueMessages(), logLocalAgentDebug() (+64 more)

### Community 10 - "Community 10"
Cohesion: 0.04
Nodes (54): getCached(), parseVector(), computePathBonus(), embedQuery(), hybridSearch(), keywordSearch(), reciprocalRankFusion(), rerankWithLlm() (+46 more)

### Community 11 - "Community 11"
Cohesion: 0.03
Nodes (43): ConflictError, PermanentExternalError, TransientExternalError, ValidationError, extractRawFiles(), isRecord(), normalizeSlackMessageEvent(), readString() (+35 more)

### Community 12 - "Community 12"
Cohesion: 0.04
Nodes (41): useIsMobile(), workspaceAgentTeamPath(), workspaceAiAnalysisPath(), workspaceApiKeysPath(), workspaceGeneralPath(), workspaceGithubPath(), workspaceInsightsPath(), workspaceIntegrationsPath() (+33 more)

### Community 13 - "Community 13"
Cohesion: 0.06
Nodes (46): assign(), closeAsNoAction(), extractEventThreadTs(), extractSlackMessageTs(), loadConversationDeliveryContext(), loadReplyPayloadForCommand(), normalizeReplyPayload(), resolveDeliveryThreadTs() (+38 more)

### Community 14 - "Community 14"
Cohesion: 0.05
Nodes (17): if(), ConversationInsightsPanel(), isInsightsTab(), StatusBadge(), handleCopy(), matchSourceLabel(), withMatchContext(), StatusBadge() (+9 more)

### Community 15 - "Community 15"
Cohesion: 0.07
Nodes (43): add(), assertAcyclic(), assertEdgeDoesNotExist(), assertRolesBelongToTeam(), isUniqueConstraintError(), buildThreadSnapshot(), resumeRun(), anchorize() (+35 more)

### Community 16 - "Community 16"
Cohesion: 0.05
Nodes (8): formatFileSize(), avatarColor(), senderInitials(), CustomerProfileProvider(), useCurrentUser(), useCustomerProfile(), Avatar(), AvatarFallback()

### Community 17 - "Community 17"
Cohesion: 0.07
Nodes (29): generate(), buildChunkContent(), chunkFile(), hashContent(), languageFromFilePath(), markSyncRequestFailed(), runRepositoryIndexPipeline(), windowChunks() (+21 more)

### Community 18 - "Community 18"
Cohesion: 0.06
Nodes (22): extractApiKeyPrefix(), generateWorkspaceApiKeyMaterial(), hashApiKeySecret(), verifyApiKeySecret(), codexJsonResponse(), createTRPCContext(), resolveApiKeyAuth(), resolveWorkspaceContext() (+14 more)

### Community 19 - "Community 19"
Cohesion: 0.08
Nodes (25): writeAuditEvent(), writeAuditEvent(), base64UrlDecode(), base64UrlEncode(), disconnect(), generateAuthorizeUrl(), getSigningKey(), hmacSign() (+17 more)

### Community 20 - "Community 20"
Cohesion: 0.07
Nodes (12): createConversationContext(), InvalidConversationTransitionError, restoreConversationContext(), transitionConversation(), tryConversationTransition(), createConversationContext(), InvalidConversationTransitionError, restoreConversationContext() (+4 more)

### Community 21 - "Community 21"
Cohesion: 0.11
Nodes (22): renderPromptSection(), renderProseSection(), serializeAsJson(), renderPromptSection(), renderProseSection(), hasUniformPrimitiveArray(), hasUniformPrimitiveObjectArray(), isRecord() (+14 more)

### Community 22 - "Community 22"
Cohesion: 0.14
Nodes (28): reconcileDraftActivity(), sendDraftActivity(), addReaction(), buildSlackMessageText(), findReplyByClientMsgId(), formatAttachmentLines(), isRecord(), isTransientSlackError() (+20 more)

### Community 23 - "Community 23"
Cohesion: 0.1
Nodes (9): buildInitialNodePositions(), computeAutoLayout(), hasStoredLayout(), buildFlowNodes(), AgentTeamLayoutConflictError, buildInitialNodePositions(), computeAutoLayout(), hasStoredLayout() (+1 more)

### Community 24 - "Community 24"
Cohesion: 0.15
Nodes (20): jsonWithCors(), sessionCorsHeaders(), withCorsHeaders(), handleSessionIngest(), handleSessionIngestOptions(), consumeIngestAttempt(), handleReplayChunk(), handleReplayChunkOptions() (+12 more)

### Community 25 - "Community 25"
Cohesion: 0.14
Nodes (21): archiveAgentTeamEvents(), archiveAndDropPartition(), assertSafePartitionName(), cutoffDate(), isoDate(), listPartitions(), logSkippedPartition(), readPartitionBatch() (+13 more)

### Community 26 - "Community 26"
Cohesion: 0.16
Nodes (22): assertReplayWindow(), buildSlackBaseString(), computeSlackSignature(), getSlackSigningSecret(), toBuffer(), verifyRequest(), buildCanonicalIdempotencyKey(), extractRoutingFields() (+14 more)

### Community 27 - "Community 27"
Cohesion: 0.1
Nodes (9): decodeBase64Chunk(), extractOriginalViewport(), fitInside(), initPlayer(), decodeBase64Chunk(), extractOriginalViewport(), fitInside(), RrwebPlayerView() (+1 more)

### Community 28 - "Community 28"
Cohesion: 0.1
Nodes (9): LoginForm(), ProductMetricsGrid(), LoginPage(), parseGoogleStatus(), translateGoogleStatus(), LoginPage(), parseGoogleStatus(), translateGoogleStatus() (+1 more)

### Community 29 - "Community 29"
Cohesion: 0.14
Nodes (13): computeCutoff(), countSoftDeletedRecords(), hardDeleteById(), lowerFirst(), purgeDeletedRecords(), runPurgeDeletedRecords(), purgeDeletedRecords(), purgeDeletedRecordsWorkflow() (+5 more)

### Community 30 - "Community 30"
Cohesion: 0.14
Nodes (11): createAgentTeamRouter(), Input(), buildRouter(), createAppRouter(), createAgentTeamRouter(), createAppRouter(), createSupportAnalysisRouter(), workspaceRoleProcedure() (+3 more)

### Community 31 - "Community 31"
Cohesion: 0.1
Nodes (5): CtaSection(), Footer(), Hero(), Nav(), TrustSection()

### Community 32 - "Community 32"
Cohesion: 0.29
Nodes (17): buildCopyText(), buildLastActions(), buildSupportEvidence(), capText(), compactLines(), describeAction(), findLastRoute(), isAfter() (+9 more)

### Community 33 - "Community 33"
Cohesion: 0.19
Nodes (12): getGoogleJwks(), verifyIdToken(), createWithPassword(), findAuthByEmail(), findIdentityByEmail(), normalizeEmail(), createWithPassword(), findAuthByEmail() (+4 more)

### Community 34 - "Community 34"
Cohesion: 0.16
Nodes (4): reconstructSessionDigest(), buildSessionDigestFixture(), reconstructSessionDigest(), buildSessionDigestFixture()

### Community 35 - "Community 35"
Cohesion: 0.28
Nodes (12): buildConversationSnapshot(), findTeam(), getLatestRunForConversation(), getRun(), mapRun(), start(), buildConversationSnapshot(), findTeam() (+4 more)

### Community 36 - "Community 36"
Cohesion: 0.2
Nodes (6): handleSubmit(), SDKProvider(), initSDK(), loginUser(), handleSubmit(), loginUser()

### Community 39 - "Community 39"
Cohesion: 0.33
Nodes (10): containsAny(), firstLines(), main(), maskDatabaseUrl(), runPrismaStatus(), containsAny(), firstLines(), main() (+2 more)

### Community 40 - "Community 40"
Cohesion: 0.29
Nodes (7): previousDayStart(), rollupAgentTeamMetricsForDay(), roundNullable(), previousDayStart(), rollupAgentTeamMetricsForDay(), roundNullable(), agentTeamMetricsRollupWorkflow()

### Community 44 - "Community 44"
Cohesion: 0.38
Nodes (4): applySoftDeleteFilter(), isSoftDeleteModel(), applySoftDeleteFilter(), isSoftDeleteModel()

### Community 46 - "Community 46"
Cohesion: 0.48
Nodes (6): base64UrlEncode(), buildState(), hmacSign(), base64UrlEncode(), buildState(), hmacSign()

### Community 48 - "Community 48"
Cohesion: 0.48
Nodes (6): getToneConfig(), toToneConfig(), updateToneConfig(), getToneConfig(), toToneConfig(), updateToneConfig()

### Community 50 - "Community 50"
Cohesion: 0.48
Nodes (6): main(), parseFrontmatter(), stripQuotes(), main(), parseFrontmatter(), stripQuotes()

### Community 51 - "Community 51"
Cohesion: 0.38
Nodes (4): createMockClient(), createRealisticDelegate(), createMockClient(), createRealisticDelegate()

### Community 52 - "Community 52"
Cohesion: 0.38
Nodes (4): createMockDelegate(), createMockRawClient(), createMockDelegate(), createMockRawClient()

### Community 53 - "Community 53"
Cohesion: 0.48
Nodes (6): createWorkspaceForUser(), main(), parseArgs(), createWorkspaceForUser(), main(), parseArgs()

### Community 54 - "Community 54"
Cohesion: 0.38
Nodes (4): buildCookieValue(), hmacHex(), buildCookieValue(), hmacHex()

## Knowledge Gaps
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `GET()` connect `Community 1` to `Community 5`, `Community 6`, `Community 7`, `Community 8`, `Community 10`, `Community 11`, `Community 12`, `Community 13`, `Community 14`, `Community 15`, `Community 18`, `Community 24`?**
  _High betweenness centrality (0.304) - this node is a cross-community bridge._
- **Why does `update()` connect `Community 0` to `Community 1`, `Community 35`, `Community 5`, `Community 7`, `Community 8`, `Community 10`, `Community 11`, `Community 13`, `Community 46`, `Community 17`, `Community 18`, `Community 19`, `Community 54`, `Community 22`, `Community 26`?**
  _High betweenness centrality (0.164) - this node is a cross-community bridge._
- **Why does `ConversationInsightsPanel()` connect `Community 14` to `Community 1`?**
  _High betweenness centrality (0.149) - this node is a cross-community bridge._
- **Are the 48 inferred relationships involving `GET()` (e.g. with `main()` and `sendWithRetry()`) actually correct?**
  _`GET()` has 48 INFERRED edges - model-reasoned connections that need verification._
- **Are the 45 inferred relationships involving `update()` (e.g. with `softUpsert()` and `main()`) actually correct?**
  _`update()` has 45 INFERRED edges - model-reasoned connections that need verification._
- **Are the 31 inferred relationships involving `create()` (e.g. with `softUpsert()` and `main()`) actually correct?**
  _`create()` has 31 INFERRED edges - model-reasoned connections that need verification._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.02 - nodes in this community are weakly interconnected._