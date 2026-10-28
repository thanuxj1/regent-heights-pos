-- Expenses 5-7 October 2026, from another page of the October expenses sheet
-- (photo): 10 lines, 96,042.83. The red-ink lines are included, as the
-- property asked. Goraka is a raw material. Like 076, a line whose amount
-- matches an expense already typed into the system on the same day is
-- skipped, so nothing is counted twice. Runs once.
INSERT INTO "EXPENSE" (b_id, exp_category, exp_amount, exp_description, exp_date, exp_method, exp_source)
SELECT b."B_id",
       COALESCE((SELECT c.name FROM "EXPENSE_CATEGORY" c WHERE c.b_id = b."B_id" AND lower(c.name) = lower(v.cat)), v.cat),
       v.amount, v.descr, v.day, NULL, 'expenses-2026-oct-5to7:' || v.line
FROM "Branch" b
CROSS JOIN (VALUES
  ('#1',  DATE '2026-10-05', 'raw_materials',    95,       'Goraka'),
  ('#2',  DATE '2026-10-05', 'raw_materials',    2672,     'Veg - 113'),
  ('#3',  DATE '2026-10-06', 'raw_materials',    330,      'Bread'),
  ('#4',  DATE '2026-10-06', 'Fuel & Transport', 1976,     'Petrol - bike'),
  ('#5',  DATE '2026-10-06', 'maintenance',      7500,     'Plants - Kandy City Mission'),
  ('#6',  DATE '2026-10-06', 'utilities',        7358.83,  'SLT Mobitel 0812201554'),
  ('#7',  DATE '2026-10-06', 'utilities',        64041,    'Electricity bill'),
  ('#8',  DATE '2026-10-07', 'raw_materials',    2830,     'Veg'),
  ('#9',  DATE '2026-10-07', 'raw_materials',    7380,     'Veg - Dumbara Traders'),
  ('#10', DATE '2026-10-06', 'other',            1860,     'Burger Hut')
) AS v (line, day, cat, amount, descr)
WHERE b."B_name" ILIKE 'Regent Heights%'
  AND NOT EXISTS (SELECT 1 FROM "EXPENSE" x WHERE x.b_id = b."B_id" AND x.exp_source LIKE 'expenses-2026-oct-5to7:%')
  AND NOT EXISTS (
    SELECT 1 FROM "EXPENSE" e
     WHERE e.b_id = b."B_id" AND e.exp_source IS NULL
       AND abs(e.exp_amount - v.amount) <= 1 AND e.exp_date = v.day);
