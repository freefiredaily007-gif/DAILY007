import React, { useRef, useState } from 'react';
import { PixelRatio, RefreshControl, View } from 'react-native';
import { ReadableText as Text } from '../components/typography';
import {
  useDaily007AdminCreateVideo,
  useDaily007AdminDeleteVideo,
  useDaily007AdminListVideos,
  useDaily007AdminSetVideoActive,
  useDaily007AdminUpdateVideo,
} from '@workspace/api-client-react';
import { KeyboardAwareScrollViewCompat } from '../../components/KeyboardAwareScrollViewCompat';
import {
  A,
  Btn,
  Card,
  ConfirmDialog,
  Empty,
  Input,
  Loading,
  SectionTitle,
  useToast,
} from '../components/adminKit';
import { apiError } from '../lib/api';
import { startVideoToggleRequest } from '../lib/adminVideoToggle';

type ManagedVideo = {
  id: string;
  title: string;
  topic: string;
  youtubeId: string;
  url: string;
  active: boolean;
  createdAt: string;
};

export default function AdminVideos() {
  const videosQuery = useDaily007AdminListVideos();
  const { mutateAsync: createVideo, isPending: isCreating } = useDaily007AdminCreateVideo();
  const { mutateAsync: setVideoActive, isPending: isToggling } = useDaily007AdminSetVideoActive();
  const { mutateAsync: updateManagedVideo, isPending: isSavingEdit } = useDaily007AdminUpdateVideo();
  const { mutateAsync: deleteManagedVideo, isPending: isDeleting } = useDaily007AdminDeleteVideo();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [topic, setTopic] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [editError, setEditError] = useState('');
  const [editingVideoId, setEditingVideoId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editTopic, setEditTopic] = useState('');
  const [editUrl, setEditUrl] = useState('');
  const [pendingDelete, setPendingDelete] = useState<ManagedVideo | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const pendingToggleVideoIdRef = useRef<string | null>(null);
  const [pendingToggleVideoId, setPendingToggleVideoId] = useState<string | null>(null);
  const videos: ManagedVideo[] = (videosQuery.data?.videos ?? []) as ManagedVideo[];
  const mutationsBusy = isCreating || isToggling || isSavingEdit || isDeleting || pendingToggleVideoId !== null;
  const enlargedText = PixelRatio.getFontScale() >= 1.3;

  const refreshVideos = async () => {
    setRefreshing(true);
    try {
      await videosQuery.refetch();
    } finally {
      setRefreshing(false);
    }
  };

  const addVideo = async () => {
    if (!title.trim() || !topic.trim() || !url.trim()) {
      setError('Enter a title, topic, and YouTube video link.');
      return;
    }
    if (title.trim().length > 120 || topic.trim().length > 80) {
      setError('Title must be 120 characters or fewer and topic 80 characters or fewer.');
      return;
    }
    setError('');
    try {
      await createVideo({ data: { title: title.trim(), topic: topic.trim(), url: url.trim() } });
      setTitle('');
      setTopic('');
      setUrl('');
      toast('Video added.', 'success');
      await videosQuery.refetch();
    } catch (cause) {
      setError(apiError(cause));
    }
  };

  const toggleVideo = async (video: ManagedVideo) => {
    const request = startVideoToggleRequest(
      video.id,
      pendingToggleVideoIdRef,
      setPendingToggleVideoId,
      async () => {
        setError('');
        await setVideoActive({ id: video.id, data: { active: !video.active } });
        toast(video.active ? 'Video hidden from players.' : 'Video is now available to players.', 'success');
        await videosQuery.refetch();
      },
    );
    if (!request) return;

    try {
      await request;
    } catch (cause) {
      const action = video.active ? 'hide' : 'activate';
      setError(`Could not ${action} "${video.title}": ${apiError(cause)}`);
    }
  };

  const beginEdit = (video: ManagedVideo) => {
    setEditingVideoId(video.id);
    setEditTitle(video.title);
    setEditTopic(video.topic);
    setEditUrl(video.url);
    setEditError('');
  };

  const cancelEdit = () => {
    setEditingVideoId(null);
    setEditError('');
  };

  const saveEdit = async (id: string) => {
    if (!editTitle.trim() || !editTopic.trim() || !editUrl.trim()) {
      setEditError('Enter a title, topic, and YouTube video link.');
      return;
    }
    if (editTitle.trim().length > 120 || editTopic.trim().length > 80 || editUrl.trim().length > 500) {
      setEditError('Title must be 120 characters or fewer, topic 80, and link 500.');
      return;
    }
    setEditError('');
    try {
      await updateManagedVideo({
        id,
        data: { title: editTitle.trim(), topic: editTopic.trim(), url: editUrl.trim() },
      });
      setEditingVideoId(null);
      toast('Video updated.', 'success');
      await videosQuery.refetch();
    } catch (cause) {
      setEditError(apiError(cause));
    }
  };

  const permanentlyDeleteVideo = async () => {
    const video = pendingDelete;
    if (!video) return;
    setPendingDelete(null);
    try {
      await deleteManagedVideo({ id: video.id });
      toast('Video permanently deleted.', 'success');
      await videosQuery.refetch();
    } catch (cause) {
      toast(apiError(cause), 'error');
    }
  };

  return (
    <KeyboardAwareScrollViewCompat
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: 14, paddingBottom: 110 }}
      bottomOffset={64}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => { void refreshVideos(); }}
          tintColor={A.red}
        />
      }
    >
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
        <Text style={styles.fieldLabel}>TOPIC</Text>
        <Input
          value={topic}
          onChangeText={setTopic}
          placeholder="e.g. Match join"
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
          disabled={mutationsBusy}
          testID="admin-video-add"
        />
        <Text style={styles.help}>
          Add a short topic players can search. Use a YouTube watch, youtu.be, Shorts, or embed link. Turn a video off to hide it without deleting its reward history.
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
              <Text testID={`admin-video-title-${video.id}`} style={styles.videoTitle}>{video.title}</Text>
              <Text testID={`admin-video-topic-${video.id}`} style={styles.videoTopic}>TOPIC · {video.topic}</Text>
              <Text numberOfLines={1} style={styles.videoUrl}>{video.url}</Text>
            </View>
            <View style={[styles.status, video.active ? styles.statusActive : styles.statusInactive]}>
              <Text testID={`admin-video-status-${video.id}`} style={[styles.statusText, video.active ? styles.statusTextActive : styles.statusTextInactive]}>
                {video.active ? 'ACTIVE' : 'HIDDEN'}
              </Text>
            </View>
          </View>
          {editingVideoId === video.id ? (
            <View style={styles.editPanel}>
              <Text style={styles.formTitle}>EDIT VIDEO</Text>
              <Text style={styles.fieldLabel}>TITLE</Text>
              <Input
                value={editTitle}
                onChangeText={setEditTitle}
                placeholder="Video title"
                autoCapitalize="sentences"
              />
              <Text style={styles.fieldLabel}>TOPIC</Text>
              <Input
                value={editTopic}
                onChangeText={setEditTopic}
                placeholder="e.g. Match join"
                autoCapitalize="sentences"
              />
              <Text style={styles.fieldLabel}>YOUTUBE VIDEO LINK</Text>
              <Input
                value={editUrl}
                onChangeText={setEditUrl}
                placeholder="https://youtu.be/…"
                autoCapitalize="none"
              />
              {!!editError ? (
                <Text accessibilityRole="alert" style={styles.error}>{editError}</Text>
              ) : null}
              <View style={styles.editActions}>
                <View style={{ flex: 1 }}>
                  <Btn
                    title="SAVE CHANGES"
                    onPress={() => { void saveEdit(video.id); }}
                    loading={isSavingEdit}
                    disabled={isCreating || isToggling || isDeleting}
                    testID={`admin-video-save-${video.id}`}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Btn
                    title="CANCEL"
                    kind="ghost"
                    onPress={cancelEdit}
                    disabled={mutationsBusy}
                  />
                </View>
              </View>
              <Text style={styles.help}>
                A YouTube link cannot be changed after watch history exists. Add a new video instead.
              </Text>
            </View>
          ) : (
            <View style={styles.videoFooter}>
              <Text style={styles.videoReward}>1 coin per completed view · repeat views count</Text>
              {pendingToggleVideoId === video.id ? (
                <Text
                  testID={`admin-video-toggle-pending-${video.id}`}
                  accessibilityLiveRegion="polite"
                  style={styles.togglePending}
                >
                  {video.active ? 'Hide request in progress. Please wait.' : 'Activation request in progress. Please wait.'}
                </Text>
              ) : null}
              <View style={[styles.videoActions, enlargedText && styles.videoActionsEnlarged]}>
                <View style={[styles.actionItem, enlargedText && styles.actionItemEnlarged]}>
                  <Btn
                    title="EDIT"
                    kind="gold"
                    small
                    onPress={() => beginEdit(video)}
                    disabled={mutationsBusy}
                    testID={`admin-video-edit-${video.id}`}
                  />
                </View>
                <View style={[styles.actionItem, enlargedText && styles.actionItemEnlarged]}>
                  <Btn
                    title={video.active ? 'HIDE' : 'ACTIVATE'}
                    kind={video.active ? 'ghost' : 'green'}
                    small
                    onPress={() => { void toggleVideo(video); }}
                    loading={pendingToggleVideoId === video.id}
                    disabled={mutationsBusy}
                    accessibilityLabel={
                      pendingToggleVideoId === video.id
                        ? `${video.active ? 'Hiding' : 'Activating'} ${video.title}. Request in progress.`
                        : undefined
                    }
                    accessibilityState={{
                      busy: pendingToggleVideoId === video.id,
                      disabled: mutationsBusy,
                    }}
                    testID={`admin-video-toggle-${video.id}`}
                  />
                </View>
                <View style={[styles.actionItem, enlargedText && styles.actionItemEnlarged]}>
                  <Btn
                    title="DELETE"
                    kind="danger"
                    small
                    onPress={() => setPendingDelete(video)}
                    disabled={mutationsBusy}
                    testID={`admin-video-delete-${video.id}`}
                  />
                </View>
              </View>
            </View>
          )}
        </Card>
      ))}
      <ConfirmDialog
        visible={!!pendingDelete}
        title="Delete video permanently?"
        message={`Permanently delete "${pendingDelete?.title ?? 'this video'}"? This cannot be undone. Videos with watch history are protected; use Hide instead.`}
        confirmTitle="DELETE"
        danger
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => { void permanentlyDeleteVideo(); }}
        cancelTestID="admin-video-delete-cancel"
        confirmTestID="admin-video-delete-confirm"
      />
    </KeyboardAwareScrollViewCompat>
  );
}

