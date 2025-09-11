# Frontend Variant Migration Plan (Logic-First)

## Overview
Migrate the task page to a variant-aware architecture while keeping the single‑variant UI identical. We first thread `variantId` end‑to‑end (Stage 1), then introduce the multi‑variant UI (Stage 2) with 2–3 side‑by‑side chats, collapsed prompt forms when multiple are visible, and a focus mechanism in the sidebar.

Guiding principles:
- No visual change in Stage 1; only logic becomes variant-aware.
- Subscribe to and maintain per‑variant state even when not visible (for seamless toggling).
- Component actions (send/stop/PR) are variant-scoped and triggered by the chat UI that knows its `variantId`.

---

## Architecture Shape

- Single task socket/context for the page: manages all variants for the task.
- Track a visibility map; focus is derived from visibility.
- Maintain per‑variant caches for messages and streaming state (recommended for multi-column UI).
- Keep file system and terminal bound to the focused variant only.

---

## Stage 1 — Single-Variant Wiring (no UI changes)

Goal: Existing task page works exactly as today, but all flows are variant‑aware and ready for multi‑variant.

### 1) Task Socket Context Additions
- State
  - `variants: Array<{ id, modelType, sequence, status?, shadowBranch? }>`
  - `visibleById: Record<variantId, boolean>` — initialize all variants to `true` (all visible initially)
  - Derived (not stored):
    - `visibleIds = Object.keys(visibleById).filter(id => visibleById[id])`
    - `isMultiView = visibleIds.length > 1`
    - `focusedVariantId = visibleIds.length === 1 ? visibleIds[0] : null`
  - Optional helper: `lastFocusedId` for restoring a sensible single view.
  - Per-variant streaming state: maps keyed by `variantId` for
    - `isStreamingById: Record<variantId, boolean>`
    - `streamingPartsMapById: Record<variantId, Map<string, AssistantMessagePart>>`
    - `streamingPartsOrderById: Record<variantId, string[]>`
- Methods
  - `showOnly(id)` — focus on single variant (others hidden)
  - `show(id)` / `hide(id)` — enforce invariant that at least one remains visible
  - `toggle(id)` — visibility toggle with invariant
  - `setAllVisible()` — enter multi-view (all visible)
  - `setVisibleSet(ids: string[])` — batch set with invariant
  - `focus(id)` — alias of `showOnly(id)` and record `lastFocusedId`
- Initialization
  - Provide initial `variants` from server (Task layout prefetch) or a light API call.
  - Set all variants visible initially; derived `focusedVariantId` is `null` in multi-view.

### 2) Socket Emits and Handling (variant-scoped)
- Client emits (per Variant)
  - `join-task`: `{ taskId }` (task-scoped)
  - `get-chat-history`: `{ taskId, variantId, complete: false }`
  - `user-message`: `{ taskId, variantId, message, llmModel?, queue? }`
  - `stop-stream`: `{ taskId, variantId }`
  - `clear-queued-action`: `{ taskId, variantId }`
  - `create-stacked-pr`: `{ taskId, variantId, message, llmModel, queue?, newTaskId? }`
  - `get-terminal-history`: `{ taskId, variantId }`
  - `clear-terminal`: `{ taskId, variantId }`
- Server events (must include variantId where variant-scoped)
  - Chat/history/streaming
    - `chat-history`: `{ taskId, variantId, messages, queuedAction }`
    - `stream-state`: `{ variantId, chunks, isStreaming, totalChunks }`
    - `stream-chunk`: `{ variantId, ... }`
    - `stream-complete`: `{ variantId }`
    - `stream-error`: `{ variantId, error }`
    - `queued-action-processing`: `{ taskId, variantId, type, message, model, ... }`
    - `auto-pr-status`: `{ taskId, variantId, messageId, status, ... }`
  - Terminal (already variant-scoped):
    - `terminal-history`: `{ taskId, variantId, entries }`
    - `terminal-output`: `{ taskId, variantId, entry }`
    - `terminal-cleared`: `{ taskId, variantId }`
- FE handling
  - On connect, request chat history for the (single) variant.
  - Maintain streaming state per `variantId` (maps keyed by variant id).
  - Only the focused variant binds the terminal and filesystem.
  - If multiple variants are visible (no focus), agent environment is disabled and closed.

### 3) REST & Proxy Updates (variant-aware)
- Messages
  - Frontend route: `GET /api/tasks/:taskId/:variantId/messages` (Next proxy)
  - Hook: `useTaskMessages(taskId, variantId)` → query key `["task-messages", taskId, variantId]`
- Files
  - File tree: `GET /api/tasks/:taskId/files/tree?variantId=...`
  - File content: `GET /api/tasks/:taskId/files/content?path=...&variantId=...`
  - Hooks: `useFileTree(taskId, variantId)` and `useFileContent(taskId, filePath, variantId)`
  - Only pass focused `variantId` for file operations.
- PR Creation
  - API: `POST /api/tasks/:taskId/pull-request` with `{ variantId }` in body
  - Hook: `useCreatePR().mutate({ taskId, variantId })`

### 4) React Query Keying
- Variant-scoped caches include `variantId`:
  - Messages: `["task-messages", taskId, variantId]`
  - Queued action: `["queued-action", taskId, variantId]`
  - File tree: `["file-tree", taskId, variantId]`
  - File content: `["file-content", taskId, variantId, path]`
- Task-wide data remains `["task", taskId]` in Stage 1 (todos/file-changes can migrate later).

### 5) UI Surface (unchanged in Stage 1)
- Task page renders a single chat as today.
- PromptForm sends/queues/PRs for the single variant (internally via context; no prop changes needed yet).
- Agent environment (files/terminal) binds to `focusedVariantId`.
- If more than one variant is visible, agent environment is disabled and closed.

