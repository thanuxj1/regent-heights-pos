-- Takes the July-October expenses sheet import (073) back out. The property
-- is correcting the sheet first (possible duplicates, unsure categories,
-- unclear lines) and will send it again; until then none of it is in the books.
-- Only lines that came from the sheet go (exp_source); expenses typed into the
-- system are untouched. The categories the import added are removed too, if
-- nothing else has been filed under them since.
DELETE FROM "EXPENSE" e
 USING "Branch" b
 WHERE e.b_id = b."B_id" AND b."B_name" ILIKE 'Regent Heights%'
   AND e.exp_source LIKE 'expenses-sheet-2026:%';

DELETE FROM "EXPENSE_CATEGORY" c
 USING "Branch" b
 WHERE c.b_id = b."B_id" AND b."B_name" ILIKE 'Regent Heights%'
   AND c.name IN ('Fuel & Transport', 'Kitchen Gas', 'Laundry', 'Office & Housekeeping',
                  'Furniture & Equipment', 'Staff Welfare', 'Accommodation', 'Fees, Insurance & Taxes')
   AND NOT EXISTS (SELECT 1 FROM "EXPENSE" e WHERE e.b_id = c.b_id AND e.exp_category = c.name);
