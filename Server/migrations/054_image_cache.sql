-- Photos that leave the server inside a list are sent as a link to a copy kept
-- here (utils/responseImages.js), keyed by the md5 of the stored data URL. It is
-- a cache, not the record: the photo stays where it is stored, and a row here
-- can always be made again from it.
CREATE TABLE IF NOT EXISTS "IMAGE_CACHE" (
  hash        CHAR(32) PRIMARY KEY,
  mime        VARCHAR(60) NOT NULL,
  bytes       BYTEA NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
