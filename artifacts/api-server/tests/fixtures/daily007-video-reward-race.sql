CREATE TABLE daily007_v2_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_salt text NOT NULL,
  password_hash text NOT NULL,
  auth_version integer NOT NULL DEFAULT 0,
  phone text,
  game_uid text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  role text NOT NULL DEFAULT 'user'
    CHECK (role IN ('user', 'tournament_admin', 'admin')),
  wallet_coins integer NOT NULL DEFAULT 0 CHECK (wallet_coins >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE daily007_v2_matches (
  id uuid PRIMARY KEY,
  title text NOT NULL
);

CREATE TABLE daily007_v2_registrations (
  id uuid PRIMARY KEY,
  match_id uuid NOT NULL REFERENCES daily007_v2_matches(id),
  captain_user_id uuid NOT NULL REFERENCES daily007_v2_users(id),
  captain_name text NOT NULL,
  captain_game_uid text NOT NULL,
  entry_coins_paid integer NOT NULL DEFAULT 0,
  status text NOT NULL
);

CREATE TABLE daily007_v2_result_awards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES daily007_v2_matches(id),
  registration_id uuid NOT NULL REFERENCES daily007_v2_registrations(id),
  user_id uuid NOT NULL REFERENCES daily007_v2_users(id),
  rank integer NOT NULL,
  kills integer NOT NULL,
  prize_coins integer NOT NULL
);

CREATE TABLE daily007_v2_wallet_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES daily007_v2_users(id),
  amount integer NOT NULL,
  balance_after integer NOT NULL CHECK (balance_after >= 0),
  reason text NOT NULL,
  match_id uuid REFERENCES daily007_v2_matches(id),
  registration_id uuid,
  idempotency_key text UNIQUE,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE daily007_v2_videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  topic text NOT NULL DEFAULT 'General' CHECK (length(btrim(topic)) BETWEEN 1 AND 80),
  youtube_id text NOT NULL UNIQUE
    CHECK (youtube_id ~ '^[A-Za-z0-9_-]{11}$'),
  category text NOT NULL DEFAULT 'youtube'
    CHECK (category IN ('application', 'youtube')),
  description text CHECK (description IS NULL OR length(description) <= 1000),
  publish_date date,
  thumbnail_url text CHECK (thumbnail_url IS NULL OR length(thumbnail_url) <= 500),
  display_order integer NOT NULL DEFAULT 0 CHECK (display_order >= 0),
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES daily007_v2_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE daily007_v2_video_watch_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES daily007_v2_users(id),
  video_id uuid NOT NULL REFERENCES daily007_v2_videos(id),
  duration_seconds integer NOT NULL CHECK (duration_seconds BETWEEN 5 AND 86400),
  start_attempt_id text,
  reported_percent integer NOT NULL DEFAULT 0 CHECK (reported_percent BETWEEN 0 AND 100),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  reward_ledger_id uuid UNIQUE REFERENCES daily007_v2_wallet_ledger(id),
  UNIQUE (user_id, start_attempt_id)
);

CREATE TABLE daily007_v2_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  settings jsonb NOT NULL DEFAULT '{}'::jsonb
);
