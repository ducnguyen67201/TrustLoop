# Positional JSON Output Format

Engineering spec for compressed LLM output across TrustLoop's agent and workflow pipelines.

## Problem

LLM output tokens are expensive. A full JSON response with verbose field names (`problemStatement`, `likelySubsystem`, `reasoningTrace`) costs 3-5x more tokens than the actual content. At scale, this is real money.

## Solution

Positional JSON: single-character field names + numeric codes for enums. The LLM returns compressed JSON, and a reconstruction layer expands it back to the full typed schema before any business logic sees it.

```
LLM output (compressed)                    Reconstruction                     Business logic (full schema)
{"a":{"p":"...","v":2}}    →    reconstructAnalysisOutput()    →    {analysis:{problemStatement:"...",severity:"HIGH"}}
```

## Token Savings

| Field | Verbose | Compressed | Savings |
|-------|---------|------------|---------|
| `problemStatement` | 18 chars | `p` 1 char | 94% |
| `likelySubsystem` | 16 chars | `s` 1 char | 94% |
| `severity: "CRITICAL"` | 20 chars | `v: 3` 4 chars | 80% |
| `category: "FEATURE_REQUEST"` | 30 chars | `c: 2` 4 chars | 87% |
| `reasoningTrace` | 14 chars | `t` 1 char | 93% |
| `internalNotes` | 13 chars | `n` 1 char | 92% |
| `citations` | 9 chars | `x` 1 char | 89% |

Estimated overall reduction: **70-80%** on structural output tokens.

## Reliability: Ensuring 100% LLM Compliance

The format must never fail in production. Three layers of defense:

### Layer 1: Prompt Engineering

- **Explicit field reference table** in the system prompt — no ambiguity about field names or codes
- **Two concrete examples** (with draft, without draft) — LLMs follow examples more reliably than prose
- **"Respond with ONLY a compressed JSON object"** — explicit instruction to suppress markdown/text
- The format instructions live in `POSITIONAL_ANALYSIS_FORMAT_INSTRUCTIONS` (shared constant) so every caller uses the exact same spec

### Layer 2: Zod Schema Validation

`compressedAnalysisOutputSchema.parse()` runs before reconstruction. It catches:

| Failure | What Zod catches |
|---------|-----------------|
| LLM wraps JSON in markdown | `JSON.parse()` fails before Zod (caught by try/catch) |
| LLM adds extra text before/after JSON | `JSON.parse()` fails |
| LLM uses wrong field name (`sev` instead of `v`) | Zod rejects missing required field |
| LLM uses string for severity (`"HIGH"` instead of `2`) | Zod rejects wrong type |
| LLM uses out-of-range code (`v: 5`) | Zod `.max(3)` rejects |
| LLM omits required field | Zod rejects missing field |
| LLM returns null for non-nullable | Zod rejects |

### Layer 3: Graceful Error Handling

When the LLM fails to produce valid positional JSON:

```ts
try {
  parsed = JSON.parse(rawOutput);
} catch {
  console.error("[agents] LLM returned non-JSON output:", rawOutput.slice(0, 1000));
  throw new Error(`Agent returned non-JSON response: ${rawOutput.slice(0, 200)}`);
}

const compressed = compressedAnalysisOutputSchema.parse(parsed);
const output = reconstructAnalysisOutput(compressed);
```

The error propagates through:
1. `agent.ts` throws with descriptive message
2. `server.ts` catches, logs full stack trace, returns 500
3. Temporal activity retries (max 2 attempts)
4. `markSyncRequestFailed` marks the analysis as FAILED with the error message
5. UI shows "Analysis failed" with the error

### Testing Requirements

Every positional format schema MUST have:

1. **Valid format test** — happy path with all fields populated
2. **Valid format without optional fields** — `d: null`, optional fields omitted
3. **Invalid code range tests** — severity 5, category 6, tone 3
4. **Invalid type tests** — string where number expected, number where string expected
5. **Missing required field tests** — omit each required field individually
6. **Malformed JSON test** — LLM returns text/markdown instead of JSON
7. **Reconstruction roundtrip test** — compressed → reconstructed matches expected full schema

## Schema: Support Analysis

### Compressed (what the LLM returns)

```json
{"a":{"p":"Login fails after reset","s":"auth","v":2,"c":0,"f":0.85,"m":[],"t":"Found bug in reset.ts:42"},"d":{"b":"We found...","n":"Token bug","x":["src/auth/reset.ts:42|clearTokens()"],"o":0}}
```

### Code Mappings

