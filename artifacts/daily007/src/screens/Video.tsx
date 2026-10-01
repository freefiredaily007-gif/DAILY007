import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import WebView from 'react-native-webview';
import { useColors } from '@/hooks/useColors';

const VIDEO_ID = 'opKbUpusuTc';
const VIDEO_URL = `https://youtu.be/${VIDEO_ID}`;
const WATCH_MARK_PERCENT = 70;
const PLAYING_STATE = 1;

type PlayerMessage = {
  type?: string;
  currentTime?: number;
  duration?: number;
  playing?: boolean;
  state?: number;
};

type PlaybackSample = { currentTime: number; receivedAt: number };

function createYouTubeDocument(videoId: string, backgroundColor: string): string {
  const safeVideoId = videoId.replace(/[^a-zA-Z0-9_-]/g, '');
  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
  <style>
    html, body, #player { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; background: ${backgroundColor}; }
  </style>
</head>
<body>
  <div id="player"></div>
  <script>
    (function () {
      var player;
      function send(message) {
        if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
          window.ReactNativeWebView.postMessage(JSON.stringify(message));
        } else if (window.parent && window.parent !== window) {
          window.parent.postMessage(message, "*");
        }
      }
      window.onYouTubeIframeAPIReady = function () {
        player = new YT.Player("player", {
          videoId: "${safeVideoId}",
          playerVars: { playsinline: 1, rel: 0, controls: 1 },
          events: {
            onReady: function () {
              send({ type: "ready" });
              window.setInterval(function () {
                if (!player || !player.getCurrentTime || !player.getDuration) return;
                send({
                  type: "progress",
                  currentTime: player.getCurrentTime(),
                  duration: player.getDuration(),
                  playing: player.getPlayerState() === ${PLAYING_STATE}
                });
              }, 1000);
            },
            onStateChange: function (event) {
              send({ type: "state", state: event.data });
            },
            onError: function (event) {
              send({ type: "error", code: event.data });
            }
          }
        });
      };
      var script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(script);
    })();
  </script>
