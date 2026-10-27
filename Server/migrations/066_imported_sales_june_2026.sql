-- June 2026, from the property's "SALES SUMMARY - 30th OF JUNE 2026" sheet.
--
-- 30 days with sales, LKR 833,721.64 in all: hotel 132,418.64, restaurant 701,303.00.
-- Room revenue 108,418.64, Basis guest meal 24,000.00, Restaurant 430,230.00, Café 181,790.00, Rice & curry 89,283.00, Transport 0.00, Laundry 0.00.
-- Every day's columns add up to its total and every column to the sheet's
-- total row. Blank cells and days with nothing in them have no row.
--
-- The sheet is the record for each day it covers: Reports leaves out whatever
-- the system itself holds for that day (trial entries before go-live), so
-- nothing is counted twice. See 060_imported_sales.sql.
INSERT INTO "IMPORTED_SALES" (b_id, sale_date, department, line, amount, source)
SELECT b."B_id", v.sale_date, v.department, v.line, v.amount, 'Sales summary, June 2026'
FROM "Branch" b
CROSS JOIN (VALUES
  (DATE '2026-06-01', 'restaurant', 'Café', 5870),
  (DATE '2026-06-01', 'restaurant', 'Rice & curry', 5380),
  (DATE '2026-06-02', 'restaurant', 'Restaurant', 13200),
  (DATE '2026-06-02', 'restaurant', 'Café', 4200),
  (DATE '2026-06-02', 'restaurant', 'Rice & curry', 4400),
  (DATE '2026-06-03', 'restaurant', 'Restaurant', 10780),
  (DATE '2026-06-03', 'restaurant', 'Café', 2575),
  (DATE '2026-06-03', 'restaurant', 'Rice & curry', 5300),
  (DATE '2026-06-04', 'restaurant', 'Café', 9680),
  (DATE '2026-06-04', 'restaurant', 'Rice & curry', 6000),
  (DATE '2026-06-05', 'restaurant', 'Café', 5790),
  (DATE '2026-06-05', 'restaurant', 'Rice & curry', 4450),
  (DATE '2026-06-06', 'restaurant', 'Café', 14200),
  (DATE '2026-06-06', 'restaurant', 'Rice & curry', 4725),
  (DATE '2026-06-07', 'restaurant', 'Café', 7050),
  (DATE '2026-06-07', 'restaurant', 'Rice & curry', 544),
  (DATE '2026-06-08', 'restaurant', 'Café', 5000),
  (DATE '2026-06-08', 'restaurant', 'Rice & curry', 6450),
  (DATE '2026-06-09', 'hotel', 'Room revenue', 30375),
  (DATE '2026-06-09', 'hotel', 'Basis guest meal', 3000),
  (DATE '2026-06-09', 'restaurant', 'Café', 1200),
  (DATE '2026-06-09', 'restaurant', 'Rice & curry', 3200),
  (DATE '2026-06-10', 'restaurant', 'Café', 4950),
  (DATE '2026-06-10', 'restaurant', 'Rice & curry', 2400),
  (DATE '2026-06-11', 'restaurant', 'Café', 6815),
  (DATE '2026-06-11', 'restaurant', 'Rice & curry', 1350),
  (DATE '2026-06-12', 'hotel', 'Room revenue', 38771.14),
  (DATE '2026-06-12', 'hotel', 'Basis guest meal', 11000),
  (DATE '2026-06-12', 'restaurant', 'Café', 5775),
  (DATE '2026-06-12', 'restaurant', 'Rice & curry', 3200),
  (DATE '2026-06-13', 'restaurant', 'Café', 2500),
  (DATE '2026-06-13', 'restaurant', 'Rice & curry', 2380),
  (DATE '2026-06-14', 'restaurant', 'Café', 5250),
  (DATE '2026-06-14', 'restaurant', 'Rice & curry', 5712),
  (DATE '2026-06-15', 'hotel', 'Room revenue', 27150),
  (DATE '2026-06-15', 'hotel', 'Basis guest meal', 4000),
  (DATE '2026-06-15', 'restaurant', 'Café', 5250),
  (DATE '2026-06-15', 'restaurant', 'Rice & curry', 700),
  (DATE '2026-06-16', 'restaurant', 'Café', 4815),
  (DATE '2026-06-16', 'restaurant', 'Rice & curry', 1200),
  (DATE '2026-06-17', 'restaurant', 'Café', 3650),
  (DATE '2026-06-17', 'restaurant', 'Rice & curry', 700),
  (DATE '2026-06-18', 'restaurant', 'Café', 900),
  (DATE '2026-06-18', 'restaurant', 'Rice & curry', 5750),
  (DATE '2026-06-19', 'restaurant', 'Café', 3850),
  (DATE '2026-06-19', 'restaurant', 'Rice & curry', 1750),
  (DATE '2026-06-20', 'restaurant', 'Café', 9355),
  (DATE '2026-06-20', 'restaurant', 'Rice & curry', 3500),
  (DATE '2026-06-21', 'hotel', 'Room revenue', 12122.5),
  (DATE '2026-06-21', 'hotel', 'Basis guest meal', 6000),
  (DATE '2026-06-21', 'restaurant', 'Restaurant', 406250),
  (DATE '2026-06-21', 'restaurant', 'Café', 6050),
  (DATE '2026-06-22', 'restaurant', 'Café', 13675),
  (DATE '2026-06-22', 'restaurant', 'Rice & curry', 3350),
  (DATE '2026-06-23', 'restaurant', 'Café', 3600),
  (DATE '2026-06-23', 'restaurant', 'Rice & curry', 650),
  (DATE '2026-06-24', 'restaurant', 'Café', 2390),
  (DATE '2026-06-24', 'restaurant', 'Rice & curry', 700),
  (DATE '2026-06-25', 'restaurant', 'Café', 6975),
  (DATE '2026-06-25', 'restaurant', 'Rice & curry', 2000),
  (DATE '2026-06-26', 'restaurant', 'Café', 1800),
  (DATE '2026-06-26', 'restaurant', 'Rice & curry', 1244),
  (DATE '2026-06-27', 'restaurant', 'Café', 10250),
  (DATE '2026-06-27', 'restaurant', 'Rice & curry', 3060),
  (DATE '2026-06-28', 'restaurant', 'Café', 9400),
  (DATE '2026-06-28', 'restaurant', 'Rice & curry', 4200),
  (DATE '2026-06-29', 'restaurant', 'Café', 17350),
  (DATE '2026-06-29', 'restaurant', 'Rice & curry', 2938),
  (DATE '2026-06-30', 'restaurant', 'Café', 1625),
  (DATE '2026-06-30', 'restaurant', 'Rice & curry', 2050)
) AS v (sale_date, department, line, amount)
WHERE b."B_name" ILIKE 'Regent Heights%'
ON CONFLICT (b_id, sale_date, line) DO NOTHING;
