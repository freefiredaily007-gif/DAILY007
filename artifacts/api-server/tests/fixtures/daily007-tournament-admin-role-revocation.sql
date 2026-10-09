CREATE TABLE daily007_v2_users (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  clerk_user_id text,
  password_salt text NOT NULL,
  password_hash text NOT NULL,
  auth_version integer NOT NULL DEFAULT 0,
  phone text,
  game_uid text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'tournament_admin', 'admin')),
  wallet_coins integer NOT NULL DEFAULT 0 CHECK (wallet_coins >= 0)
);

CREATE TABLE daily007_v2_matches (
  id uuid PRIMARY KEY,
  status text NOT NULL DEFAULT 'upcoming',
  room_id text,
  room_password text,
  room_published boolean NOT NULL DEFAULT false
);
