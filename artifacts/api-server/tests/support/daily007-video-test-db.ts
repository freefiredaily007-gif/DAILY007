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
  category: "application" | "youtube";
  description: string | null;
  publish_date: string | null;
  thumbnail_url: string | null;
  display_order: number;
  active: boolean;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
};

type TestWatchSession = {
  id: string;
  user_id: string;
  video_id: string;
  duration_seconds: number;
  reported_percent: number;
  started_at: Date;
  completed_at: Date | null;
  reward_ledger_id: string | null;
};

export const VIDEO_TEST_ADMIN_ID = "51000000-0000-4000-8000-000000000001";
export const VIDEO_TEST_PLAYER_ID = "51000000-0000-4000-8000-000000000002";
export const VIDEO_TEST_TOURNAMENT_ADMIN_ID = "51000000-0000-4000-8000-000000000003";

class Daily007VideoTestDatabase {
  users = new Map<string, TestUser>();
  videos: TestVideo[] = [];
  watchSessions: TestWatchSession[] = [];
  private nextVideoId = 1;
  private videoCatalogSeeded = false;

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
      [VIDEO_TEST_TOURNAMENT_ADMIN_ID, {
        id: VIDEO_TEST_TOURNAMENT_ADMIN_ID,
        name: "Video Test Tournament Admin",
        email: "video-tournament-admin@example.test",
        role: "tournament_admin",
        wallet_coins: 0,
        phone: null,
        game_uid: null,
        status: "active",
        auth_version: 0,
      }],
    ]);
    this.videos = [];
    this.watchSessions = [];
    this.nextVideoId = 1;
    this.videoCatalogSeeded = false;
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
    } else if (normalized.startsWith("INSERT INTO daily007_v2_settings")) {
      if (normalized.includes("__daily007VideoCatalogSeeded")) this.videoCatalogSeeded = true;
      rows = [];
    } else if (normalized.includes("SELECT COALESCE((settings->>'__daily007VideoCatalogSeeded')::boolean, false) AS seeded")) {
      rows = [{ seeded: this.videoCatalogSeeded }];
    } else if (normalized.startsWith("INSERT INTO daily007_v2_videos")) {
      if (normalized.includes("WHERE NOT EXISTS") && this.videos.length > 0) {
        rows = [];
      } else {
      const [
        title,
        topic,
        youtubeId,
        category = "youtube",
        description = null,
        publishDate = "2026-10-05",
        thumbnailUrl = null,
        displayOrder = 0,
        active = true,
        createdBy = null,
      ] = values as [string, string, string, string?, string | null?, string | Date?, string | null?, number?, boolean?, string | null?];
      if (this.videos.some((video) => video.youtube_id === youtubeId)) {
        throw Object.assign(new Error("duplicate video URL"), { code: "23505" });
      }
      const sequence = this.nextVideoId++;
      const now = new Date("2026-10-05T12:00:00.000Z");
      const id = `52000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
      const video: TestVideo = {
        id,
        title,
        topic,
        youtube_id: youtubeId,
        category: category === "application" ? "application" : "youtube",
        description,
        publish_date: publishDate instanceof Date ? publishDate.toISOString().slice(0, 10) : publishDate,
        thumbnail_url: thumbnailUrl,
        display_order: Number(displayOrder),
        active: Boolean(active),
        created_by: createdBy,
        created_at: now,
        updated_at: now,
      };
      this.videos.push(video);
      rows = [this.toApiVideo(video)];
      }
    } else if (normalized === "SELECT id FROM daily007_v2_settings WHERE id = 1 FOR UPDATE") {
      rows = [{ id: 1 }];
    } else if (normalized.startsWith(
      "SELECT youtube_id, topic, category, description, publish_date, thumbnail_url, display_order, active FROM daily007_v2_videos WHERE id = $1 FOR UPDATE",
    )) {
      const video = this.videos.find((entry) => entry.id === String(values[0] ?? ""));
      rows = video ? [{
        youtube_id: video.youtube_id,
        topic: video.topic,
        category: video.category,
        description: video.description,
        publish_date: video.publish_date,
        thumbnail_url: video.thumbnail_url,
        display_order: video.display_order,
        active: video.active,
      }] : [];
    } else if (normalized.startsWith(
      "SELECT id FROM daily007_v2_videos WHERE id = $1 FOR UPDATE",
    )) {
      const video = this.videos.find((entry) => entry.id === String(values[0] ?? ""));
      rows = video ? [{ id: video.id }] : [];
    } else if (normalized.startsWith(
      "SELECT EXISTS ( SELECT 1 FROM daily007_v2_video_watch_sessions WHERE video_id = $1 ) AS",
    )) {
      const videoId = String(values[0] ?? "");
      rows = [{
        hasSessions: this.watchSessions.some((session) => session.video_id === videoId),
      }];
    } else if (normalized.startsWith(
      "UPDATE daily007_v2_videos SET title = $2, topic = $3, youtube_id = $4, category = $5",
    )) {
      const [id, title, topic, youtubeId, category, description, publishDate, thumbnailUrl, displayOrder, active] = values;
      if (this.videos.some((entry) => entry.id !== id && entry.youtube_id === youtubeId)) {
        throw Object.assign(new Error("duplicate video URL"), { code: "23505" });
      }
      const video = this.videos.find((entry) => entry.id === id);
      if (video) {
        video.title = String(title);
        video.topic = String(topic);
        video.youtube_id = String(youtubeId);
        video.category = category === "application" ? "application" : "youtube";
        video.description = description as string | null;
        video.publish_date = publishDate instanceof Date
          ? publishDate.toISOString().slice(0, 10)
          : publishDate as string | null;
        video.thumbnail_url = thumbnailUrl as string | null;
        video.display_order = Number(displayOrder);
        video.active = Boolean(active);
        video.updated_at = new Date("2026-10-06T12:00:00.000Z");
      }
      rows = video ? [this.toApiVideo(video)] : [];
    } else if (normalized === "DELETE FROM daily007_v2_videos WHERE id = $1") {
      const videoId = String(values[0] ?? "");
      if (this.watchSessions.some((session) => session.video_id === videoId)) {
        throw Object.assign(new Error("video has watch-session records"), { code: "23503" });
      }
      this.videos = this.videos.filter((video) => video.id !== videoId);
      rows = [];
    } else if (normalized.startsWith(
      "UPDATE daily007_v2_videos SET active = $2",
    )) {
      const [id, active] = values as [string, boolean];
      const video = this.videos.find((entry) => entry.id === id);
      if (video) {
        video.active = active;
        video.updated_at = new Date("2026-10-06T12:00:00.000Z");
      }
      rows = video ? [this.toApiVideo(video)] : [];
    } else if (normalized.startsWith("SELECT id, title, topic, youtube_id AS \"youtubeId\", category, description,")) {
      const activeOnly = normalized.includes("WHERE active = true");
      rows = this.videos
        .filter((video) => !activeOnly || video.active)
        .map((video) => this.toApiVideo(video));
    } else {
      throw new Error(`Unexpected video test SQL: ${normalized}`);
    }

    return { rows: rows as T[] };
  }

  private toApiVideo(video: TestVideo) {
    return {
      id: video.id,
      title: video.title,
      topic: video.topic,
      youtubeId: video.youtube_id,
      category: video.category,
      description: video.description,
      publishDate: video.publish_date,
      thumbnailUrl: video.thumbnail_url,
      displayOrder: video.display_order,
      active: video.active,
      createdAt: video.created_at,
      updatedAt: video.updated_at,
    };
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