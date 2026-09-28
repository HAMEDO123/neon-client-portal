# projectfiles — feature inventory and status

The project file tabs, embedded by the projects area's project page, for
both the manager and the team (`requireStaff`). Web sources: `src/app/admin/(dashboard)/projects/[id]/{drawings,documents,boq,pricing,materials,furniture,approvals,comments}/page.tsx`
and their components; employee re-exports under `src/app/employee/(portal)/projects/[id]/**`.

Status: **all eight tabs built**, server + app, verified (tsc, eslint,
mobile-registry test, xcodegen + xcodebuild all green).

## Drawings (`drawing-actions.ts`, `drawing-row.tsx`)
- [x] List by category, sub-category, drawing number, revision label, file type/size
- [x] Add: category (menu), sub-category, name, drawing number, revision, file (PDF/DWG/image via `UploadMaker.documentTypes`)
- [x] Open the current file
- [x] Revision history, expandable per drawing (label, note, date, open, remove)
- [x] Upload a new revision (archives the current file into history)
- [x] Delete a revision
- [x] Delete a drawing (confirm; warns it removes every revision too)

## Documents (`document-actions.ts`)
- [x] List by category, version, file type/size
- [x] Add: category (menu), title, version, file
- [x] Open the file
- [x] Delete (confirm)

## BOQ (`boq-actions.ts`)
- [x] List: category, name, unit, quantity, unit price, specification, related space, reference image
- [x] Add: category (menu), name, unit, quantity (required), unit price (optional), related drawing, related space, specification, reference image
- [x] Delete (confirm)
- No total row — the web admin tab doesn't show one either (only the client
  page does, gated by `showBoqQuantities`/`showBoqPrices`, which is a client-page concern).

## Pricing (`pricing-actions.ts`)
- [x] "Pricing hidden from client" banner when `project.showPricing` is off
- [x] List: category, label, description, amount, optional flag
- [x] Total Project Cost — same sum the web computes (non-optional lines), computed server-side in the read
- [x] Add: category (menu), label, amount (required), description, optional toggle
- [x] Delete (confirm)

## Materials (`material-actions.ts`)
- [x] Grid with reference photo, category badge, name, brand, price
- [x] Add: category (menu), name, brand, model, color, finish, supplier, estimated quantity, price, spaces used in, image
- [x] Delete via context menu (confirm)

## Furniture (`furniture-actions.ts`)
- [x] Grid with reference photo, name, space, quantity, price
- [x] Add: name, space, quantity, brand, model, dimensions, finish, supplier, price, image
- [x] Delete via context menu (confirm)

## Approvals (`approval-actions.ts`, studio half)
- [x] List: milestone label, client's note (quoted), who responded and when, status badge
- [x] Add: milestone label
- [x] Delete (confirm)
- The client's own response (`respondToApproval`) is the client portal's, not the studio's — not built here, correctly out of scope.

## Comments (`comment-actions.ts` + `lib/mobile/projectfiles-comments.ts`)
- [x] Thread: author, "Studio" badge for the studio's own replies, ref label, status, message (own text direction), date
- [x] Resolve / reopen
- [x] Delete (confirm)
- [x] Reply as "NEON Team" — the web page has no reply action (see the lib
  helper's own comment: the platform's only prior reply was the original
  admin app's `api/mobile/projects/[id]/comments` route); this is that
  behaviour, reused as `guardedAction(requireStaff, …)` since no server
  action exists to call.

## Not implemented
Nothing from the web's feature set was left out. The one thing beyond the
web's own scope — resolving the client's approval response — is correctly
the client portal's job, not this tab's.
