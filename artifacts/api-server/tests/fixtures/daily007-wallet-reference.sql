CREATE TABLE daily007_v2_users (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_salt text NOT NULL,
  password_hash text NOT NULL,
  auth_version integer NOT NULL DEFAULT 0,
  phone text,
  game_uid text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'tournament_admin', 'admin')),
  wallet_coins integer NOT NULL DEFAULT 0 CHECK (wallet_coins >= 0)
);

CREATE TABLE daily007_v2_referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_user_id uuid NOT NULL REFERENCES daily007_v2_users(id),
  referred_user_id uuid NOT NULL UNIQUE REFERENCES daily007_v2_users(id),
  code text NOT NULL,
  rewarded_at timestamptz
);

CREATE TABLE daily007_v2_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES daily007_v2_users(id),
  coins integer NOT NULL CHECK (coins BETWEEN 1 AND 2147483647),
  amount integer NOT NULL,
  payer_upi_id text,
  reference_normalized text NOT NULL UNIQUE,
  reference text NOT NULL,
  proof_object_path text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'deleted')),
  review_reason text,
  reviewed_by uuid REFERENCES daily007_v2_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);
CREATE UNIQUE INDEX daily007_one_pending_payment_per_user
  ON daily007_v2_payments (user_id)
  WHERE status = 'pending';

CREATE TABLE daily007_v2_withdrawals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES daily007_v2_users(id),
  coins integer NOT NULL CHECK (coins BETWEEN 1 AND 2147483647),
  method text NOT NULL,
  account text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'deleted')),
  payout_status text NOT NULL DEFAULT 'not_paid'
    CHECK (payout_status IN ('not_paid', 'manual_payout_required', 'paid')),
  review_reason text,
  reviewed_by uuid REFERENCES daily007_v2_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  paid_at timestamptz
);
CREATE INDEX daily007_withdrawal_user_idx
  ON daily007_v2_withdrawals (user_id, created_at);
CREATE UNIQUE INDEX daily007_one_pending_withdrawal_per_user
  ON daily007_v2_withdrawals (user_id)
  WHERE status = 'pending';

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

CREATE TABLE daily007_v2_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
