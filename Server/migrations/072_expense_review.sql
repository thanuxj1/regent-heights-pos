-- An expense held for checking, and where an imported one came from.
--
-- The property's expense sheet marks some lines "possible duplicate": a bill
-- written up twice, once from the bill sheet and once by hand. Nobody can say
-- which without the paper bills, so such a line is kept but held: while
-- exp_review_note is set it is left out of every total and report, and the
-- Accounting page lists it under "To check" with the note saying what it may
-- repeat. Someone with the bills then counts it (the note is cleared) or
-- deletes it.
ALTER TABLE "EXPENSE" ADD COLUMN IF NOT EXISTS exp_review_note TEXT;
-- Where an imported expense came from ("expenses-sheet-2026:August#84"); null
-- for one typed into the system.
ALTER TABLE "EXPENSE" ADD COLUMN IF NOT EXISTS exp_source VARCHAR(60);
CREATE INDEX IF NOT EXISTS expense_held ON "EXPENSE" (b_id) WHERE exp_review_note IS NOT NULL;
