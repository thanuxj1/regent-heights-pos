-- Readable role names on a new installation.
--
-- schema.sql seeds roles with code names (BRANCH_ADMIN, CASHIER, ...) and three
-- the app never uses (STAFF, MANAGER, SUPERVISOR). Regent Heights' database was
-- tidied by hand long ago; a fresh installation showed "BRANCH_ADMIN" in
-- User Management. Only the untouched seed names are changed, so a name an owner
-- has already edited is left alone.
UPDATE "Role" SET role_name = 'Administrator' WHERE role_id = 1 AND role_name = 'BRANCH_ADMIN';
UPDATE "Role" SET role_name = 'Admin'         WHERE role_id = 2 AND role_name = 'ADMIN';
UPDATE "Role" SET role_name = 'Cashier'       WHERE role_id = 3 AND role_name = 'CASHIER';
UPDATE "Role" SET role_name = 'Super Admin'   WHERE role_id = 6 AND role_name = 'SUPER_ADMIN';
UPDATE "Role" SET role_name = 'Waiter'        WHERE role_id = 8 AND role_name = 'WAITER';
UPDATE "Role" SET role_name = 'Kitchen Staff' WHERE role_id = 9 AND role_name = 'KITCHEN_STAFF';

-- Never used by the app: not offered when creating a login.
UPDATE "Role" SET is_assignable = FALSE
 WHERE role_name IN ('STAFF', 'MANAGER', 'SUPERVISOR');
