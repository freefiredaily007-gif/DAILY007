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
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'tournament_admin', 'admin')),
  wallet_coins integer NOT NULL DEFAULT 0
);

CREATE TABLE daily007_v2_google_recovery_requests (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES daily007_v2_users(id) ON DELETE CASCADE,
  google_clerk_user_id text NOT NULL,
  google_email text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES daily007_v2_users(id),
  review_note text,
  review_method text
);

CREATE TABLE daily007_test_google_link_gate (
  user_id uuid PRIMARY KEY REFERENCES daily007_v2_users(id) ON DELETE CASCADE,
  winning_clerk_user_id text NOT NULL
);

CREATE FUNCTION daily007_test_pause_winning_google_link()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.clerk_user_id IS DISTINCT FROM OLD.clerk_user_id
     AND EXISTS (
       SELECT 1
         FROM daily007_test_google_link_gate
        WHERE user_id = NEW.id
          AND winning_clerk_user_id = NEW.clerk_user_id
     ) THEN
    PERFORM pg_advisory_xact_lock(743051, 1);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER daily007_test_pause_winning_google_link
AFTER UPDATE OF clerk_user_id ON daily007_v2_users
FOR EACH ROW
EXECUTE FUNCTION daily007_test_pause_winning_google_link();
