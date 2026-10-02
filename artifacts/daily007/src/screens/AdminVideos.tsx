import React, { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { ReadableText as Text } from '../components/typography';
import { Feather } from '@expo/vector-icons';
import {
  useDaily007AdminCreateVideo,
  useDaily007AdminListVideos,
  useDaily007AdminSetVideoActive,
} from '@workspace/api-client-react';
import {
  A,
  Btn,
  Card,
  Empty,
  Input,
  Loading,
  ScreenWrap,
  SectionTitle,
  useToast,
} from '../components/adminKit';
import { apiError } from '../lib/api';

type ManagedVideo = {
  id: string;
  title: string;
  youtubeId: string;
  url: string;
  active: boolean;
  createdAt: string;
};

export default function AdminVideos() {
  const videosQuery = useDaily007AdminListVideos();
  const { mutateAsync: createVideo, isPending: isCreating } = useDaily007AdminCreateVideo();
  const { mutateAsync: setVideoActive, isPending: isUpdating } = useDaily007AdminSetVideoActive();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const videos: ManagedVideo[] = (videosQuery.data?.videos ?? []) as ManagedVideo[];

  const addVideo = async () => {
    if (!title.trim() || !url.trim()) {
      setError('Enter a title and YouTube video link.');
      return;
    }
    setError('');
    try {
      await createVideo({ data: { title: title.trim(), url: url.trim() } });
      setTitle('');
      setUrl('');
      toast('Video added.', 'success');
      await videosQuery.refetch();
    } catch (cause) {
      setError(apiError(cause));
    }
  };

  const toggleVideo = async (video: ManagedVideo) => {
    setError('');
    try {
      await setVideoActive({ id: video.id, data: { active: !video.active } });
      toast(video.active ? 'Video hidden from players.' : 'Video is now available to players.', 'success');
      await videosQuery.refetch();
    } catch (cause) {
      setError(apiError(cause));
    }
  };

  return (
    <ScreenWrap onRefresh={() => videosQuery.refetch()}>
      <SectionTitle
        title="Videos"
        sub="Full Admin only · each completed view can earn 1 coin"
        icon="youtube"
      />

      <Card style={{ marginBottom: 14 }}>
        <Text style={styles.formTitle}>ADD A YOUTUBE VIDEO</Text>
        <Text style={styles.fieldLabel}>TITLE</Text>
        <Input
          value={title}
          onChangeText={setTitle}
          placeholder="Video title"
          autoCapitalize="sentences"
        />
        <Text style={styles.fieldLabel}>YOUTUBE VIDEO LINK</Text>
        <Input
          value={url}
          onChangeText={setUrl}
          placeholder="https://youtu.be/…"
          autoCapitalize="none"
        />
        {!!error ? (
          <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
        ) : null}
        <Btn
          title="Add video"
          onPress={() => { void addVideo(); }}
          loading={isCreating}
          disabled={isCreating || isUpdating}
          testID="admin-video-add"
        />
        <Text style={styles.help}>
          Use a YouTube watch, youtu.be, Shorts, or embed link. Turn a video off to hide it without deleting its reward history.
        </Text>
      </Card>

      <SectionTitle
        title={`MANAGED LINKS · ${videos.length}`}
        sub="Only active videos appear in the player."
        icon="list"
      />

      {videosQuery.isLoading && !videosQuery.data ? <Loading /> : null}
      {videosQuery.isError ? (
        <Card>
          <Text style={styles.error}>Could not load videos. Pull down to try again.</Text>
        </Card>
      ) : null}
      {!videosQuery.isLoading && !videosQuery.isError && videos.length === 0 ? (
        <Card><Empty text="No managed videos yet. Add a YouTube link above." /></Card>
      ) : null}

      {videos.map((video) => (
        <Card key={video.id} style={{ marginBottom: 10 }}>
          <View style={styles.videoHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.videoTitle}>{video.title}</Text>
              <Text numberOfLines={1} style={styles.videoUrl}>{video.url}</Text>
            </View>
            <View style={[styles.status, video.active ? styles.statusActive : styles.statusInactive]}>
              <Text style={[styles.statusText, video.active ? styles.statusTextActive : styles.statusTextInactive]}>
                {video.active ? 'ACTIVE' : 'HIDDEN'}
              </Text>
            </View>
          </View>
          <View style={styles.videoFooter}>
            <Text style={styles.videoReward}>1 coin per completed view · repeat views count</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${video.active ? 'Hide' : 'Activate'} ${video.title}`}
              disabled={isUpdating || isCreating}
              onPress={() => { void toggleVideo(video); }}
              style={({ pressed }) => [styles.toggleButton, pressed && { opacity: 0.75 }]}
            >
              {isUpdating ? (
                <ActivityIndicator size="small" color={A.gold} />
              ) : (
                <>
                  <Feather name={video.active ? 'eye-off' : 'eye'} size={14} color={A.gold} />
                  <Text style={styles.toggleText}>{video.active ? 'HIDE' : 'ACTIVATE'}</Text>
                </>
              )}
            </Pressable>
          </View>
        </Card>
      ))}
    </ScreenWrap>
  );
}

const styles = {
  formTitle: { color: A.text, fontSize: 12, fontWeight: '900' as const, letterSpacing: 1, marginBottom: 12 },
  fieldLabel: { color: A.sub, fontSize: 10, fontWeight: '800' as const, letterSpacing: 0.8, marginBottom: 6 },
  help: { color: A.sub, fontSize: 11, lineHeight: 16, marginTop: 10 },
  error: { color: A.danger, fontSize: 12, lineHeight: 17, marginBottom: 10 },
  videoHeader: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 10, marginBottom: 12 },
  videoTitle: { color: A.text, fontSize: 13, lineHeight: 18, fontWeight: '800' as const },
  videoUrl: { color: A.sub, fontSize: 10, marginTop: 4 },
  status: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4 },
  statusActive: { backgroundColor: 'rgba(46,204,113,0.12)', borderColor: 'rgba(46,204,113,0.45)' },
  statusInactive: { backgroundColor: 'rgba(255,255,255,0.04)', borderColor: A.border },
  statusText: { fontSize: 9, fontWeight: '900' as const, letterSpacing: 0.7 },
  statusTextActive: { color: A.green },
  statusTextInactive: { color: A.sub },
  videoFooter: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: A.border,
    paddingTop: 10,
  },
  videoReward: { color: A.sub, fontSize: 10, flex: 1 },
  toggleButton: { minHeight: 36, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, paddingHorizontal: 6 },
  toggleText: { color: A.gold, fontSize: 10, fontWeight: '900' as const, letterSpacing: 0.6 },
};