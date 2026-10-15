import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  ActivityIndicator,
  BackHandler,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import * as Network from 'expo-network';
import * as Clipboard from 'expo-clipboard';
import { Feather } from '@expo/vector-icons';
import WebView from 'react-native-webview';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { ReadableText as Text, ReadableTextInput as TextInput } from '../components/typography';
import {
  VideoCatalogBackButton,
  VideoEmbedFailureRecovery,
  VideoUnavailableErrorAnnouncement,
} from '../components/VideoAccessibilityControls';
import { VideoLinkRecovery } from '../components/VideoLinkRecovery';
import { useColors } from '@/hooks/useColors';
import {
  useDaily007CompleteVideoWatch,
  getDaily007ListVideosQueryKey,
  useDaily007ListVideos,
  useDaily007StartVideoWatch,
} from '@workspace/api-client-react';
import { useApp } from '../App';
import {
  apiError,
  captureSessionIdentity,
  isSessionIdentityCurrent,
} from '../lib/api';
import {
  clearPendingVideoRewardRetry,
  loadPendingVideoRewardRetry,
  savePendingVideoRewardRetry,
} from '../lib/video-reward-retry';
import {
  createVideoWatchAttemptId,
  getCreditedVideoWatchSeconds,
  type VideoPlaybackSample,
} from '../lib/video-watch-progress';
import { openVideoInBrowser, openYouTubeVideo } from '../lib/video-links';
import {
  getVideoCatalogRefreshInterval,
  shouldRefreshVideoCatalogOnFocus,
} from '../lib/videoCatalogRefresh';
import {
  createNetworkEventRevision,
  isUsableNetworkState,
} from '../lib/focusedRetry';
import { createFocusedRefreshCoalescer } from '../lib/focusedLatestRequest';

const WATCH_MARK_PERCENT = 75;
const PLAYING_STATE = 1;
const ENDED_STATE = 0;
const VIDEO_UNAVAILABLE_FOR_REWARDS = 'This video is no longer available for rewards.';

type VideoItem = {
  id: string;
  title: string;
  topic: string;
  youtubeId: string;
  url: string;
  active: boolean;
  createdAt: string;
};

type PlayerMessage = {
  type?: string;
  currentTime?: number;
  duration?: number;
  playing?: boolean;
  state?: number;
};

