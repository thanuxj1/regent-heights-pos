-- October 2026, from the property's "SALES SUMMARY - 7th of OCT 2026" sheet.
--
-- 7 days with sales, LKR 66,960.00 in all: hotel 16,700.00, restaurant 50,260.00.
-- Room revenue 15,600.00, Basis guest meal 0.00, Restaurant 24,760.00, Rice & curry 25,500.00, Transport 1,100.00, Laundry 0.00.
-- Every day's columns add up to its total and every column to the sheet's
-- total row. Blank cells and days with nothing in them have no row.
--
-- The sheet is the record for each day it covers: Reports leaves out whatever
-- the system itself holds for that day (trial entries before go-live), so
-- nothing is counted twice. See 060_imported_sales.sql.
INSERT INTO "IMPORTED_SALES" (b_id, sale_date, department, line, amount, source)
SELECT b."B_id", v.sale_date, v.department, v.line, v.amount, 'Sales summary, October 2026'
FROM "Branch" b
CROSS JOIN (VALUES
  (DATE '2026-10-01', 'restaurant', 'Restaurant', 2350),
  (DATE '2026-10-01', 'restaurant', 'Rice & curry', 4000),
  (DATE '2026-10-01', 'hotel', 'Transport', 150),
  (DATE '2026-10-02', 'restaurant', 'Restaurant', 2450),
  (DATE '2026-10-02', 'restaurant', 'Rice & curry', 3550),
  (DATE '2026-10-02', 'hotel', 'Transport', 150),
  (DATE '2026-10-03', 'restaurant', 'Restaurant', 2800),
  (DATE '2026-10-03', 'hotel', 'Transport', 100),
  (DATE '2026-10-04', 'hotel', 'Room revenue', 15600),
  (DATE '2026-10-04', 'restaurant', 'Restaurant', 12760),
  (DATE '2026-10-05', 'restaurant', 'Restaurant', 4400),
  (DATE '2026-10-05', 'restaurant', 'Rice & curry', 2700),
  (DATE '2026-10-05', 'hotel', 'Transport', 100),
  (DATE '2026-10-06', 'restaurant', 'Rice & curry', 5300),
  (DATE '2026-10-06', 'hotel', 'Transport', 150),
  (DATE '2026-10-07', 'restaurant', 'Rice & curry', 9950),
  (DATE '2026-10-07', 'hotel', 'Transport', 450)
) AS v (sale_date, department, line, amount)
WHERE b."B_name" ILIKE 'Regent Heights%'
ON CONFLICT (b_id, sale_date, line) DO NOTHING;
