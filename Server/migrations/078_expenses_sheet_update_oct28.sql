-- Expenses added to the property's expenses sheet on 28 October (its rows
-- 78-112): salary payments for July, August and September, a September
-- grocery bill and 21 October lines — 25 lines, 760,942.47. None has a
-- date, so each goes on the last day of its month.
--
-- Left out, already in from the dated pages:
--   September part-time salary (Yameen) 25,000 — already in: Part-time Payment 25,000
--   October veg purchase 2,830 — already in: Veg 2,830 on 7 Oct
--   October fish 2,430 — already in: U.D.F fish 2,430 on 11 Oct
--   October Haira 4,304.40 — already in: Haira 4,304.40 on 10 Oct
--   October veg purchase 442 — already in: 113 Daily Fresh 440 on 10 Oct
--   October bread 330 (twice) — already in: bread 330 on 6, 10 and 28 Oct
--
-- As in 076, a line matching an expense typed into the system in the same
-- month and category is skipped. Runs once.
INSERT INTO "EXPENSE" (b_id, exp_category, exp_amount, exp_description, exp_date, exp_method, exp_source)
SELECT b."B_id",
       COALESCE((SELECT c.name FROM "EXPENSE_CATEGORY" c WHERE c.b_id = b."B_id" AND lower(c.name) = lower(v.cat)), v.cat),
       v.amount, v.descr, v.day, NULL, 'expenses-2026-sheet-update:' || v.line
FROM "Branch" b
CROSS JOIN (VALUES
  ('#1', DATE '2026-07-31', 'salary', 242636.68, 'Salary payment · date not on sheet'),
  ('#2', DATE '2026-08-31', 'salary', 177720, 'Staff salary · date not on sheet'),
  ('#3', DATE '2026-09-30', 'salary', 165920, 'Salary payment · date not on sheet'),
  ('#4', DATE '2026-09-30', 'raw_materials', 19864.12, 'Lakmuthu grocery · date not on sheet'),
  ('#5', DATE '2026-10-31', 'salary', 42500, 'Service charge · date not on sheet'),
  ('#6', DATE '2026-10-31', 'Fees, Insurance & Taxes', 3500, 'Accounting package payment · date not on sheet'),
  ('#7', DATE '2026-10-31', 'raw_materials', 12500, 'Supplier payment - Hewawitharana · date not on sheet'),
  ('#8', DATE '2026-10-31', 'Housekeeping & Laundry', 1125, 'Thermal printer ribbon · date not on sheet'),
  ('#9', DATE '2026-10-31', 'Fees, Insurance & Taxes', 5953.11, 'Domain renewal · Subscription, yearly · date not on sheet'),
  ('#10', DATE '2026-10-31', 'raw_materials', 6330, 'Gas - kitchen · date not on sheet'),
  ('#11', DATE '2026-10-31', 'raw_materials', 1500, 'Grocery purchase · date not on sheet'),
  ('#12', DATE '2026-10-31', 'raw_materials', 2049.2, 'Haira · date not on sheet'),
  ('#13', DATE '2026-10-31', 'raw_materials', 13500, 'Beef purchase · date not on sheet'),
  ('#14', DATE '2026-10-31', 'raw_materials', 4545, 'Veg purchase · date not on sheet'),
  ('#15', DATE '2026-10-31', 'raw_materials', 9420, 'Kitchen purchasing · date not on sheet'),
  ('#16', DATE '2026-10-31', 'maintenance', 2800, 'Maintenance · date not on sheet'),
  ('#17', DATE '2026-10-31', 'raw_materials', 1530, 'Kitchen purchasing · date not on sheet'),
  ('#18', DATE '2026-10-31', 'raw_materials', 699, 'Veg purchase · date not on sheet'),
  ('#19', DATE '2026-10-31', 'raw_materials', 480, 'Kitchen purchase · date not on sheet'),
  ('#20', DATE '2026-10-31', 'raw_materials', 800.36, 'Veg purchase · date not on sheet'),
  ('#21', DATE '2026-10-31', 'raw_materials', 600, 'Kitchen purchase · date not on sheet'),
  ('#22', DATE '2026-10-31', 'maintenance', 15000, 'City Mission - garden maintenance · date not on sheet'),
  ('#23', DATE '2026-10-31', 'utilities', 1700, 'Dialog · date not on sheet'),
  ('#24', DATE '2026-10-31', 'utilities', 7500, 'SLT Mobitel · date not on sheet'),
  ('#25', DATE '2026-10-31', 'raw_materials', 20770, 'Haira · date not on sheet')
) AS v (line, day, cat, amount, descr)
WHERE b."B_name" ILIKE 'Regent Heights%'
  AND NOT EXISTS (SELECT 1 FROM "EXPENSE" x WHERE x.b_id = b."B_id" AND x.exp_source LIKE 'expenses-2026-sheet-update:%')
  AND NOT EXISTS (
    SELECT 1 FROM "EXPENSE" e
     WHERE e.b_id = b."B_id" AND e.exp_source IS NULL
       AND abs(e.exp_amount - v.amount) <= 1
       AND date_trunc('month', e.exp_date) = date_trunc('month', v.day)
       AND lower(e.exp_category) = lower(v.cat));
