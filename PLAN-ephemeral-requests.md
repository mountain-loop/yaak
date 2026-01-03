# Ephemeral Requests Feature Plan

## Problem Statement

Yaak auto-saves all changes. When using filesystem sync with Git, any new requests or modifications made for quick testing get written to disk. The only way to undo this is Git reset or manual revert, which is cumbersome for quick one-off tests.

## Proposed Solutions Analysis

### Option 1: "Create Scratch" from Request (Recommended)

**Concept**: Right-click a request → "Create Scratch Copy" creates a new ephemeral request nested under the same folder, pre-populated with the original request's data. These requests are excluded from filesystem sync.

**Pros**:
- Inherits folder auth/headers naturally (uses same `folder_id`)
- Clear mental model: "I'm testing a variation of this request"
- Similar UX to existing "Duplicate" action
- Ephemeral requests can live anywhere in the hierarchy
- Single boolean field change to data model

**Cons**:
- Need visual indicator to distinguish ephemeral vs. regular requests
- Need lifecycle management (auto-cleanup or manual deletion)

### Option 2: Mark Items as "Sync Excluded"

**Concept**: Add ability to mark any folder/request as excluded from filesystem sync, optionally with glob/name rules.

**Pros**:
- More flexible - works for any organizational structure
- Could support pattern-based rules (e.g., exclude `*-test`)

**Cons**:
- More complex UI to manage exclusion rules
- Doesn't solve the "quick scratch test" use case as directly
- Requires additional settings UI
- Rules could be confusing

### Option 3: Top-Level Scratch Folder

**Concept**: A special top-level "Scratch" folder where all ephemeral requests live.

**Pros**:
- Clear visual separation
- Easy to find all scratch requests

**Cons**:
- Doesn't inherit auth/headers from the folder where the original request lives
- Would need complex "inherit from location X" feature
- Breaks the natural hierarchy

---

## Recommended Approach: Option 1 with Enhancements

I recommend Option 1 with the following implementation:

### Core Feature: `ephemeral` Field

Add an `ephemeral: bool` field to `HttpRequest`, `GrpcRequest`, `WebsocketRequest`, and `Folder` models. Ephemeral items:
- Are stored in the local database (so they persist across app restarts)
- Are **excluded from filesystem sync** (never written to YAML files)
- Can be created anywhere in the folder hierarchy
- Inherit auth/headers from parent folders like normal requests

### UI/UX Features

1. **Create Scratch Action**: Right-click request → "Create Scratch Copy"
   - Creates a duplicate with `ephemeral: true`
   - Name: `{original_name} (scratch)` or similar

2. **Visual Indicator**: Ephemeral requests show a subtle badge/icon (e.g., clock, ghost, or dotted border)

3. **Sidebar Filter**: Add `is:ephemeral` filter support to find/hide scratch requests

4. **Bulk Cleanup**: Add "Delete All Scratch Requests" action in workspace menu

5. **Convert to Permanent**: Right-click ephemeral request → "Save Permanently" (sets `ephemeral: false`)

---

## Implementation Plan

### Phase 1: Data Model & Sync Exclusion

#### 1.1 Add `ephemeral` field to models

**Files to modify:**
- `src-tauri/yaak-models/src/models.rs`

Add to `HttpRequest`, `GrpcRequest`, `WebsocketRequest`, `Folder`:
```rust
#[serde(default)]
pub ephemeral: bool,
```

Update `insert_values()`, `update_columns()`, and `from_row()` for each model.

#### 1.2 Database migration

**Files to modify:**
- `src-tauri/yaak-models/migrations/` (new migration file)

```sql
ALTER TABLE http_requests ADD COLUMN ephemeral INTEGER NOT NULL DEFAULT 0;
ALTER TABLE grpc_requests ADD COLUMN ephemeral INTEGER NOT NULL DEFAULT 0;
ALTER TABLE websocket_requests ADD COLUMN ephemeral INTEGER NOT NULL DEFAULT 0;
ALTER TABLE folders ADD COLUMN ephemeral INTEGER NOT NULL DEFAULT 0;
```

#### 1.3 Update SyncModel to exclude ephemeral items

**Files to modify:**
- `src-tauri/yaak-sync/src/models.rs` - Add ephemeral check
- `src-tauri/yaak-sync/src/sync.rs` - Add `IgnoreEphemeral` variant

In `get_db_candidates()`, similar to the private environment pattern:
```rust
SyncModel::HttpRequest(r) if r.ephemeral => {
    return Some(DbCandidate::Deleted(existing_sync_state.to_owned()));
    // or return None if no sync state
}
```

### Phase 2: Frontend - TypeScript Types

**Files to modify:**
- Types are auto-generated from Rust via `ts-rs`, so after Rust changes, regenerate

Verify the generated types in `src-web/gen_models.ts` include `ephemeral: boolean`.

### Phase 3: UI - Create Scratch Action

