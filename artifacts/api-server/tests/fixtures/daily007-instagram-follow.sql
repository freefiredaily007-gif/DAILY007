CREATE TABLE daily007_v2_users (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  role text NOT NULL CHECK (role IN ('user', 'tournament_admin', 'admin')),
  wallet_coins integer NOT NULL DEFAULT 0 CHECK (wallet_coins >= 0),
  phone text,
  game_uid text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  auth_version integer NOT NULL DEFAULT 0
);

CREATE TABLE daily007_v2_settings (
  id integer PRIMARY KEY DEFAULT 1,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid REFERENCES daily007_v2_users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
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

CREATE TABLE daily007_v2_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES daily007_v2_users(id),
  title text NOT NULL,
  body text NOT NULL,
  type text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE daily007_v2_instagram_follow_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES daily007_v2_users(id),
  instagram_username text
    CHECK (instagram_username IS NULL OR instagram_username ~ '^[A-Za-z0-9._]{1,30}$'),
  proof_text text CHECK (proof_text IS NULL OR length(proof_text) <= 1000),
  reward_coins integer NOT NULL CHECK (reward_coins BETWEEN 1 AND 2147483647),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  review_reason text,
  reviewed_by uuid REFERENCES daily007_v2_users(id),
  reward_ledger_id uuid UNIQUE REFERENCES daily007_v2_wallet_ledger(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);

CREATE INDEX daily007_instagram_claim_user_idx
  ON daily007_v2_instagram_follow_claims (user_id, created_at);
CREATE INDEX daily007_instagram_claim_status_idx
  ON daily007_v2_instagram_follow_claims (status, created_at);
CREATE UNIQUE INDEX daily007_instagram_one_pending_claim_per_user
  ON daily007_v2_instagram_follow_claims (user_id) WHERE status = 'pending';
CREATE UNIQUE INDEX daily007_instagram_one_completion_per_user
  ON daily007_v2_instagram_follow_claims (user_id) WHERE status = 'approved';
