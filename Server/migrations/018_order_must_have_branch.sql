-- 018_order_must_have_branch.sql
--
-- "ORDER".b_id was nullable. The API has always required it, so no such row
-- exists — but a sale with no property is money that belongs to nobody: every
-- branch-scoped query filters on b_id = $1, so a NULL would make the sale
-- invisible in every list, every report and every revenue total, while still
-- sitting in the table.
--
-- The application checking something is not the same as the database refusing
-- it. This makes it the database's rule too.
--
-- Deliberately NOT applied to the other nullable owner columns:
--   "User".B_id / com_id  — NULL is correct there; it is how Super Admin, who
--                           sits above every company, is represented.
--   ACTIVITY_LOG.b_id     — a sign-in can be recorded before a branch is known.

ALTER TABLE "ORDER" ALTER COLUMN b_id SET NOT NULL;