| Field | Code | Value |
|-------|------|-------|
| Severity (`v`) | 0 | LOW |
| | 1 | MEDIUM |
| | 2 | HIGH |
| | 3 | CRITICAL |
| Category (`c`) | 0 | BUG |
| | 1 | QUESTION |
| | 2 | FEATURE_REQUEST |
| | 3 | CONFIGURATION |
| | 4 | UNKNOWN |
| Tone (`o`) | 0 | professional |
| | 1 | empathetic |
| | 2 | technical |
| Citations (`x`) | flat string | `"filepath:line\|snippet"` — parsed by `parseCitation()` |

### Expanded (after reconstruction)

```json
{
  "analysis": {
    "problemStatement": "Login fails after reset",
    "likelySubsystem": "auth",
    "severity": "HIGH",
    "category": "BUG",
    "confidence": 0.85,
    "missingInfo": [],
    "reasoningTrace": "Found bug in reset.ts:42"
  },
  "draft": {
    "body": "We found...",
    "internalNotes": "Token bug",
    "citations": [{"file": "src/auth/reset.ts", "line": 42, "text": "clearTokens()"}],
    "tone": "professional"
  }
}
```

## Architecture

```
System Prompt
  └── POSITIONAL_ANALYSIS_FORMAT_INSTRUCTIONS (shared constant from @shared/types)
       ↓
LLM generates compressed JSON
       ↓
JSON.parse()                              ← catch non-JSON (Layer 3)
       ↓
compressedAnalysisOutputSchema.parse()    ← Zod validation (Layer 2)
       ↓
reconstructAnalysisOutput()               ← expand to full typed schema
       ↓
Business logic (full names, typed enums)
```

### Key Files

| File | Purpose |
|------|---------|
| `packages/types/src/positional-format/support-analysis.ts` | Schema, codes, reconstruction, prompt instructions |
| `packages/types/src/positional-format/index.ts` | Re-exports for `@shared/types` |
| `apps/agents/src/prompts/support-analysis.ts` | System prompt using shared format instructions |
| `apps/agents/src/agent.ts` | Parse + reconstruct in the analysis pipeline |

### Boundary Rule

The compressed format is **never exposed** beyond the LLM call boundary. `reconstructAnalysisOutput()` runs immediately after `JSON.parse()`. Everything downstream (DB writes, API responses, Temporal activity results, UI) sees the full expanded schema with verbose field names and string enum values.

## Adding a New Positional Format (for a new workflow)

When `apps/queue` or another service needs compressed LLM output for a different workflow:

1. Create `packages/types/src/positional-format/<workflow-name>.ts`
2. Define code mappings, compressed schema, reconstruction function, and prompt instructions
3. Export from `packages/types/src/positional-format/index.ts`
4. Import via `@shared/types` in the consuming app
5. Add the full test suite (see Testing Requirements above)

```
packages/types/src/positional-format/
├── index.ts                  ← re-exports all formats
├── support-analysis.ts       ← support analysis (agents, queue)
├── ticket-triage.ts          ← future: ticket triage workflow
└── escalation-scoring.ts     ← future: escalation priority workflow
```

## Adding New Fields to an Existing Format

1. Add the short field to the Zod schema in `support-analysis.ts`
2. Add the code mapping array (if enum)
3. Add the expansion in `reconstructAnalysisOutput()`
4. Update `POSITIONAL_ANALYSIS_FORMAT_INSTRUCTIONS` — field reference + both examples
5. Add tests for the new field (valid, invalid, missing)

## Rules

### Nesting (hard limit)

- **Max depth: 2 levels.** `{ "a": { "p": "value" } }` is depth 2. Never go deeper.
- LLMs become unreliable at depth 3+. Nested objects inside arrays are the worst case — the model skips fields, invents keys, or truncates.
- If a field needs structure beyond depth 2, flatten it into an encoded string with a delimiter and parse in the reconstruction function.

```
BAD  (depth 3):  "x": [{"f": "file.ts", "l": 42, "t": "snippet"}]
GOOD (depth 2):  "x": ["file.ts:42|snippet"]
```

Flattening strategy by data type:

| Data | Flat format | Parse logic |
|------|------------|-------------|
| File + line + text | `"filepath:line\|text"` | Split on `\|`, split file part on last `:` |
| Key-value pair | `"key=value"` | Split on `=` |
| Tuple | `"a,b,c"` | Split on `,` |
| Nested object | Don't. Redesign the schema. | — |

### Field names

- Single lowercase letter when possible (`p`, `s`, `v`, `t`)
- Two letters if single is ambiguous within the same level
- Never reuse the same letter at the same nesting level

### Values

- Enum values: always numeric codes (0-indexed integers)
- String values: no compression (content must remain readable by the LLM)
- Nullable fields: use `null` directly (no code for null)
- Arrays: prefer arrays of primitives (strings, numbers). Avoid arrays of objects.

### Source of truth

- The reconstruction function is the single source of truth for field mapping
- Every format must export: Zod schema, reconstruction function, prompt instructions constant
- Prompt instructions must include at least two concrete examples
