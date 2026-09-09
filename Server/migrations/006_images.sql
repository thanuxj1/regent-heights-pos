-- =============================================================
-- Image storage that was missing.
--
-- The staff Add User / User Details screens already had working
-- file pickers (FileReader + readAsDataURL), but "User" had no
-- image column at all — the picture was read, shown, and then
-- silently thrown away on save. Same story for guests, where a
-- hotel needs the passport/ID scan taken at check-in.
--
-- Stored as TEXT holding a data: URL, matching how Product
-- images already work in this codebase.
-- =============================================================

ALTER TABLE "User"  ADD COLUMN IF NOT EXISTS u_image     TEXT;
ALTER TABLE "GUEST" ADD COLUMN IF NOT EXISTS photo       TEXT;
ALTER TABLE "GUEST" ADD COLUMN IF NOT EXISTS id_document TEXT;

COMMENT ON COLUMN "User".u_image      IS 'Staff photo, data: URL';
COMMENT ON COLUMN "GUEST".photo       IS 'Guest photo, data: URL';
COMMENT ON COLUMN "GUEST".id_document IS 'Passport / NIC scan taken at check-in, data: URL';
