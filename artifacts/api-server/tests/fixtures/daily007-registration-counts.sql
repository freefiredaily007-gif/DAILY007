\ir daily007-squad-slots.sql

ALTER TABLE daily007_v2_matches
  ADD COLUMN rules text NOT NULL DEFAULT '',
  ADD COLUMN banner text NOT NULL DEFAULT '',
  ADD COLUMN image_url text,
  ADD COLUMN room_id text,
  ADD COLUMN room_password text,
  ADD COLUMN room_time text NOT NULL DEFAULT '',
  ADD COLUMN room_published boolean NOT NULL DEFAULT false;
