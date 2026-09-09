-- ─────────────────────────────────────────────────────────────────────────────
-- Retire the company-level ADMIN role (role_id 2).
--
-- The owner is both the company owner and the property manager, so two admin
-- roles only made the user picker ambiguous. Role 1 ("Administrator") is now
-- the single admin role; role 2 is emptied and made unassignable.
--
-- The row itself is KEPT, deliberately:
--   • ACTIVITY_LOG rows still record role_id = 2 for actions taken back then,
--     and rewriting history would be a lie.
--   • Role 2 is the only company-scoped role — it sees every branch in a
--     company, where role 1 sees one. A second property would need it back.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "Role"
  ADD COLUMN IF NOT EXISTS is_assignable BOOLEAN NOT NULL DEFAULT TRUE;

-- Role 2 accounts are company-scoped and carry no branch. Pin each to its
-- company's first branch BEFORE the role changes: role 1 filters every query
-- by "B_id", so a branch-less Administrator would log in to empty screens.
UPDATE "User" u
   SET "B_id" = (SELECT MIN(b."B_id") FROM "Branch" b WHERE b.com_id = u.com_id)
 WHERE u.role_id = 2
   AND u."B_id" IS NULL
   AND EXISTS (SELECT 1 FROM "Branch" b WHERE b.com_id = u.com_id);

UPDATE "User" SET role_id = 1 WHERE role_id = 2;

-- Out of circulation: never offered in a role picker, rejected by the API.
UPDATE "Role" SET is_assignable = FALSE WHERE role_id = 2;