</body>
</html>`;
}

export default function Video() {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [
    colors.background,
    colors.foreground,
    colors.card,
    colors.cardForeground,
    colors.primary,
    colors.primaryForeground,
    colors.secondary,
    colors.secondaryForeground,
    colors.muted,
    colors.mutedForeground,
    colors.accent,
    colors.accentForeground,
    colors.destructive,
    colors.border,
    colors.radius,
  ]);
  const webFrameRef = useRef<any>(null);
  const lastSampleRef = useRef<PlaybackSample | null>(null);
  const watchedSecondBucketsRef = useRef<Set<number>>(new Set());
  const [progressPercent, setProgressPercent] = useState(0);
  const [playerReady, setPlayerReady] = useState(false);
  const [playerFailed, setPlayerFailed] = useState(false);

  const handlePlayerMessage = useCallback((rawMessage: unknown) => {
    let payload: PlayerMessage | null = null;
    if (typeof rawMessage === 'string') {
      try {
        payload = JSON.parse(rawMessage) as PlayerMessage;
      } catch {
        return;
      }
    } else if (rawMessage && typeof rawMessage === 'object') {
      payload = rawMessage as PlayerMessage;
    }
    if (!payload) return;

    if (payload.type === 'ready') {
      setPlayerReady(true);
      setPlayerFailed(false);
      return;
    }
    if (payload.type === 'error') {
      setPlayerFailed(true);
      lastSampleRef.current = null;
      return;
    }
    if (payload.type === 'state') {
      if (payload.state !== PLAYING_STATE) lastSampleRef.current = null;
      return;
    }
    if (payload.type !== 'progress') return;

    const currentTime = Number(payload.currentTime);
    const duration = Number(payload.duration);
    if (!payload.playing || !Number.isFinite(currentTime) ||
        !Number.isFinite(duration) || duration <= 0 || currentTime < 0) {
      lastSampleRef.current = null;
      return;
    }

    const now = Date.now();
    const previous = lastSampleRef.current;
    if (previous) {
      const elapsedSeconds = Math.max(0, (now - previous.receivedAt) / 1000);
      const advanceSeconds = currentTime - previous.currentTime;
      const plausibleAdvance = advanceSeconds > 0 &&
        advanceSeconds <= elapsedSeconds * 2.1 + 0.75;
      if (plausibleAdvance) {
        const firstSecond = Math.max(0, Math.floor(previous.currentTime));
        const lastSecondExclusive = Math.min(Math.floor(currentTime), Math.ceil(duration));
        for (let second = firstSecond; second < lastSecondExclusive; second += 1) {
          watchedSecondBucketsRef.current.add(second);
        }
      }
    }
    lastSampleRef.current = { currentTime, receivedAt: now };

    const watchedSeconds = watchedSecondBucketsRef.current.size;
    const estimated = Math.min(100, Math.floor((watchedSeconds / duration) * 100));
    setProgressPercent((current) => Math.max(current, estimated));
  }, []);

  const playerDocument = useMemo(
    () => createYouTubeDocument(VIDEO_ID, colors.background),
    [colors.background],
  );

  useEffect(() => {
    if (Platform.OS !== 'web') return undefined;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== webFrameRef.current?.contentWindow) return;
      handlePlayerMessage(event.data);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [handlePlayerMessage]);

  useEffect(() => {
    if (playerReady || playerFailed) return undefined;
    const timer = setTimeout(() => setPlayerFailed(true), 20_000);
    return () => clearTimeout(timer);
  }, [playerReady, playerFailed]);

  const openOnYouTube = useCallback(async () => {
    try {
      await Linking.openURL(VIDEO_URL);
    } catch {
      setPlayerFailed(true);
    }
  }, []);

  const player = Platform.OS === 'web'
    ? React.createElement('iframe' as any, {
        ref: webFrameRef,
        srcDoc: playerDocument,
        title: 'Featured Daily007 YouTube video',
        allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share',
        allowFullScreen: true,
        style: { width: '100%', height: '100%', border: 0, display: 'block' },
        'data-testid': 'video-youtube-player',
      })
    : (
      <WebView
        testID="video-youtube-player"
        source={{ html: playerDocument }}
        style={styles.player}
        containerStyle={styles.playerContainer}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        allowsFullscreenVideo
        scrollEnabled={false}
        onMessage={(event) => handlePlayerMessage(event.nativeEvent.data)}
        onError={() => setPlayerFailed(true)}
        onHttpError={() => setPlayerFailed(true)}
      />
    );

  const reachedWatchMark = progressPercent >= WATCH_MARK_PERCENT;

  return (
    <View style={styles.root}>
      <Text style={styles.title}>VIDEO</Text>
      <Text style={styles.subtitle}>FEATURED YOUTUBE VIDEO</Text>

      <View style={styles.playerShell}>
        {player}
        {!playerReady && !playerFailed ? (
          <View pointerEvents="none" style={styles.loadingOverlay}>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.loadingText}>Loading video…</Text>
          </View>
        ) : null}
      </View>

      {playerFailed ? (
        <View style={styles.errorCard}>
          <Feather name="alert-circle" size={18} color={colors.destructive} />
          <Text style={styles.errorText}>This video could not be embedded. Open it on YouTube instead.</Text>
        </View>
      ) : null}

      <View style={styles.progressHeader}>
        <Text style={styles.progressLabel}>ESTIMATED WATCH PROGRESS</Text>
        <Text style={styles.progressValue}>{progressPercent}%</Text>
      </View>
      <View
        accessibilityLabel={`${progressPercent}% estimated watched, ${WATCH_MARK_PERCENT}% marker`}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: progressPercent }}
        testID="video-progress-track"
        style={styles.progressTrack}
      >
        <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
        <View testID="video-progress-threshold" style={styles.thresholdMarker} />
      </View>
      <Text style={styles.progressCaption}>
        {reachedWatchMark
          ? '70% watch marker reached for this session.'
          : 'Continuous playback counts toward the 70% marker. Seeking ahead does not count.'}
      </Text>

      <View style={styles.notice}>
        <Feather name="info" size={16} color={colors.accent} />
        <Text style={styles.noticeText}>
          This is an estimated, session-only progress marker. Video viewing does not award coins.
        </Text>
      </View>

      <Pressable
        accessibilityRole="link"
        accessibilityLabel="Open the video on YouTube"
        testID="video-open-youtube"
        onPress={() => { void openOnYouTube(); }}
        style={styles.externalButton}
      >
        <Feather name="external-link" size={16} color={colors.primary} />
        <Text style={styles.externalButtonText}>OPEN ON YOUTUBE</Text>
      </Pressable>
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useColors>) {
  const webInsets = Platform.OS === 'web' ? { paddingTop: 67, paddingBottom: 34 } : {};
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.background,
      paddingHorizontal: 16,
      paddingTop: 16,
      ...webInsets,
    },
    title: {
      color: colors.foreground,
      fontSize: 20,
      fontWeight: '900',
      letterSpacing: 1,
    },
    subtitle: {
      color: colors.accent,
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 1.2,
      marginTop: 5,
      marginBottom: 14,
    },
    playerShell: {
      width: '100%',
      aspectRatio: 16 / 9,
      borderRadius: colors.radius,
      overflow: 'hidden',
      backgroundColor: colors.muted,
      borderWidth: 1,
      borderColor: colors.border,
    },
    player: { flex: 1, backgroundColor: colors.muted },
    playerContainer: { flex: 1, backgroundColor: colors.muted },
    loadingOverlay: {
      position: 'absolute',
      inset: 0,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.muted,
    },
    loadingText: { color: colors.mutedForeground, fontSize: 12, fontWeight: '700' },
    errorCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.card,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: colors.radius,
      padding: 12,
      marginTop: 10,
    },
    errorText: { color: colors.mutedForeground, fontSize: 12, lineHeight: 18, flex: 1 },
    progressHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 18,
      marginBottom: 8,
    },
    progressLabel: { color: colors.mutedForeground, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
    progressValue: { color: colors.accent, fontSize: 14, fontWeight: '900' },
    progressTrack: {
      height: 9,
      borderRadius: 6,
      backgroundColor: colors.secondary,
      position: 'relative',
      overflow: 'visible',
    },
    progressFill: {
      height: '100%',
      borderRadius: 6,
      backgroundColor: colors.primary,
    },
    thresholdMarker: {
      position: 'absolute',
      left: '70%',
      top: -3,
      height: 15,
      width: 2,
      backgroundColor: colors.accent,
    },
    progressCaption: { color: colors.mutedForeground, fontSize: 11, lineHeight: 17, marginTop: 8 },
    notice: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 12,
      marginTop: 16,
    },
    noticeText: { color: colors.mutedForeground, fontSize: 11, lineHeight: 17, flex: 1 },
    externalButton: {
      alignSelf: 'flex-start',
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 10,
      paddingVertical: 8,
    },
    externalButtonText: { color: colors.primary, fontSize: 11, fontWeight: '900', letterSpacing: 0.8 },
  });
}