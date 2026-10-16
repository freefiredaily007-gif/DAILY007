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

CREATE TABLE daily007_v2_result_awards (
  match_id uuid NOT NULL,
  registration_id uuid NOT NULL,
  user_id uuid NOT NULL,
  rank integer NOT NULL,
  kills integer NOT NULL
);

CREATE SEQUENCE daily007_test_referral_reward_failure_seq START 1;

CREATE FUNCTION daily007_test_fail_first_referral_reward()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.reason = 'Referral Signup Bonus'
     AND nextval('daily007_test_referral_reward_failure_seq') = 1 THEN
    PERFORM pg_advisory_xact_lock(743003, 1);
    RAISE EXCEPTION 'Injected one-time referral signup ledger failure';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER daily007_test_referral_reward_failure
BEFORE INSERT ON daily007_v2_wallet_ledger
FOR EACH ROW
EXECUTE FUNCTION daily007_test_fail_first_referral_reward();
