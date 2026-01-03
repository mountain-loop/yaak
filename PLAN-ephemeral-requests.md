# Private Requests Feature Plan

## Problem Statement

Yaak auto-saves all changes. When using filesystem sync with Git, any new requests or modifications made for quick testing get written to disk. The only way to undo this is Git reset or manual revert, which is cumbersome for quick one-off tests.

## Solution: `public` Field (Like Environments)

Following the existing pattern for environments (which have a `public` boolean), add the same field to requests and folders. Private items (`public: false`):
- Are stored in the local database (persist across app restarts)
- Are **excluded from filesystem sync** (never written to YAML files)
- Can be created anywhere in the folder hierarchy
- Inherit auth/headers from parent folders like normal requests

This is about **sync exclusion**, not temporariness. Users can keep private requests forever or enable auto-cleanup later.

### UI/UX Features

1. **Create Private Copy**: Right-click request → "Create Private Copy"
   - Creates a duplicate with `public: false`
   - Name: `{original_name} (copy)` or similar

2. **Visual Indicator**: Private requests show a subtle badge/icon in sidebar

3. **Sidebar Filter**: Add `is:private` filter support to find/hide private requests

4. **Toggle Action**: "Make Private" / "Make Public" to convert between states

5. **Bulk Cleanup** (future): Optional "Delete All Private Requests" action

---

## Implementation Plan

### Phase 1: Data Model & Sync Exclusion

#### 1.1 Add `public` field to models

**Files to modify:**
- `src-tauri/yaak-models/src/models.rs`

Add to `HttpRequest`, `GrpcRequest`, `WebsocketRequest`, `Folder`:
```rust
#[serde(default = "default_true")]
pub public: bool,
```

Update `insert_values()`, `update_columns()`, and `from_row()` for each model.

#### 1.2 Database migration

**Files to modify:**
- `src-tauri/yaak-models/migrations/` (new migration file)

```sql
ALTER TABLE http_requests ADD COLUMN public INTEGER NOT NULL DEFAULT 1;
ALTER TABLE grpc_requests ADD COLUMN public INTEGER NOT NULL DEFAULT 1;
ALTER TABLE websocket_requests ADD COLUMN public INTEGER NOT NULL DEFAULT 1;
ALTER TABLE folders ADD COLUMN public INTEGER NOT NULL DEFAULT 1;
```

#### 1.3 Update sync to exclude private items

**Files to modify:**
- `src-tauri/yaak-sync/src/sync.rs` - Extend existing `IgnorePrivate` handling

In `get_db_candidates()`, extend the existing private environment pattern:
```rust
SyncModel::Environment(e) if !e.public => { /* existing */ }
SyncModel::HttpRequest(r) if !r.public => {
    return Some(DbCandidate::Deleted(existing_sync_state.to_owned()));
    // or return None if no sync state
}
SyncModel::GrpcRequest(r) if !r.public => { /* same */ }
SyncModel::WebsocketRequest(r) if !r.public => { /* same */ }
SyncModel::Folder(f) if !f.public => { /* same */ }
```

### Phase 2: Frontend - TypeScript Types

**Files to modify:**
- Types are auto-generated from Rust via `ts-rs`, so after Rust changes, regenerate

Verify the generated types in `src-web/gen_models.ts` include `public: boolean`.

### Phase 3: UI - Create Private Copy Action

#### 3.1 Add "Create Private Copy" to context menu

**Files to modify:**
- `src-web/components/Sidebar.tsx`

Add menu item after "Duplicate":
```typescript
{
  label: 'Create Private Copy',
  leftSlot: <Icon icon="lock" />,
  hidden: items.length > 1 || child.model === 'folder',
  onSelect: () => createPrivateCopy(child),
}
```

#### 3.2 Implement `createPrivateCopy` function

**New file:** `src-web/lib/createPrivateCopy.ts`

```typescript
export async function createPrivateCopy(
  model: HttpRequest | GrpcRequest | WebsocketRequest
) {
  const newId = await duplicateModel({ ...model, public: false });
  navigateToRequestOrFolderOrWorkspace(newId, model.model);
}
```

### Phase 4: UI - Visual Indicator

#### 4.1 Add private badge to sidebar items

**Files to modify:**
- `src-web/components/Sidebar.tsx` - `SidebarInnerItem` component

Add a subtle indicator for private requests:
```typescript
{'public' in item && !item.public && (
  <Icon icon="lock" className="text-text-subtlest text-xs" title="Private (not synced)" />
)}
```

#### 4.2 Add indicator in request editor header

**Files to modify:**
- `src-web/routes/workspaces/$workspaceId/requests/$requestId.tsx`

Show a subtle badge indicating the request is private and won't be synced.

### Phase 5: Additional Actions

#### 5.1 "Make Public" / "Make Private" toggle

**Files to modify:**
- `src-web/hooks/useHttpRequestActions.tsx`
- `src-web/hooks/useGrpcRequestActions.tsx`
- `src-web/hooks/useWebsocketRequestActions.tsx`

Add toggle action:
```typescript
{
  label: request.public ? 'Make Private' : 'Make Public',
  icon: request.public ? 'lock' : 'unlock',
  call: async (request) => {
    await patchModel(request, { public: !request.public });
  },
}
```

#### 5.2 Sidebar filter support

**Files to modify:**
- `src-web/components/Sidebar.tsx` - `getItemFields` function

Add field for filtering:
```typescript
if ('public' in item) {
  fields.private = item.public ? 'false' : 'true';
}
```

This enables `is:private` filter in the sidebar search.

---

## File Summary

### Rust (Backend)
| File | Changes |
|------|---------|
| `src-tauri/yaak-models/src/models.rs` | Add `public` field to 4 models |
| `src-tauri/yaak-models/migrations/*.sql` | New migration for `public` column |
| `src-tauri/yaak-sync/src/sync.rs` | Extend `IgnorePrivate` handling to all model types |

### TypeScript (Frontend)
| File | Changes |
|------|---------|
| `src-web/lib/createPrivateCopy.ts` | New file - private copy logic |
| `src-web/components/Sidebar.tsx` | Context menu item, visual indicator, filter field |
| `src-web/hooks/useHttpRequestActions.tsx` | "Make Private/Public" toggle |
| `src-web/hooks/useGrpcRequestActions.tsx` | "Make Private/Public" toggle |
| `src-web/hooks/useWebsocketRequestActions.tsx` | "Make Private/Public" toggle |
| `src-web/routes/workspaces/$workspaceId/requests/$requestId.tsx` | Private indicator |

---

## Future Enhancements (Out of Scope)

1. **Auto-cleanup option**: Setting to delete private requests on app launch or after N days
2. **Private folders**: Create private folders for grouping test requests (included in initial scope if desired)
3. **Keyboard shortcut**: `Cmd+Shift+D` to create private copy of active request
4. **Import as private**: Option when importing to mark all imported items as private

---

## Resolved Questions

1. **Field naming**: Use `public` to match environments pattern ✓
2. **Terminology**: "Private" in UI (matches field, clear meaning) ✓
3. **Icon**: `lock` / `unlock` for private/public states ✓
4. **Lifecycle**: Private requests persist until manually deleted (auto-cleanup is future enhancement) ✓
5. **Folder support**: Yes, folders will also support `public` field ✓
