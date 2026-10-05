type OpenUrl = (url: string) => Promise<unknown>;

export async function openYouTubeVideo(
  platform: string,
  videoId: string,
  videoUrl: string,
  openURL: OpenUrl,
): Promise<void> {
  if (platform === 'android') {
    try {
      await openURL(`vnd.youtube://${encodeURIComponent(videoId)}`);
      return;
    } catch {
      // Fall back to the saved HTTPS video URL if YouTube cannot handle the app link.
    }
  }

  await openURL(videoUrl);
}
