-- Pampered.
--
-- One table. Every row is one place a dog could be welcome, and every row says
-- where it came from, because a directory that cannot tell you whether a venue
-- has been checked by a person is a directory nobody should trust.
--
-- Apply with:  npm run db:schema:local   /   npm run db:schema:remote

CREATE TABLE IF NOT EXISTS places (
  -- 'osm:node/12345' or 'manual:the-dog-and-duck'. Stable across refreshes, so
  -- a shared link to a venue keeps working after the data is re-imported.
  id            TEXT PRIMARY KEY,

  -- 'osm' | 'curated' | 'manual'. The UI shows a different badge for each and is
  -- forbidden from calling a 'manual' row checked.
  source        TEXT NOT NULL,
  -- Only ever true for 'curated'. Enforced by scripts/validate.mjs.
  verified      INTEGER NOT NULL DEFAULT 0,

  -- Nullable because an unnamed dog park drawn as a polygon is still a shape
  -- worth seeing on the map. Unnamed *nodes* are skipped at import (a pin with
  -- no name is noise); unnamed areas survive and the UI falls back to the
  -- selection label. Curated rows must always have a name — enforced by
  -- scripts/validate.mjs, not by the database.
  name          TEXT,

  -- JSON array of ids from content/selections.yaml. Computed once at import time
  -- so the browser never has to re-evaluate OpenStreetMap tag rules.
  selections    TEXT NOT NULL DEFAULT '[]',
  -- The selection whose colour the pin takes when a row is in more than one.
  primary_sel   TEXT,

  lat           REAL NOT NULL,
  lon           REAL NOT NULL,

  street        TEXT,
  city          TEXT,
  region        TEXT,
  postcode      TEXT,
  phone         TEXT,
  website       TEXT,
  instagram     TEXT,
  image         TEXT,

  opening_hours TEXT,
  dog_policy    TEXT,
  outdoor_seating TEXT,
  wheelchair    TEXT,
  cuisine       TEXT,

  -- A link out to whoever already takes the booking. We never hold a payment.
  booking_url   TEXT,
  booking_label TEXT,

  -- What a dog owner actually wants to read. Mappers never write this.
  notes         TEXT,

  -- 'osm:node/12345 @ 2026-10-14T15:54:36Z'. Non-null because a row that cannot
  -- say where it came from is not allowed into the database.
  provenance    TEXT NOT NULL,
  -- OSM's own timestamp for the element, so stale rows are visible as stale.
  osm_updated   TEXT,

  -- Set by scripts/sync-d1.mjs rather than by a column default, because a
  -- STRICT table may not carry an expression default and because an upsert
  -- needs to tell "first seen" from "last changed".
  created_at    TEXT NOT NULL DEFAULT '',
  updated_at    TEXT NOT NULL DEFAULT ''
) STRICT;

-- The one query that matters is "everything in this box", and this index is the
-- only reason that stays fast as the table grows past a hundred thousand rows.
CREATE INDEX IF NOT EXISTS idx_places_bbox ON places (lat, lon);
CREATE INDEX IF NOT EXISTS idx_places_source ON places (source);
CREATE INDEX IF NOT EXISTS idx_places_primary ON places (primary_sel);

-- A standalone FTS5 table rather than an external-content one.
--
-- The obvious alternative links places_fts to places(rowid), which breaks under
-- VACUUM and makes `rebuild` the only way to recover. Duplicating four short
-- strings across twenty thousand rows costs a few hundred kilobytes and removes
-- every one of those failure modes, including the sync script having to care
-- about rowid identity.
CREATE VIRTUAL TABLE IF NOT EXISTS places_fts USING fts5 (
  place_id UNINDEXED,
  name,
  street,
  city,
  postcode,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS places_ai AFTER INSERT ON places BEGIN
  INSERT INTO places_fts (place_id, name, street, city, postcode)
  VALUES (new.id, new.name, new.street, new.city, new.postcode);
END;

CREATE TRIGGER IF NOT EXISTS places_ad AFTER DELETE ON places BEGIN
  DELETE FROM places_fts WHERE place_id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS places_au AFTER UPDATE ON places BEGIN
  DELETE FROM places_fts WHERE place_id = old.id;
  INSERT INTO places_fts (place_id, name, street, city, postcode)
  VALUES (new.id, new.name, new.street, new.city, new.postcode);
END;

-- Where the curated layer lives on the server, so a visitor can be told the
-- difference between "we know this" and "somebody told us this".
CREATE TABLE IF NOT EXISTS sync_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ran_at       TEXT NOT NULL,
  -- Which command wrote this: 'refresh' | 'sync' | 'schema'.
  command      TEXT NOT NULL,
  rows_written INTEGER NOT NULL DEFAULT 0,
  rows_deleted INTEGER NOT NULL DEFAULT 0,
  source       TEXT,
  detail       TEXT
) STRICT;