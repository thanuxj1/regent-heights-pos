-- 048 — Widen delivery_partner columns to match DELIVERY_PARTNER.key.
--
-- ORDER.delivery_partner and DELIVERY_COD_SETTLEMENT.delivery_partner were
-- both VARCHAR(20), but the key they store (created_by createDeliveryPartner's
-- uniqueKey(), a slug of the partner's own name) lives in DELIVERY_PARTNER.key
-- as VARCHAR(30). A partner given a name that slugifies past 20 characters
-- (e.g. "International Express Couriers") could be created successfully, but
-- every order tagged with them then failed with a raw 500 — "value too long
-- for type character varying(20)" — since nothing validates the slug's length
-- against the shorter column it's actually written into later. Found by the
-- QA suite's delivery-partner test, not a report from real use.
ALTER TABLE "ORDER" ALTER COLUMN delivery_partner TYPE VARCHAR(30);
ALTER TABLE "DELIVERY_COD_SETTLEMENT" ALTER COLUMN delivery_partner TYPE VARCHAR(30);