### 6) Acceptance Criteria (Stage 1)
- Sending/streaming/stopping messages works as before (single variant).
- Terminal output and file operations behave normally.
- Socket and REST payloads consistently include `variantId` where variant-scoped.
- All variant-scoped query keys incorporate `variantId`.
- Swapping backend to multiple variants later will not require reworking FE logic.

---

## Stage 2 — Multi-Variant UI (follow‑up)

### 1) Multi-Column Layout
- Render 2–3 ChatColumn components side-by-side; each receives its `variantId`.
- TaskSocketContext keeps all variants up to date regardless of visibility.

### 2) PromptForm Behavior
- When more than one chat is visible, prompt forms render “collapsed” states.
- Only the focused chat’s prompt is active (others show a collapsed panel/cta).

### 3) Sidebar Agent View
- Display compact cards for each variant (status/model/branch) with a “Focus” action.
- On focus: hide other visible chats (or show only the chosen one) and switch focused variant for agent environment.

### 4) Agent Environment Binding
- Files/Terminal bind to `focusedVariantId`.
- Switching focus rebinds file content and terminal.

### 5) Optional: Variant-Scoped Todos & File Changes
- Migrate todos/file-changes views to be scoped to the `focusedVariantId`.

### 6) Acceptance Criteria (Stage 2)
- Multiple chats stream independently and concurrently.
- Toggling visibility is instant (no refetch, caches already populated).
- Focus affects only the prompt form and agent environment pane.

---

## Backend Alignment Needed

To support multi-variant subscriptions, ensure the following server events include `variantId`:
- `chat-history`, `stream-state`, `stream-chunk`, `stream-complete`, `stream-error`
- `queued-action-processing`, `auto-pr-status`

REST contracts (expected and/or confirmed):
- `GET /api/tasks/:taskId/:variantId/messages`
- `GET /api/tasks/:taskId/files/tree?variantId=...`
- `GET /api/tasks/:taskId/files/content?path=...&variantId=...`
- `POST /api/tasks/:taskId/pull-request` with `{ variantId }`

Notes:
- Terminal events already include `variantId`.
- If messages remain task-scoped by design, FE can consolidate per‑variant threads; however, per‑variant caches are recommended for side-by-side UI.

---

## Testing Plan

- Stage 1 (single variant)
  - Verify chat send/stream/stop flows and queued messages.
  - Verify terminal history/output and clear actions for the focused variant.
  - Verify file tree/content fetches include `variantId`.
  - Confirm no UI regressions in task page and sidebar.

- Stage 2 (multi-variant)
  - Show 2–3 columns; confirm each streams independently.
  - Toggle visibility on/off; ensure instant render (no fetch gap).
  - Switch focus; ensure agent environment immediately binds to the new variant.

---

## Risks & Mitigations

- Missing `variantId` in server events → FE cannot map updates per variant.
  - Mitigation: add `variantId` to all variant-scoped events before FE ships Stage 2.
- Query key inconsistencies → stale or cross-variant data bleed.
  - Mitigation: standardize keys to always include `variantId` where applicable.
- Over-fetching histories on connect (for 3 variants).
  - Mitigation: request history on visibility OR on first focus; keep stream subscriptions on always.

---

## File-by-File (Planned Changes)

- Context/State
  - `apps/frontend/contexts/task-socket-context.tsx` — add variants, visible map, focused id, and per-variant streaming state; expose actions.

- Sockets
  - `apps/frontend/hooks/socket/use-task-socket.ts` — include `variantId` in emits; handle per-variant events; maintain per‑variant streaming maps.
  - `apps/frontend/hooks/socket/use-terminal-socket.ts` — include `variantId` in emits; filter by `variantId`.

- REST & Proxies
  - `apps/frontend/app/api/tasks/[taskId]/[variantId]/messages/route.ts` — proxy to backend variant messages.
  - `apps/frontend/app/api/tasks/[taskId]/files/tree/route.ts` — forward `variantId` query param.
  - `apps/frontend/app/api/tasks/[taskId]/files/content/route.ts` — forward `variantId` query param.
  - `apps/frontend/app/api/tasks/[taskId]/pull-request/route.ts` — forward body `{ variantId }`.

- Hooks (variant-aware)
  - `apps/frontend/hooks/tasks/use-task-messages.tsx` — accept `variantId`; query key includes it.
  - `apps/frontend/hooks/agent-environment/use-file-tree.tsx` — accept `variantId`.
  - `apps/frontend/hooks/agent-environment/use-file-content.tsx` — accept `variantId`.
  - `apps/frontend/hooks/chat/use-queued-action.ts` — key by `[taskId, variantId]`.

- Components (no UI change yet)
  - Internally route actions via TaskSocketContext’s `focusedVariantId` (Stage 1).
  - Stage 2: pass explicit `variantId` props to each ChatColumn and PromptForm.

---

## Timeline

- Stage 1 (variant-aware logic, no UI): 1–2 days
  - Context/state + sockets + REST + query keys + validation
- Stage 2 (multi-variant UI): 1–2 days
  - Columns layout + collapsed prompt + sidebar cards + focus binding

---

## Open Questions

1) Messages scope: OK to fetch per‑variant (`/tasks/:taskId/:variantId/messages`) and keep per‑variant caches?
2) Todos/file-changes: move to variant-scoped now or defer to Stage 2 (recommended later)?
3) Backend payload updates: confirm adding `variantId` to `chat-history`, streaming, `queued-action-processing`, and `auto-pr-status` events.