type VideoWatchStartRequest = {
  videoId: string;
  durationSeconds: number;
  attemptId: string;
};

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
  const isFocused = useIsFocused();
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const [showPlayer, setShowPlayer] = useState(false);
  const [isAppActive, setIsAppActive] = useState(AppState.currentState === 'active');
  const [catalogRefreshes] = useState(createFocusedRefreshCoalescer);
  const networkUsableRef = useRef<boolean | null>(null);
  const videosQuery = useDaily007ListVideos({
    query: {
      queryKey: getDaily007ListVideosQueryKey(),
      enabled: isFocused && isAppActive && !showPlayer,
      refetchInterval: getVideoCatalogRefreshInterval({
        isFocused,
        isAppActive,
        isPlayerOpen: showPlayer,
      }),
      refetchIntervalInBackground: false,
    },
  });
  const videos: VideoItem[] = (videosQuery.data?.videos ?? []) as VideoItem[];
  const hasLoadedCatalog = videosQuery.data !== undefined;
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
  const [searchQuery, setSearchQuery] = useState('');
  const [catalogErrorAnnouncementVersion, setCatalogErrorAnnouncementVersion] = useState(0);
  const [catalogRecoveryAnnouncementVersion, setCatalogRecoveryAnnouncementVersion] = useState(0);
  const [catalogReloadPending, setCatalogReloadPending] = useState(false);
  const playbackCycleRef = useRef(0);
  const catalogReloadRequestSequenceRef = useRef(0);
  const catalogScrollRef = useRef<ScrollView | null>(null);
  const catalogScrollOffsetRef = useRef(0);
  const catalogScrollRestorePendingRef = useRef(false);
  const selectedVideo = videos.find((video) => video.id === selectedVideoId) ?? videos[0] ?? null;
  const reloadVideoCatalog = useCallback(async () => {
    const requestSequence = ++catalogReloadRequestSequenceRef.current;
    setCatalogReloadPending(true);
    try {
      const result = await videosQuery.refetch({ cancelRefetch: true });
      if (requestSequence !== catalogReloadRequestSequenceRef.current) return;
      if (result.error) {
        setCatalogErrorAnnouncementVersion((version) => version + 1);
        return;
      }
      setCatalogRecoveryAnnouncementVersion((version) => version + 1);
    } finally {
      if (requestSequence === catalogReloadRequestSequenceRef.current) {
        setCatalogReloadPending(false);
      }
    }
  }, [videosQuery.refetch]);
  const closePlayer = useCallback(() => {
    playbackCycleRef.current += 1;
    setShowPlayer(false);
    setSelectedVideoId(null);
  }, []);

  useFocusEffect(useCallback(() => {
    if (!isAppActive) return undefined;
    if (!showPlayer) {
      let active = true;
      catalogRefreshes.setFocused(true);
      const refreshCatalogIfFocused = () => {
        if (!active) return;
        if (shouldRefreshVideoCatalogOnFocus({
          isFocused,
          isAppActive,
          isPlayerOpen: showPlayer,
        })) {
          void videosQuery.refetch();
        }
      };
      const requestCatalogRefresh = () => catalogRefreshes.request(refreshCatalogIfFocused);
      const updateNetworkState = (
        networkState: Parameters<typeof isUsableNetworkState>[0],
        refreshOnReconnect: boolean,
      ) => {
        const wasUsable = networkUsableRef.current;
        const isUsable = isUsableNetworkState(networkState);
        networkUsableRef.current = isUsable;
        if (isUsable && wasUsable === false && refreshOnReconnect) {
          requestCatalogRefresh();
        }
      };
      const networkEventRevision = createNetworkEventRevision();
      const initialNetworkEventRevision = networkEventRevision.capture();
      const networkSubscription = Network.addNetworkStateListener((networkState) => {
        if (!active) return;
        networkEventRevision.recordEvent();
        updateNetworkState(networkState, true);
      });
      void Network.getNetworkStateAsync().then((networkState) => {
        if (!active || !networkEventRevision.isCurrent(initialNetworkEventRevision)) return;
        updateNetworkState(networkState, false);
      }).catch(() => {
        if (active && networkEventRevision.isCurrent(initialNetworkEventRevision)) {
          networkUsableRef.current = false;
        }
      });
      if (shouldRefreshVideoCatalogOnFocus({
        isFocused,
        isAppActive,
        isPlayerOpen: showPlayer,
      })) {
        requestCatalogRefresh();
      }
      return () => {
        active = false;
        catalogRefreshes.setFocused(false);
        networkSubscription.remove();
      };
    }
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      closePlayer();
      return true;
    });
    return () => subscription.remove();
  }, [catalogRefreshes, closePlayer, isAppActive, isFocused, showPlayer, videosQuery.refetch]));

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      setIsAppActive(nextState === 'active');
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (showPlayer) return undefined;
    if (videosQuery.isError && !hasLoadedCatalog) {
      if (catalogScrollOffsetRef.current > 0) {
        catalogScrollRestorePendingRef.current = true;
      }
      return undefined;
    }
    if (videosQuery.isLoading || videosQuery.isFetching || !catalogScrollRestorePendingRef.current) {
      return undefined;
    }

    const frame = requestAnimationFrame(() => {
      catalogScrollRef.current?.scrollTo({
        y: catalogScrollOffsetRef.current,
        animated: false,
      });
      catalogScrollRestorePendingRef.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [
    showPlayer,
    videosQuery.dataUpdatedAt,
    hasLoadedCatalog,
    videosQuery.isError,
    videosQuery.isFetching,
    videosQuery.isLoading,
    videos.length,
  ]);

  const filteredVideos = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return videos;
    return videos.filter((video) =>
      `${video.title} ${video.topic}`.toLowerCase().includes(query),
    );
  }, [searchQuery, videos]);
  const { user, refresh } = useApp();
  const accountId = user.id ?? user.$id;
  const { mutateAsync: startVideoWatch } = useDaily007StartVideoWatch();
  const { mutateAsync: completeVideoWatch } = useDaily007CompleteVideoWatch();
  const webFrameRef = useRef<any>(null);
  const lastSampleRef = useRef<VideoPlaybackSample | null>(null);
  const latestPlaybackTimeRef = useRef<number | null>(null);
  const watchedSecondBucketsRef = useRef<Set<number>>(new Set());
  const currentSessionRef = useRef<string | null>(null);
  const startAttemptIdRef = useRef<string | null>(null);
  const startRequestRef = useRef<VideoWatchStartRequest | null>(null);
  const startingSessionRef = useRef(false);
  const sessionStartFailedRef = useRef(false);
  const appLifecycleCycleRef = useRef(0);
  const appIsActiveRef = useRef(
    AppState.currentState !== 'background' && AppState.currentState !== 'inactive',
  );
  const progressPercentRef = useRef(0);
  const [progressPercent, setProgressPercent] = useState(0);
  const [playerReady, setPlayerReady] = useState(false);
  const [playerFailed, setPlayerFailed] = useState(false);
  const [externalLinkError, setExternalLinkError] = useState(false);
  const [externalLinkStatus, setExternalLinkStatus] = useState('');
  const [externalLinkCopyFailed, setExternalLinkCopyFailed] = useState(false);
  const [externalLinkAction, setExternalLinkAction] = useState<'youtube' | 'browser' | 'copy' | null>(null);
  const [rewardMessage, setRewardMessage] = useState('');
  const [rewardError, setRewardError] = useState('');
  const [rewardPending, setRewardPending] = useState(false);
  const [retrySession, setRetrySession] = useState<{ sessionId: string; percent: number } | null>(null);
  const [sessionStartRetryAvailable, setSessionStartRetryAvailable] = useState(false);
  const [sessionStartRetryPending, setSessionStartRetryPending] = useState(false);

  useEffect(() => {
    let active = true;
    setRetrySession(null);
    if (!accountId) return () => { active = false; };
    void loadPendingVideoRewardRetry(accountId).then((retry) => {
      if (active) {
        setRetrySession(retry
          ? { sessionId: retry.sessionId, percent: retry.percent }
          : null);
      }
    }).catch(() => {
      if (active) setRewardError('A saved coin claim could not be loaded. Check device storage and reopen the Video tab.');
    });
    return () => { active = false; };
  }, [accountId]);

  const claimViewReward = useCallback(async (sessionId: string, percentWatched: number) => {
    const playbackCycle = playbackCycleRef.current;
    const sessionIdentity = captureSessionIdentity();
    const canPersistForAccount = Boolean(
      accountId &&
      sessionIdentity &&
      sessionIdentity.accountId === accountId &&
      isSessionIdentityCurrent(sessionIdentity),
    );
    let retrySaved = false;
    setRewardPending(true);
    setRewardError('');
    if (canPersistForAccount && accountId) {
      try {
        await savePendingVideoRewardRetry(accountId, sessionId, percentWatched);
        retrySaved = true;
      } catch {
        // Still submit the reward claim; report the persistence issue only if retry is needed.
      }
    }
    try {
      const result = await completeVideoWatch({
        data: { sessionId, percentWatched: Math.min(100, percentWatched) },
      });
      let retryClearFailed = false;
      if (accountId) {
        try {
          await clearPendingVideoRewardRetry(accountId, sessionId);
        } catch {
          retryClearFailed = true;
        }
      }
      if (playbackCycle === playbackCycleRef.current) {
        setRewardMessage(result.message || (result.rewarded ? '1 coin added to your wallet.' : 'This view has already been rewarded.'));
        setRetrySession(null);
        if (retryClearFailed) {
          setRewardError('The coin was recorded, but its saved retry could not be removed from this device.');
        }
      }
      void refresh().catch(() => {
        if (playbackCycle === playbackCycleRef.current) {
          setRewardError('The coin was recorded, but the wallet display did not refresh. Reopen Wallet to update it.');
        }
      });
    } catch (error) {
      const message = apiError(error);
      if (message === VIDEO_UNAVAILABLE_FOR_REWARDS) {
        let retryClearFailed = false;
        if (accountId) {
          try {
            await clearPendingVideoRewardRetry(accountId, sessionId);
          } catch {
            retryClearFailed = true;
          }
        }
        if (playbackCycle === playbackCycleRef.current) {
          setRewardError(retryClearFailed
            ? `${message} The saved retry could not be removed from this device.`
            : message);
          setRetrySession(null);
        }
      } else {
        if (
          !retrySaved &&
          canPersistForAccount &&
          accountId &&
          sessionIdentity &&
          isSessionIdentityCurrent(sessionIdentity)
        ) {
          try {
            await savePendingVideoRewardRetry(accountId, sessionId, percentWatched);
            retrySaved = true;
          } catch {
            // The in-memory retry remains available for this app session.
          }
        }
        if (playbackCycle === playbackCycleRef.current) {
          setRewardError(retrySaved
            ? message
            : `${message} This retry could not be saved on this device.`);
          setRetrySession({ sessionId, percent: percentWatched });
        }
      }
    } finally {
      if (playbackCycle === playbackCycleRef.current) setRewardPending(false);
    }
  }, [accountId, completeVideoWatch, refresh]);

  const finishCurrentPlayback = useCallback(() => {
    const sessionId = currentSessionRef.current;
    currentSessionRef.current = null;
    startAttemptIdRef.current = null;
    startRequestRef.current = null;
    latestPlaybackTimeRef.current = null;
    playbackCycleRef.current += 1;
    startingSessionRef.current = false;
    sessionStartFailedRef.current = false;
    setSessionStartRetryAvailable(false);
    setSessionStartRetryPending(false);
    lastSampleRef.current = null;
    if (!sessionId) return;

    const percentWatched = progressPercentRef.current;
    if (percentWatched < WATCH_MARK_PERCENT) {
      setRewardError(`Watch at least ${WATCH_MARK_PERCENT}% continuously and let the YouTube video finish to earn 1 coin.`);
      return;
    }
    void claimViewReward(sessionId, percentWatched);
  }, [claimViewReward]);

  const startVideoWatchSession = useCallback((
    request: VideoWatchStartRequest,
    cycle: number,
  ) => {
    if (startingSessionRef.current) return;
    startingSessionRef.current = true;
    sessionStartFailedRef.current = false;
    setRewardError('');
    const appLifecycleCycle = appLifecycleCycleRef.current;
    void startVideoWatch({ data: request }).then((session) => {
      if (cycle !== playbackCycleRef.current) return;
      currentSessionRef.current = session.sessionId;
      setSessionStartRetryAvailable(false);
      setSessionStartRetryPending(false);
      if (appIsActiveRef.current && appLifecycleCycle === appLifecycleCycleRef.current) {
        const currentTime = latestPlaybackTimeRef.current;
        lastSampleRef.current = currentTime === null
          ? null
          : { currentTime, receivedAt: Date.now() };
      }
    }).catch((error) => {
      if (cycle === playbackCycleRef.current) {
        sessionStartFailedRef.current = true;
        setSessionStartRetryAvailable(true);
        setSessionStartRetryPending(false);
        setRewardError(apiError(error));
      }
    }).finally(() => {
      if (cycle === playbackCycleRef.current) startingSessionRef.current = false;
    });
  }, [startVideoWatch]);

  const retryFailedSessionStart = useCallback(() => {
    const request = startRequestRef.current;
    if (
      !showPlayer ||
      !selectedVideo ||
      !sessionStartRetryAvailable ||
      startingSessionRef.current ||
      currentSessionRef.current ||
      !request ||
      request.videoId !== selectedVideo.id
    ) return;
    setSessionStartRetryPending(true);
    startVideoWatchSession(request, playbackCycleRef.current);
  }, [selectedVideo?.id, sessionStartRetryAvailable, showPlayer, startVideoWatchSession]);

  const handlePlayerMessage = useCallback((rawMessage: unknown) => {
    if (!showPlayer) return;
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
      latestPlaybackTimeRef.current = null;
      return;
    }
    if (payload.type === 'state') {
      if (payload.state === ENDED_STATE) {
        finishCurrentPlayback();
        return;
      }
      if (payload.state !== PLAYING_STATE) {
        lastSampleRef.current = null;
        latestPlaybackTimeRef.current = null;
      }
      return;
    }
    if (payload.type !== 'progress') return;

    if (!appIsActiveRef.current) {
      lastSampleRef.current = null;
      return;
    }

    const currentTime = Number(payload.currentTime);
    const duration = Number(payload.duration);
    if (!payload.playing || !Number.isFinite(currentTime) ||
        !Number.isFinite(duration) || duration <= 0 || currentTime < 0) {
      lastSampleRef.current = null;
      return;
    }

    if (!selectedVideo) return;
    latestPlaybackTimeRef.current = currentTime;
    const now = Date.now();
    if (!currentSessionRef.current) {
      if (startingSessionRef.current || sessionStartFailedRef.current) return;
      const durationSeconds = Math.ceil(duration);
      if (durationSeconds < 5 || durationSeconds > 86_400) {
        sessionStartFailedRef.current = true;
        setRewardError('This video duration is outside the reward range.');
        return;
      }
      const cycle = playbackCycleRef.current;
      watchedSecondBucketsRef.current.clear();
      progressPercentRef.current = 0;
      setProgressPercent(0);
      setRewardMessage('');
      setRewardError('');
      lastSampleRef.current = null;
      const attemptId = startAttemptIdRef.current ?? createVideoWatchAttemptId();
      startAttemptIdRef.current = attemptId;
      const request = { videoId: selectedVideo.id, durationSeconds, attemptId };
      startRequestRef.current = request;
      startVideoWatchSession(request, cycle);
      return;
    }
    if (startingSessionRef.current) return;

    const previous = lastSampleRef.current;
    const creditedSeconds = getCreditedVideoWatchSeconds(previous, currentTime, now, duration);
    for (const second of creditedSeconds) {
      watchedSecondBucketsRef.current.add(second);
    }
    lastSampleRef.current = { currentTime, receivedAt: now };

    const watchedSeconds = watchedSecondBucketsRef.current.size;
    const estimated = Math.min(100, Math.floor((watchedSeconds / duration) * 100));
    const nextPercent = Math.max(progressPercentRef.current, estimated);
    progressPercentRef.current = nextPercent;
    setProgressPercent(nextPercent);
  }, [finishCurrentPlayback, selectedVideo?.id, showPlayer, startVideoWatchSession]);

  const playerDocument = useMemo(
    () => createYouTubeDocument(selectedVideo?.youtubeId ?? '', colors.background),
    [colors.background, selectedVideo?.youtubeId],
  );

  useEffect(() => {
    playbackCycleRef.current += 1;
    currentSessionRef.current = null;
    startAttemptIdRef.current = null;
    startRequestRef.current = null;
    latestPlaybackTimeRef.current = null;
    startingSessionRef.current = false;
    sessionStartFailedRef.current = false;
    setSessionStartRetryAvailable(false);
    setSessionStartRetryPending(false);
    lastSampleRef.current = null;
    watchedSecondBucketsRef.current.clear();
    progressPercentRef.current = 0;
    setProgressPercent(0);
    setPlayerReady(false);
    setPlayerFailed(false);
    setExternalLinkError(false);
    setExternalLinkStatus('');
    setExternalLinkCopyFailed(false);
    setExternalLinkAction(null);
    setRewardMessage('');
    setRewardError('');
    setRewardPending(false);
  }, [selectedVideo?.id, showPlayer]);

  useEffect(() => {
    appIsActiveRef.current =
      AppState.currentState !== 'background' && AppState.currentState !== 'inactive';
    const subscription = AppState.addEventListener('change', (nextState) => {
      const isActive = nextState === 'active';
      if (appIsActiveRef.current !== isActive) appLifecycleCycleRef.current += 1;
      appIsActiveRef.current = isActive;
      if (!isActive) lastSampleRef.current = null;
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web' || !showPlayer) return undefined;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== webFrameRef.current?.contentWindow) return;
      handlePlayerMessage(event.data);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [handlePlayerMessage, showPlayer]);

  useEffect(() => {
    if (!showPlayer || !selectedVideo || playerReady || playerFailed) return undefined;
    const timer = setTimeout(() => setPlayerFailed(true), 20_000);
    return () => clearTimeout(timer);
  }, [playerReady, playerFailed, selectedVideo?.id, showPlayer]);

  const openOnYouTube = useCallback(async () => {
    if (!selectedVideo || externalLinkAction) return;
    setExternalLinkAction('youtube');
    setExternalLinkStatus('');
    setExternalLinkCopyFailed(false);
    try {
      await openYouTubeVideo(
        Platform.OS,
        selectedVideo.youtubeId,
        selectedVideo.url,
        (url) => Linking.openURL(url),
      );
      setExternalLinkError(false);
    } catch {
      setExternalLinkError(true);
    } finally {
      setExternalLinkAction(null);
    }
  }, [externalLinkAction, selectedVideo?.url, selectedVideo?.youtubeId]);

  const retryVideoInBrowser = useCallback(async () => {
    if (!selectedVideo || externalLinkAction) return;
    setExternalLinkAction('browser');
    setExternalLinkStatus('');
    setExternalLinkCopyFailed(false);
    try {
      await openVideoInBrowser(selectedVideo.url, (url) => Linking.openURL(url));
      setExternalLinkError(false);
    } catch {
      setExternalLinkError(true);
      setExternalLinkStatus('The browser still could not open the video. Copy the URL or try again later.');
    } finally {
      setExternalLinkAction(null);
    }
  }, [externalLinkAction, selectedVideo?.url]);

  const copyVideoLink = useCallback(async () => {
    if (!selectedVideo || externalLinkAction) return;
    setExternalLinkAction('copy');
    setExternalLinkStatus('');
    setExternalLinkCopyFailed(false);
    try {
      const copied = await Clipboard.setStringAsync(selectedVideo.url);
      if (!copied) throw new Error('Clipboard did not confirm the copy.');
      setExternalLinkStatus('Video link copied. Paste it into YouTube or a browser.');
    } catch {
      setExternalLinkCopyFailed(true);
      setExternalLinkStatus('Automatic copy failed. Select and copy the video URL below.');
    } finally {
      setExternalLinkAction(null);
    }
  }, [externalLinkAction, selectedVideo?.url]);

  const player = !selectedVideo ? null : Platform.OS === 'web'
    ? React.createElement('iframe' as any, {
        key: selectedVideo.id,
        ref: webFrameRef,
        srcDoc: playerDocument,
        title: 'Video player',
        allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share',
        allowFullScreen: true,
        style: { width: '100%', height: '100%', border: 0, display: 'block' },
        'data-testid': 'video-youtube-player',
      })
    : (
      <WebView
        key={selectedVideo.id}
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
    <ScrollView
      ref={catalogScrollRef}
      testID="video-catalog-scroll"
      style={styles.root}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
      onScroll={(event) => {
        if (
          !showPlayer
          && (!videosQuery.isError || hasLoadedCatalog)
          && !catalogScrollRestorePendingRef.current
        ) {
          catalogScrollOffsetRef.current = event.nativeEvent.contentOffset.y;
        }
      }}
      scrollEventThrottle={16}
    >
      {showPlayer && selectedVideo ? (
        <>
          <VideoCatalogBackButton
            onPress={closePlayer}
            buttonStyle={({ pressed }) => [
              styles.backButton,
              pressed && { opacity: 0.7 },
            ]}
            textStyle={styles.backText}
            primaryColor={colors.primary}
          />
          <View style={styles.playerVideoHeader}>
            <Text style={styles.playerTitle}>{selectedVideo.title}</Text>
            <Text style={styles.playerTopic}>TOPIC · {selectedVideo.topic}</Text>
          </View>

          <View style={styles.playerShell}>
            {player}
            {!playerReady && !playerFailed ? (
              <View pointerEvents="none" style={styles.loadingOverlay}>
                <ActivityIndicator color={colors.accent} />
                <Text style={styles.loadingText}>Loading video…</Text>
              </View>
            ) : null}
          </View>

          {playerFailed && !externalLinkError ? (
            <VideoEmbedFailureRecovery
              busy={externalLinkAction === 'youtube'}
              onOpenYouTube={() => { void openOnYouTube(); }}
            />
          ) : null}
          {externalLinkError ? (
            <VideoLinkRecovery
              url={selectedVideo.url}
              action={externalLinkAction}
              status={externalLinkStatus}
              copyFailed={externalLinkCopyFailed}
              onRetryBrowser={() => { void retryVideoInBrowser(); }}
              onCopyLink={() => { void copyVideoLink(); }}
            />
          ) : null}

          <View style={styles.progressHeader}>
            <Text style={styles.progressLabel}>ESTIMATED WATCH PROGRESS</Text>
            <Text testID="video-progress-value" style={styles.progressValue}>
              {progressPercent}%
            </Text>
          </View>
          <View
            accessibilityLabel={`${progressPercent}% estimated watched, ${WATCH_MARK_PERCENT}% reward marker`}
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: 100, now: progressPercent }}
            testID="video-progress-track"
            style={styles.progressTrack}
          >
            <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
            <View
              testID="video-progress-threshold"
              style={[styles.thresholdMarker, { left: `${WATCH_MARK_PERCENT}%` }]}
            />
          </View>
          <Text style={styles.progressCaption}>
            {reachedWatchMark
              ? `${WATCH_MARK_PERCENT}% watch estimate reached. Let the YouTube video finish to claim.`
              : `Continuous playback builds the estimate. Large seeks are ignored; at least ${WATCH_MARK_PERCENT}% is required.`}
          </Text>

          {rewardPending ? (
            <View style={styles.rewardNotice}>
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.noticeText}>Verifying the completed view…</Text>
            </View>
          ) : null}
          {!!rewardMessage ? (
            <View style={styles.rewardNotice}>
              <Feather name="check-circle" size={16} color={colors.primary} />
              <Text style={styles.rewardText}>{rewardMessage}</Text>
            </View>
          ) : null}
          {!!rewardError ? (
            <VideoUnavailableErrorAnnouncement
              message={rewardError}
              announce={sessionStartFailedRef.current}
              containerStyle={styles.errorCard}
              textStyle={styles.errorText}
              iconColor={colors.destructive}
            />
          ) : null}
          {sessionStartRetryAvailable || sessionStartRetryPending ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry starting this video reward session"
              accessibilityHint="Retries the session for this playback without restarting the video."
              accessibilityState={{
                busy: sessionStartRetryPending,
                disabled: sessionStartRetryPending,
              }}
              testID="video-retry-session-start"
              disabled={sessionStartRetryPending}
              onPress={() => { retryFailedSessionStart(); }}
              style={styles.retryButton}
            >
              <Feather name="refresh-cw" size={15} color={colors.primary} />
              <Text style={styles.externalButtonText}>
                {sessionStartRetryPending ? 'RETRYING SESSION…' : 'RETRY SESSION START'}
              </Text>
            </Pressable>
          ) : null}
          {retrySession ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry the coin reward claim"
              testID="video-retry-claim"
              disabled={rewardPending}
              onPress={() => { void claimViewReward(retrySession.sessionId, retrySession.percent); }}
              style={styles.retryButton}
            >
              <Feather name="refresh-cw" size={15} color={colors.primary} />
              <Text style={styles.externalButtonText}>RETRY COIN CLAIM</Text>
            </Pressable>
          ) : null}

          <View style={styles.notice}>
            <Feather name="info" size={16} color={colors.accent} />
            <Text style={styles.noticeText}>
              Earn 1 coin for each completed view; replays can earn again. A claim needs the YouTube ended event and at least 75% estimated continuous playback. Playback is client-reported and cannot be made tamper-proof.
            </Text>
          </View>

          <Pressable
            accessibilityRole="link"
            accessibilityLabel="Open the video on YouTube"
            accessibilityState={{ busy: externalLinkAction === 'youtube', disabled: externalLinkAction !== null }}
            testID="video-open-youtube"
            disabled={externalLinkAction !== null}
            onPress={() => { void openOnYouTube(); }}
            style={styles.externalButton}
          >
            <Feather name="external-link" size={16} color={colors.primary} />
            <Text style={styles.externalButtonText}>
              {externalLinkAction === 'youtube' ? 'OPENING VIDEO…' : 'OPEN ON YOUTUBE'}
            </Text>
          </Pressable>
        </>
      ) : (
        <>
          {rewardError && !retrySession ? (
            <View style={styles.errorCard}>
              <Feather name="alert-circle" size={18} color={colors.destructive} />
              <Text style={styles.errorText}>{rewardError}</Text>
            </View>
          ) : null}
          {retrySession ? (
            <View style={styles.errorCard}>
              <Feather name="alert-circle" size={18} color={colors.accent} />
              <Text style={styles.errorText}>
                {rewardError || 'A completed video still needs its coin claim. Retry here without watching the video again.'}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Retry the saved coin reward claim"
                accessibilityHint="Retries the original completed video session without starting another watch session."
                accessibilityState={{ busy: rewardPending, disabled: rewardPending }}
                testID="video-retry-claim"
                disabled={rewardPending}
                onPress={() => { void claimViewReward(retrySession.sessionId, retrySession.percent); }}
                style={styles.retryButton}
              >
                <Feather name="refresh-cw" size={15} color={colors.primary} />
                <Text style={styles.externalButtonText}>
                  {rewardPending ? 'RETRYING CLAIM…' : 'RETRY COIN CLAIM'}
                </Text>
              </Pressable>
            </View>
          ) : null}
          {videosQuery.isLoading ? (
            <View style={styles.emptyCard}>
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.errorText}>Loading videos…</Text>
            </View>
          ) : null}
          {videosQuery.isError || catalogReloadPending ? (
            <View style={styles.errorCard}>
              {videosQuery.isError ? (
                <Feather name="alert-circle" size={18} color={colors.destructive} />
              ) : null}
              <View style={styles.catalogErrorContent}>
                {videosQuery.isError ? (
                  <Text
                    key={`video-catalog-error-${catalogErrorAnnouncementVersion}`}
                    accessibilityLiveRegion="polite"
                    testID="video-catalog-error-message"
                    style={styles.errorText}
                  >
                    {hasLoadedCatalog
                      ? 'Could not refresh videos. Showing the last loaded catalog.'
                      : 'Could not load videos. Check your connection and try again.'}
                  </Text>
                ) : null}
                {catalogReloadPending ? (
                  <View style={styles.catalogReloadProgress}>
                    <ActivityIndicator size="small" color={colors.primary} />
                    <Text
                      accessibilityLiveRegion="polite"
                      testID="video-catalog-reload-progress"
                      style={styles.catalogReloadProgressText}
                    >
                      Reloading videos…
                    </Text>
                  </View>
                ) : null}
              </View>
              <Pressable
                testID="video-catalog-reload"
                onPress={() => { void reloadVideoCatalog(); }}
                accessibilityRole="button"
                accessibilityLabel="Reload videos"
                accessibilityState={{ busy: catalogReloadPending }}
              >
                <Feather name="refresh-cw" size={18} color={colors.primary} />
              </Pressable>
            </View>
          ) : null}
          {!videosQuery.isError && catalogRecoveryAnnouncementVersion > 0 ? (
            <Text
              key={`video-catalog-recovered-${catalogRecoveryAnnouncementVersion}`}
              accessibilityLiveRegion="polite"
              testID="video-catalog-recovered-announcement"
              style={styles.catalogRecoveryText}
            >
              Video catalog reloaded successfully.
            </Text>
          ) : null}
          {!videosQuery.isLoading && hasLoadedCatalog && videos.length === 0 ? (
            <View style={styles.emptyCard}>
              <Feather name="video" size={22} color={colors.accent} />
              <Text style={styles.errorText}>No videos are available yet.</Text>
            </View>
          ) : null}

          {videos.length > 0 ? (
            <>
              <View style={styles.catalogSearch}>
                <Feather name="search" size={17} color={colors.mutedForeground} />
                <TextInput
                  accessibilityLabel="Search videos by title or topic"
                  testID="video-catalog-search"
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder="Search by topic or title..."
                  placeholderTextColor={colors.mutedForeground}
                  style={styles.catalogSearchInput}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="search"
                />
              </View>
              <Text style={styles.catalogHeading}>Tutorial Videos ({filteredVideos.length})</Text>

              {filteredVideos.map((video) => (
                <Pressable
                  key={video.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${video.title}, topic ${video.topic}`}
                  accessibilityHint="Opens the in-app YouTube player"
                  testID={`video-catalog-card-${video.id}`}
                  onPress={() => {
                    catalogScrollRestorePendingRef.current = true;
                    setSelectedVideoId(video.id);
                    setShowPlayer(true);
                  }}
                  style={({ pressed }) => [
                    styles.videoCatalogCard,
                    pressed && { opacity: 0.78 },
                  ]}
                >
                  <View style={styles.catalogPlayIcon}>
                    <Feather name="play" size={18} color={colors.primary} />
                  </View>
                  <View style={styles.catalogCardContent}>
                    <Text style={styles.catalogTitle}>{video.title}</Text>
                    <Text style={styles.catalogTopic}>Topic: {video.topic}</Text>
                    <Text style={styles.catalogTap}>Tap to watch in YouTube</Text>
                  </View>
                </Pressable>
              ))}

              {filteredVideos.length === 0 ? (
                <View style={styles.emptyCard}>
                  <Feather name="search" size={18} color={colors.accent} />
                  <Text
                    testID="video-catalog-no-search-results"
                    style={styles.errorText}
                  >
                    No videos match your search.
                  </Text>
                </View>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </ScrollView>
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
    scrollContent: { paddingBottom: 24 },
    catalogSearch: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 13,
      marginBottom: 18,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: colors.radius,
    },
    catalogSearchInput: {
      flex: 1,
      minWidth: 0,
      color: colors.foreground,
      fontSize: 14,
      paddingVertical: 10,
    },
    catalogHeading: {
      color: colors.foreground,
      fontSize: 18,
      lineHeight: 24,
      fontWeight: '800',
      marginBottom: 12,
    },
    videoCatalogCard: {
      minHeight: 96,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingHorizontal: 15,
      paddingVertical: 14,
      marginBottom: 11,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      borderRadius: colors.radius,
    },
    catalogPlayIcon: {
      width: 46,
      height: 46,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 23,
      backgroundColor: colors.secondary,
    },
    catalogCardContent: { flex: 1, gap: 3 },
    catalogTitle: { color: colors.foreground, fontSize: 15, lineHeight: 21, fontWeight: '800' },
    catalogTopic: { color: colors.accent, fontSize: 11, lineHeight: 16, fontWeight: '800' },
    catalogTap: { color: colors.mutedForeground, fontSize: 11, lineHeight: 16, marginTop: 2 },
    backButton: {
      minHeight: 42,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 8,
    },
    backText: { color: colors.primary, fontSize: 11, fontWeight: '900', letterSpacing: 0.8 },
    playerVideoHeader: { marginBottom: 12, gap: 3 },
    playerTitle: { color: colors.foreground, fontSize: 16, lineHeight: 22, fontWeight: '800' },
    playerTopic: { color: colors.accent, fontSize: 11, lineHeight: 16, fontWeight: '800' },
    emptyCard: {
      minHeight: 62,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      padding: 14,
      marginBottom: 14,
      backgroundColor: colors.card,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: colors.radius,
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
    catalogErrorContent: { flex: 1, minWidth: 0, gap: 6 },
    errorText: { color: colors.mutedForeground, fontSize: 12, lineHeight: 18, flex: 1 },
    catalogReloadProgress: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      minWidth: 0,
    },
    catalogReloadProgressText: {
      color: colors.primary,
      fontSize: 12,
      lineHeight: 18,
      flex: 1,
      flexShrink: 1,
    },
    catalogRecoveryText: {
      color: colors.primary,
      fontSize: 12,
      lineHeight: 18,
      marginTop: 10,
    },
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
    rewardNotice: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.primary,
      padding: 12,
      marginTop: 12,
    },
    rewardText: { color: colors.primary, fontSize: 12, lineHeight: 18, fontWeight: '800', flex: 1 },
    retryButton: {
      alignSelf: 'flex-start',
      minHeight: 42,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 8,
      paddingVertical: 8,
    },
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