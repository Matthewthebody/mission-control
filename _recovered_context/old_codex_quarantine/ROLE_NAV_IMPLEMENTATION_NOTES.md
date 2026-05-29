# Role Navigation And Permissions Notes

## Implemented In This Pass

- Centralized business-role mapping in `packages/admin-web/src/permissions.ts`
- Centralized capability checks for navigation, routes, widgets, and major actions
- Permission-aware shell and fallback routing in `packages/admin-web/src/app.tsx`
- Capability-aware route metadata in `packages/admin-web/src/navigation.ts`

## Deferred Decisions

1. Record-scope enforcement is still coarse in most admin-web views.
   - The foundation now supports self, assigned, managed-team, and org-wide patterns.
   - Most pages still gate at the route/action layer rather than full row-level filtering.

2. Assets for field users remain intentionally limited.
   - Field photographers do not automatically see the full Gear workspace without asset or custody capability.
   - A future pass should add a true "My Gear" or personal custody view if field usage needs it.

3. Review Desk queue shaping is still destination-level.
   - Users can now reach or miss `Review Desk` by capability.
   - Queue segmentation by department or assignment should be the next refinement.

4. Directory management remains broad for manager/leadership/admin.
   - That matches current operational expectations and existing tests.
   - A future pass can split account/contact/location management more precisely if the business wants tighter write boundaries.

5. Route aliases are still supported.
   - Old hashes remain readable for compatibility.
   - The next cleanup pass can remove more legacy emitters once canonical links fully settle.

## Recommended Next Prompt

Refine scoped data access on top of this foundation:

- self-only vs assigned-work vs managed-team filtering
- Review Desk queue segmentation by role
- personal custody / My Gear view for field users
- tighter write boundaries inside Directory and People Ops
