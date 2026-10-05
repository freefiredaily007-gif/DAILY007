type TestRole = "user" | "admin" | "tournament_admin";

type TestUser = {
  id: string;
  name: string;
  email: string;
  role: TestRole;
  wallet_coins: number;
  phone: null;
  game_uid: null;
  status: "active";
  auth_version: number;
};

type TestVideo = {
  id: string;
  title: string;
  topic: string;
  youtube_id: string;
  active: boolean;
  created_by: string;
  created_at: Date;
};

export const VIDEO_TEST_ADMIN_ID = "51000000-0000-4000-8000-000000000001";
export const VIDEO_TEST_PLAYER_ID = "51000000-0000-4000-8000-000000000002";

class Daily007VideoTestDatabase {
  users = new Map<string, TestUser>();
  videos: TestVideo[] = [];
  private nextVideoId = 1;

  reset(): void {
    this.users = new Map([
      [VIDEO_TEST_ADMIN_ID, {
        id: VIDEO_TEST_ADMIN_ID,
        name: "Video Test Admin",
        email: "video-admin@example.test",
        role: "admin",
        wallet_coins: 0,
        phone: null,
        game_uid: null,
        status: "active",
        auth_version: 0,
      }],
      [VIDEO_TEST_PLAYER_ID, {
        id: VIDEO_TEST_PLAYER_ID,
        name: "Video Test Player",
        email: "video-player@example.test",
        role: "user",
        wallet_coins: 0,
        phone: null,
        game_uid: null,
        status: "active",
        auth_version: 0,
      }],
    ]);
    this.videos = [];
    this.nextVideoId = 1;
  }

  async query<T = unknown>(sql: string, values: unknown[] = []): Promise<{ rows: T[] }> {
    const normalized = sql.replace(/\s+/g, " ").trim();
    let rows: unknown[];

    if (normalized.startsWith(
      "SELECT id, name, email, role, wallet_coins, phone, game_uid, status, auth_version FROM daily007_v2_users",
    )) {
      const user = this.users.get(String(values[0] ?? ""));
      rows = user ? [structuredClone(user)] : [];
    } else if (normalized === "SELECT pg_advisory_xact_lock_shared(740073)") {
      rows = [];
    } else if (normalized === "SELECT role, status FROM daily007_v2_users WHERE id = $1 FOR SHARE") {
      const user = this.users.get(String(values[0] ?? ""));
      rows = user ? [{ role: user.role, status: user.status }] : [];
    } else if (normalized.startsWith("INSERT INTO daily007_v2_videos")) {
      const [title, topic, youtubeId, createdBy] = values as [string, string, string, string];
      if (this.videos.some((video) => video.youtube_id === youtubeId)) {
        throw Object.assign(new Error("duplicate video URL"), { code: "23505" });
      }
      const sequence = this.nextVideoId++;
      const id = `52000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
      const video: TestVideo = {
        id,
        title,
        topic,
        youtube_id: youtubeId,
        active: true,
        created_by: createdBy,
        created_at: new Date("2026-10-05T12:00:00.000Z"),
      };
      this.videos.push(video);
      rows = [{
        id: video.id,
        title: video.title,
        topic: video.topic,
        youtubeId: video.youtube_id,
        active: video.active,
        createdAt: video.created_at,
      }];
    } else if (normalized.startsWith("SELECT id, title, topic, youtube_id AS \"youtubeId\", active, created_at AS \"createdAt\" FROM daily007_v2_videos")) {
      const activeOnly = normalized.includes("WHERE active = true");
      rows = this.videos
        .filter((video) => !activeOnly || video.active)
        .map((video) => ({
          id: video.id,
          title: video.title,
          topic: video.topic,
          youtubeId: video.youtube_id,
          active: video.active,
          createdAt: video.created_at,
        }));
    } else {
      throw new Error(`Unexpected video test SQL: ${normalized}`);
    }

    return { rows: rows as T[] };
  }
}

export const videoTestDb = new Daily007VideoTestDatabase();
videoTestDb.reset();

export const pool = {
  query: <T = unknown>(sql: string, values?: unknown[]) => videoTestDb.query<T>(sql, values),
  connect: async () => ({
    query: async <T = unknown>(sql: string, values?: unknown[]) => {
      const normalized = (sql ?? "").replace(/\s+/g, " ").trim();
      if (normalized === "BEGIN" || normalized === "COMMIT" || normalized === "ROLLBACK") {
        return { rows: [] as T[] };
      }
      return videoTestDb.query<T>(normalized, values);
    },
    release: () => {},
  }),
};