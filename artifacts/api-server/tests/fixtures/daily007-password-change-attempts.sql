CREATE TABLE daily007_v2_users (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  clerk_user_id text UNIQUE,
  password_salt text NOT NULL,
  password_hash text NOT NULL,
  auth_version integer NOT NULL DEFAULT 0,
  phone text,
  game_uid text,
  referral_code text,
  status text NOT NULL DEFAULT 'active',
  role text NOT NULL DEFAULT 'user',
  wallet_coins integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE daily007_password_change_attempts (
  user_id uuid PRIMARY KEY REFERENCES daily007_v2_users(id) ON DELETE CASCADE,
  window_id uuid NOT NULL,
  failures integer NOT NULL DEFAULT 0 CHECK (failures >= 0),
  in_flight integer NOT NULL DEFAULT 0 CHECK (in_flight >= 0),
  expires_at timestamptz NOT NULL,
  CHECK (failures + in_flight <= 5)
);

CREATE TABLE daily007_test_password_change_attempt_control (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  armed boolean NOT NULL DEFAULT false,
  pause_settlement boolean NOT NULL DEFAULT false
);

INSERT INTO daily007_test_password_change_attempt_control (singleton)
VALUES (true);