const styles = {
  formTitle: { color: A.text, fontSize: 12, fontWeight: '900' as const, letterSpacing: 1, marginBottom: 12 },
  fieldLabel: { color: A.sub, fontSize: 10, fontWeight: '800' as const, letterSpacing: 0.8, marginBottom: 6 },
  help: { color: A.sub, fontSize: 11, lineHeight: 16, marginTop: 10 },
  error: { color: A.danger, fontSize: 12, lineHeight: 17, marginBottom: 10 },
  videoHeader: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 10, marginBottom: 12 },
  editPanel: { borderTopWidth: 1, borderTopColor: A.border, paddingTop: 12 },
  videoTitle: { color: A.text, fontSize: 13, lineHeight: 18, fontWeight: '800' as const },
  videoTopic: { color: A.gold, fontSize: 10, fontWeight: '800' as const, marginTop: 4 },
  videoUrl: { color: A.sub, fontSize: 10, marginTop: 4 },
  status: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4 },
  statusActive: { backgroundColor: 'rgba(46,204,113,0.12)', borderColor: 'rgba(46,204,113,0.45)' },
  statusInactive: { backgroundColor: 'rgba(77,163,255,0.04)', borderColor: A.border },
  statusText: { fontSize: 9, fontWeight: '900' as const, letterSpacing: 0.7 },
  statusTextActive: { color: A.green },
  statusTextInactive: { color: A.sub },
  videoFooter: {
    flexDirection: 'column' as const,
    alignItems: 'stretch' as const,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: A.border,
    paddingTop: 10,
  },
  videoReward: { color: A.sub, fontSize: 10, flex: 1 },
  togglePending: { color: A.gold, fontSize: 11, fontWeight: '700' as const, lineHeight: 16 },
  videoActions: { flexDirection: 'row' as const, gap: 8 },
  videoActionsEnlarged: { flexWrap: 'wrap' as const },
  actionItem: { flex: 1 },
  actionItemEnlarged: { flexBasis: 132, minWidth: 132 },
  editActions: { flexDirection: 'row' as const, gap: 10, marginTop: 4 },
};