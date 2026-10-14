CREATE TABLE daily007_v2_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  clerk_user_id text UNIQUE,
  password_salt text NOT NULL,
  password_hash text NOT NULL,
  auth_version integer NOT NULL DEFAULT 0,
  phone text,
  game_uid text,
  referral_code text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'tournament_admin', 'admin')),
  wallet_coins integer NOT NULL DEFAULT 0 CHECK (wallet_coins >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE daily007_v2_referral_codes (
  user_id uuid PRIMARY KEY REFERENCES daily007_v2_users(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE
);

CREATE TABLE daily007_v2_referral_short_codes (
  user_id uuid PRIMARY KEY REFERENCES daily007_v2_users(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE
);

CREATE TABLE daily007_v2_referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_user_id uuid NOT NULL REFERENCES daily007_v2_users(id) ON DELETE CASCADE,
  referred_user_id uuid NOT NULL UNIQUE REFERENCES daily007_v2_users(id) ON DELETE CASCADE,
  code text NOT NULL
);

CREATE TABLE daily007_v2_wallet_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES daily007_v2_users(id) ON DELETE CASCADE,
  amount integer NOT NULL,
  balance_after integer NOT NULL CHECK (balance_after >= 0),
  reason text NOT NULL,
  match_id uuid,
  registration_id uuid,
  idempotency_key text UNIQUE,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE daily007_v2_matches (
  id uuid PRIMARY KEY,
  title text NOT NULL
);

CREATE TABLE daily007_login_rate_limits (
  client_ip_hash text PRIMARY KEY,
  attempts integer NOT NULL CHECK (attempts >= 1),
  expires_at timestamptz NOT NULL
);

CREATE INDEX daily007_login_rate_limits_expires_at_idx
  ON daily007_login_rate_limits (expires_at);
