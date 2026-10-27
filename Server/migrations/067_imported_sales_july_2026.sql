-- July 2026, from the property's "SALES SUMMARY - 31st OF JULY 2026" sheet.
--
-- 27 days with sales, LKR 513,178.16 in all: hotel 371,353.16, restaurant 141,825.00.
-- Room revenue 338,353.16, Basis guest meal 33,000.00, Restaurant 41,650.00, Café 100,175.00, Rice & curry 0.00, Transport 0.00, Laundry 0.00.
-- Every day's columns add up to its total and every column to the sheet's
-- total row. Blank cells and days with nothing in them have no row.
--
-- The sheet is the record for each day it covers: Reports leaves out whatever
-- the system itself holds for that day (trial entries before go-live), so
-- nothing is counted twice. See 060_imported_sales.sql.
INSERT INTO "IMPORTED_SALES" (b_id, sale_date, department, line, amount, source)
SELECT b."B_id", v.sale_date, v.department, v.line, v.amount, 'Sales summary, July 2026'
FROM "Branch" b
CROSS JOIN (VALUES
  (DATE '2026-07-01', 'hotel', 'Room revenue', 18930),
  (DATE '2026-07-01', 'hotel', 'Basis guest meal', 3000),
  (DATE '2026-07-01', 'restaurant', 'Café', 3300),
  (DATE '2026-07-03', 'restaurant', 'Café', 10750),
  (DATE '2026-07-04', 'hotel', 'Room revenue', 15440),
  (DATE '2026-07-04', 'hotel', 'Basis guest meal', 3000),
  (DATE '2026-07-04', 'restaurant', 'Café', 775),
  (DATE '2026-07-05', 'restaurant', 'Café', 2500),
  (DATE '2026-07-06', 'hotel', 'Room revenue', 15125),
  (DATE '2026-07-06', 'hotel', 'Basis guest meal', 1000),
  (DATE '2026-07-07', 'hotel', 'Room revenue', 15125),
  (DATE '2026-07-07', 'hotel', 'Basis guest meal', 1000),
  (DATE '2026-07-07', 'restaurant', 'Café', 2500),
  (DATE '2026-07-08', 'restaurant', 'Café', 2675),
  (DATE '2026-07-09', 'restaurant', 'Café', 325),
  (DATE '2026-07-10', 'hotel', 'Room revenue', 13848),
  (DATE '2026-07-10', 'hotel', 'Basis guest meal', 2000),
  (DATE '2026-07-10', 'restaurant', 'Café', 200),
  (DATE '2026-07-11', 'restaurant', 'Café', 6300),
  (DATE '2026-07-12', 'restaurant', 'Restaurant', 37250),
  (DATE '2026-07-12', 'restaurant', 'Café', 14075),
  (DATE '2026-07-13', 'hotel', 'Room revenue', 22355),
  (DATE '2026-07-13', 'hotel', 'Basis guest meal', 3000),
  (DATE '2026-07-13', 'restaurant', 'Café', 100),
  (DATE '2026-07-15', 'restaurant', 'Café', 7200),
  (DATE '2026-07-16', 'restaurant', 'Café', 2860),
  (DATE '2026-07-17', 'restaurant', 'Café', 4300),
  (DATE '2026-07-18', 'restaurant', 'Café', 15825),
  (DATE '2026-07-19', 'restaurant', 'Café', 2200),
  (DATE '2026-07-20', 'restaurant', 'Café', 3370),
  (DATE '2026-07-22', 'hotel', 'Room revenue', 29776),
  (DATE '2026-07-22', 'hotel', 'Basis guest meal', 4000),
  (DATE '2026-07-23', 'hotel', 'Room revenue', 15600),
  (DATE '2026-07-23', 'restaurant', 'Café', 7265),
  (DATE '2026-07-24', 'hotel', 'Room revenue', 31225),
  (DATE '2026-07-24', 'hotel', 'Basis guest meal', 2000),
  (DATE '2026-07-24', 'restaurant', 'Restaurant', 4400),
  (DATE '2026-07-25', 'hotel', 'Room revenue', 95275),
  (DATE '2026-07-25', 'hotel', 'Basis guest meal', 11000),
  (DATE '2026-07-25', 'restaurant', 'Café', 8165),
  (DATE '2026-07-26', 'hotel', 'Room revenue', 32452.16),
  (DATE '2026-07-26', 'restaurant', 'Café', 2000),
  (DATE '2026-07-27', 'restaurant', 'Café', 1000),
  (DATE '2026-07-28', 'hotel', 'Room revenue', 15600),
  (DATE '2026-07-29', 'hotel', 'Room revenue', 17602),
  (DATE '2026-07-29', 'hotel', 'Basis guest meal', 3000),
  (DATE '2026-07-29', 'restaurant', 'Café', 750),
  (DATE '2026-07-30', 'restaurant', 'Café', 1740)
) AS v (sale_date, department, line, amount)
WHERE b."B_name" ILIKE 'Regent Heights%'
ON CONFLICT (b_id, sale_date, line) DO NOTHING;
