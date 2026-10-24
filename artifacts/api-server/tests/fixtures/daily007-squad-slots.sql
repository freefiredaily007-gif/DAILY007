CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE daily007_v2_users (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_salt text NOT NULL,
  password_hash text NOT NULL,
  auth_version integer NOT NULL DEFAULT 0,
  phone text,
  game_uid text,
  status text NOT NULL DEFAULT 'active',
  role text NOT NULL DEFAULT 'user',
  wallet_coins integer NOT NULL DEFAULT 0 CHECK (wallet_coins >= 0)
);

CREATE TABLE daily007_v2_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  mode text NOT NULL,
  game_mode text,
  team_type text,
  capacity integer NOT NULL,
  entry_coins integer NOT NULL DEFAULT 0,
  prize_pool integer NOT NULL DEFAULT 0,
  kill_reward_coins integer NOT NULL DEFAULT 0,
  prize_distribution text NOT NULL DEFAULT '',
  rules text NOT NULL DEFAULT '',
  banner text NOT NULL DEFAULT '',
  image_url text,
  enabled boolean NOT NULL DEFAULT true,
  starts_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'open',
  is_full boolean NOT NULL DEFAULT false,
  room_id text,
  room_password text,
  room_time text,
  room_published boolean NOT NULL DEFAULT false
);

CREATE TABLE daily007_v2_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES daily007_v2_matches(id) ON DELETE CASCADE,
  captain_user_id uuid NOT NULL REFERENCES daily007_v2_users(id),
  captain_name text NOT NULL,
  captain_game_name text NOT NULL DEFAULT '',
  captain_game_uid text NOT NULL,
  team_name text NOT NULL DEFAULT '',
  assigned_group_number integer,
  entry_coins_paid integer NOT NULL CHECK (entry_coins_paid >= 0),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'removed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_id, captain_user_id),
  CHECK (assigned_group_number IS NULL OR assigned_group_number > 0),
  CHECK (length(btrim(captain_game_uid)) > 0)
);
CREATE UNIQUE INDEX daily007_v2_registration_active_group_once
  ON daily007_v2_registrations (match_id, assigned_group_number)
  WHERE assigned_group_number IS NOT NULL AND status IN ('approved', 'pending');

CREATE TABLE daily007_v2_roster (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id uuid NOT NULL REFERENCES daily007_v2_registrations(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position BETWEEN 1 AND 3),
  member_uid text,
  member_name text NOT NULL,
  UNIQUE (registration_id, position)
);

CREATE TABLE daily007_v2_squad_teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES daily007_v2_matches(id) ON DELETE CASCADE,
  team_number integer NOT NULL CHECK (team_number BETWEEN 1 AND 24),
  captain_registration_id uuid REFERENCES daily007_v2_registrations(id) ON DELETE SET NULL,
  legacy_registration_id uuid REFERENCES daily007_v2_registrations(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_id, team_number)
);
CREATE UNIQUE INDEX daily007_v2_squad_team_captain_unique
  ON daily007_v2_squad_teams(captain_registration_id)
  WHERE captain_registration_id IS NOT NULL;
CREATE UNIQUE INDEX daily007_v2_squad_team_legacy_registration_unique
  ON daily007_v2_squad_teams(legacy_registration_id)
  WHERE legacy_registration_id IS NOT NULL;

CREATE TABLE daily007_v2_squad_team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES daily007_v2_squad_teams(id) ON DELETE CASCADE,
  slot_number integer NOT NULL CHECK (slot_number BETWEEN 1 AND 4),
  registration_id uuid REFERENCES daily007_v2_registrations(id) ON DELETE CASCADE,
  legacy_game_name text,
  legacy_game_uid text,
  is_active boolean NOT NULL DEFAULT true,
  removed_at timestamptz,
  removed_by_user_id uuid REFERENCES daily007_v2_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (registration_id IS NOT NULL AND legacy_game_name IS NULL AND legacy_game_uid IS NULL)
    OR (registration_id IS NULL AND legacy_game_name IS NOT NULL
      AND length(btrim(legacy_game_name)) > 0
      AND (legacy_game_uid IS NULL OR length(btrim(legacy_game_uid)) > 0))
  ),
  CHECK (
    (is_active = true AND removed_at IS NULL)
    OR (is_active = false AND removed_at IS NOT NULL)
  )
);
CREATE UNIQUE INDEX daily007_v2_squad_team_member_active_slot_unique
  ON daily007_v2_squad_team_members(team_id, slot_number)
  WHERE is_active = true;
CREATE UNIQUE INDEX daily007_v2_squad_team_member_registration_unique
  ON daily007_v2_squad_team_members(registration_id)
  WHERE registration_id IS NOT NULL;

CREATE TABLE daily007_v2_wallet_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES daily007_v2_users(id),
  amount integer NOT NULL,
  balance_after integer NOT NULL CHECK (balance_after >= 0),
  reason text NOT NULL,
  match_id uuid REFERENCES daily007_v2_matches(id),
  registration_id uuid REFERENCES daily007_v2_registrations(id),
  idempotency_key text UNIQUE,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE daily007_v2_result_awards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES daily007_v2_matches(id),
  registration_id uuid NOT NULL UNIQUE REFERENCES daily007_v2_registrations(id),
  user_id uuid NOT NULL REFERENCES daily007_v2_users(id),
  rank integer NOT NULL,
  kills integer NOT NULL,
  prize_coins integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