#### 3.1 Add "Create Scratch Copy" to context menu

**Files to modify:**
- `src-web/components/Sidebar.tsx`
- `src-web/lib/duplicateRequestOrFolderAndNavigate.tsx` (or create new helper)

Add menu item after "Duplicate":
```typescript
{
  label: 'Create Scratch Copy',
  leftSlot: <Icon icon="flask" />, // or "beaker", "test_tube"
  hidden: items.length > 1 || child.model === 'folder',
  onSelect: () => createScratchCopy(child),
}
```

#### 3.2 Implement `createScratchCopy` function

**New file:** `src-web/lib/createScratchCopy.ts`

```typescript
export async function createScratchCopy(
  model: HttpRequest | GrpcRequest | WebsocketRequest
) {
  const copy = {
    ...model,
    id: '', // Generate new ID
    name: `${model.name} (scratch)`,
    ephemeral: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const newId = await upsertModel(copy);
  navigateToRequestOrFolderOrWorkspace(newId, model.model);
}
```

### Phase 4: UI - Visual Indicator

#### 4.1 Add ephemeral badge to sidebar items

**Files to modify:**
- `src-web/components/Sidebar.tsx` - `SidebarInnerItem` component

Add a subtle indicator for ephemeral requests:
```typescript
{item.ephemeral && (
  <Icon icon="clock" className="text-text-subtlest text-xs" title="Scratch request (not synced)" />
)}
```

#### 4.2 Add indicator in request editor header

**Files to modify:**
- `src-web/routes/workspaces/$workspaceId/requests/$requestId.tsx`

Show a banner or badge indicating the request is ephemeral and won't be synced.

### Phase 5: Additional Actions

#### 5.1 "Save Permanently" action

**Files to modify:**
- `src-web/hooks/useHttpRequestActions.tsx`
- `src-web/hooks/useGrpcRequestActions.tsx`
- `src-web/hooks/useWebsocketRequestActions.tsx`

Add action (only shown for ephemeral requests):
```typescript
{
  label: 'Save Permanently',
  icon: 'save',
  call: async (request) => {
    await patchModel(request, { ephemeral: false });
  },
}
```

#### 5.2 Sidebar filter support

**Files to modify:**
- `src-web/components/Sidebar.tsx` - `getItemFields` function

Add field for filtering:
```typescript
if ('ephemeral' in item && item.ephemeral) {
  fields.ephemeral = 'true';
}
```

This enables `is:ephemeral` filter in the sidebar search.

#### 5.3 "Delete All Scratch Requests" action

**Files to modify:**
- `src-web/components/Sidebar.tsx` - sidebar menu dropdown

Add to the ellipsis menu:
```typescript
{
  label: 'Delete All Scratch Requests',
  leftSlot: <Icon icon="trash" />,
  onSelect: deleteAllEphemeralRequests,
}
```

---

## File Summary

### Rust (Backend)
| File | Changes |
|------|---------|
| `src-tauri/yaak-models/src/models.rs` | Add `ephemeral` field to 4 models |
| `src-tauri/yaak-models/migrations/*.sql` | New migration for `ephemeral` column |
| `src-tauri/yaak-sync/src/sync.rs` | Add `IgnoreEphemeral` handling |
| `src-tauri/yaak-sync/src/models.rs` | Update SyncModel if needed |

### TypeScript (Frontend)
| File | Changes |
|------|---------|
| `src-web/lib/createScratchCopy.ts` | New file - scratch copy logic |
| `src-web/components/Sidebar.tsx` | Context menu item, visual indicator, filter field |
| `src-web/hooks/useHttpRequestActions.tsx` | "Save Permanently" action |
| `src-web/hooks/useGrpcRequestActions.tsx` | "Save Permanently" action |
| `src-web/hooks/useWebsocketRequestActions.tsx` | "Save Permanently" action |
| `src-web/routes/workspaces/$workspaceId/requests/$requestId.tsx` | Ephemeral banner |

---

## Future Enhancements (Out of Scope)

1. **Auto-cleanup option**: Setting to delete ephemeral requests on app launch or after N days
2. **Ephemeral folders**: Create scratch folders for grouping test requests
3. **Keyboard shortcut**: `Cmd+Shift+D` to create scratch copy of active request
4. **Import as ephemeral**: Option when importing to mark all imported items as ephemeral

---

## Open Questions

1. **Naming**: "Scratch", "Ephemeral", "Draft", or "Temporary"? I lean toward "Scratch" for the UI since it's more intuitive.

2. **Icon choice**: What icon best represents scratch/ephemeral? Options: `flask`, `beaker`, `clock`, `ghost`, `pencil_line`

3. **Default behavior**: Should there be a setting to auto-delete ephemeral requests on app launch, or should they persist until manually deleted?

4. **Folder support**: Should folders also support `ephemeral`? This would allow creating scratch folders that group test requests but aren't synced.
