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

CREATE TABLE daily007_v2_wallet_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES daily007_v2_users(id),
  amount integer NOT NULL,
  balance_after integer NOT NULL CHECK (balance_after >= 0),
  reason text NOT NULL,
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
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES daily007_v2_users(id),
  created_at timestamptz NOT NULL DEFAULT now()
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
