import React, { useRef, useState } from 'react';
import { PixelRatio, Pressable, RefreshControl, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import { ReadableText as Text } from '../components/typography';
import {
  getDaily007AdminListVideosQueryKey,
  getDaily007ListVideosQueryKey,
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
  category: 'application' | 'youtube';
  description: string | null;
  publishDate: string;
  thumbnailUrl: string | null;
  displayOrder: number;
  active: boolean;
  status: 'published' | 'unpublished';
  createdAt: string;
  updatedAt: string;
};

type VideoFormState = {
  title: string;
  url: string;
  category: 'application' | 'youtube';
  description: string;
  publishDate: string;
  thumbnailUrl: string;
  displayOrder: string;
  status: 'published' | 'unpublished';
};

const todayDate = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

const isValidPublishDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day;
};

const emptyVideoForm = (): VideoFormState => ({
  title: '',
  url: '',
  category: 'youtube',
  description: '',
  publishDate: todayDate(),
  thumbnailUrl: '',
  displayOrder: '0',
  status: 'published',
});

const CATEGORY_LABELS = {
  application: 'DAILY007 APPLICATION RELATED VIDEO',
  youtube: 'YOUTUBE VIDEOS',
} as const;

function CategoryPicker({
  value,
  onChange,
  testPrefix,
}: {
  value: VideoFormState['category'];
  onChange: (category: VideoFormState['category']) => void;
  testPrefix: string;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={styles.categoryPicker}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Video category: ${CATEGORY_LABELS[value]}`}
        accessibilityHint="Opens the category choices."
        accessibilityState={{ expanded }}
        testID={`${testPrefix}-category`}
        onPress={() => setExpanded((current) => !current)}
        style={styles.categoryPickerButton}
      >
        <Text style={styles.categoryPickerValue}>{CATEGORY_LABELS[value]}</Text>
        <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={17} color={A.gold} />
      </Pressable>
      {expanded ? (
        <View style={styles.categoryPickerOptions}>
          {(['application', 'youtube'] as const).map((category) => (
            <Pressable
              key={category}
              accessibilityRole="button"
              accessibilityState={{ selected: value === category }}
              testID={`${testPrefix}-category-${category}`}
              onPress={() => {
                onChange(category);
                setExpanded(false);
              }}
              style={styles.categoryPickerOption}
            >
              <Text style={[
                styles.categoryPickerValue,
                value === category && styles.choiceTextSelected,
              ]}>
                {CATEGORY_LABELS[category]}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export default function AdminVideos() {
  const queryClient = useQueryClient();
  const videosQuery = useDaily007AdminListVideos();
  const { mutateAsync: createVideo, isPending: isCreating } = useDaily007AdminCreateVideo();
  const { mutateAsync: setVideoActive, isPending: isToggling } = useDaily007AdminSetVideoActive();
  const { mutateAsync: updateManagedVideo, isPending: isSavingEdit } = useDaily007AdminUpdateVideo();
  const { mutateAsync: deleteManagedVideo, isPending: isDeleting } = useDaily007AdminDeleteVideo();
  const toast = useToast();
  const [form, setForm] = useState<VideoFormState>(emptyVideoForm);
  const [error, setError] = useState('');
  const [editError, setEditError] = useState('');
  const [editingVideo, setEditingVideo] = useState<{ id: string; form: VideoFormState } | null>(null);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | VideoFormState['category']>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | VideoFormState['status']>('all');
  const [pendingDelete, setPendingDelete] = useState<ManagedVideo | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const pendingToggleVideoIdRef = useRef<string | null>(null);
  const [pendingToggleVideoId, setPendingToggleVideoId] = useState<string | null>(null);
  const videos: ManagedVideo[] = (videosQuery.data?.videos ?? []) as ManagedVideo[];
  const filteredVideos = videos.filter((video) => {
    const haystack = `${video.title} ${video.topic} ${video.description ?? ''} ${video.url} ${CATEGORY_LABELS[video.category]}`.toLowerCase();
    return (!search.trim() || haystack.includes(search.trim().toLowerCase())) &&
      (categoryFilter === 'all' || video.category === categoryFilter) &&
      (statusFilter === 'all' || video.status === statusFilter);
  });
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

  const refreshVideoLists = async () => {
    await Promise.all([
      videosQuery.refetch(),
      queryClient.invalidateQueries({ queryKey: getDaily007AdminListVideosQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getDaily007ListVideosQueryKey() }),
    ]);
  };

  const updateForm = (key: keyof VideoFormState, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const updateEditingForm = (key: keyof VideoFormState, value: string) => {
    setEditingVideo((current) =>
      current ? { ...current, form: { ...current.form, [key]: value } } : current,
    );
  };

  const validateForm = (values: VideoFormState): string | null => {
    if (!values.title.trim() || !values.url.trim() || !values.category || !values.publishDate) {
      return 'Enter a title, video URL, category, and publish date.';
    }
    if (values.title.trim().length > 120 || values.url.trim().length > 500) {
      return 'Title must be 120 characters or fewer and URL must be 500 characters or fewer.';
    }
    if (values.description.trim().length > 1000) {
      return 'Description must be 1,000 characters or fewer.';
    }
    if (!isValidPublishDate(values.publishDate)) {
      return 'Enter a valid publish date.';
    }
    if (!/^\d+$/.test(values.displayOrder) ||
      Number(values.displayOrder) > 1_000_000) {
      return 'Display order must be a whole number from 0 to 1,000,000.';
    }
    if (values.thumbnailUrl.trim()) {
      try {
        const thumbnail = new URL(values.thumbnailUrl.trim());
        if (thumbnail.protocol !== 'https:' || thumbnail.username || thumbnail.password || thumbnail.port) {
          return 'Thumbnail URL must use HTTPS.';
        }
      } catch {
        return 'Enter a valid HTTPS thumbnail URL.';
      }
    }
    return null;
  };

  const payloadFromForm = (values: VideoFormState) => ({
    title: values.title.trim(),
    url: values.url.trim(),
    category: values.category,
    description: values.description.trim() || null,
    publishDate: values.publishDate,
    thumbnailUrl: values.thumbnailUrl.trim() || null,
    displayOrder: Number(values.displayOrder),
    status: values.status,
  });

  const addVideo = async () => {
    const formError = validateForm(form);
    if (formError) {
      setError(formError);
      return;
    }
    setError('');
    try {
      await createVideo({ data: payloadFromForm(form) });
      setForm(emptyVideoForm());
      toast('Video added.', 'success');
      await refreshVideoLists();
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
        await refreshVideoLists();
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
    setEditingVideo({
      id: video.id,
      form: {
        title: video.title,
        url: video.url,
        category: video.category,
        description: video.description ?? '',
        publishDate: video.publishDate.slice(0, 10),
        thumbnailUrl: video.thumbnailUrl ?? '',
        displayOrder: String(video.displayOrder),
        status: video.status,
      },
    });
    setEditError('');
  };

  const cancelEdit = () => {
    setEditingVideo(null);
    setEditError('');
  };

  const saveEdit = async () => {
    if (!editingVideo) return;
    const formError = validateForm(editingVideo.form);
    if (formError) {
      setEditError(formError);
      return;
    }
    setEditError('');
    try {
      await updateManagedVideo({
        id: editingVideo.id,
        data: {
          ...payloadFromForm(editingVideo.form),
          topic: videos.find((video) => video.id === editingVideo.id)?.topic,
        },
      });
      setEditingVideo(null);
      toast('Video updated.', 'success');
      await refreshVideoLists();
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
      await refreshVideoLists();
    } catch (cause) {
      toast(apiError(cause), 'error');
    }
  };

  const renderVideoForm = (
    values: VideoFormState,
    onChange: (key: keyof VideoFormState, value: string) => void,
    onSubmit: () => void,
    busy: boolean,
    testPrefix: string,
    onCancel?: () => void,
  ) => (
    <>
      <Text style={styles.fieldLabel}>VIDEO TITLE *</Text>
      <Input
        value={values.title}
        onChangeText={(value) => onChange('title', value)}
        placeholder="Video title"
        autoCapitalize="sentences"
      />
      <Text style={styles.fieldLabel}>VIDEO URL *</Text>
      <Input
        value={values.url}
        onChangeText={(value) => onChange('url', value)}
        placeholder="https://youtu.be/…"
        autoCapitalize="none"
      />
      <Text style={styles.fieldLabel}>CATEGORY *</Text>
      <CategoryPicker
        value={values.category}
        onChange={(category) => onChange('category', category)}
        testPrefix={testPrefix}
      />
      <Text style={styles.fieldLabel}>DESCRIPTION (OPTIONAL)</Text>
      <Input
        value={values.description}
        onChangeText={(value) => onChange('description', value)}
        placeholder="Short video description"
        autoCapitalize="sentences"
        multiline
      />
      <Text style={styles.fieldLabel}>PUBLISH DATE *</Text>
      <Input
        value={values.publishDate}
        onChangeText={(value) => onChange('publishDate', value)}
        placeholder="YYYY-MM-DD"
        autoCapitalize="none"
      />
      <Text style={styles.fieldLabel}>THUMBNAIL URL (OPTIONAL)</Text>
      <Input
        value={values.thumbnailUrl}
        onChangeText={(value) => onChange('thumbnailUrl', value)}
        placeholder="https://…"
        autoCapitalize="none"
      />
      <Text style={styles.fieldLabel}>DISPLAY ORDER (OPTIONAL)</Text>
      <Input
        value={values.displayOrder}
        onChangeText={(value) => onChange('displayOrder', value.replace(/\D/g, '').slice(0, 7))}
        placeholder="0"
        keyboardType="number-pad"
      />
      <Text style={styles.fieldLabel}>PUBLICATION STATUS</Text>
      <View style={styles.choiceRow}>
        {(['published', 'unpublished'] as const).map((status) => (
          <Pressable
            key={status}
            accessibilityRole="button"
            accessibilityState={{ selected: values.status === status }}
            testID={`${testPrefix}-status-${status}`}
            onPress={() => onChange('status', status)}
            style={[
              styles.choiceButton,
              values.status === status && styles.choiceButtonSelected,
            ]}
          >
            <Text style={[
              styles.choiceText,
              values.status === status && styles.choiceTextSelected,
            ]}>
              {status.toUpperCase()}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.formActions}>
        <View style={{ flex: 1 }}>
          <Btn
            title={testPrefix === 'admin-video-add' ? 'ADD VIDEO' : 'SAVE CHANGES'}
            onPress={onSubmit}
            loading={busy}
            disabled={mutationsBusy && !busy}
            testID={testPrefix}
          />
        </View>
        {onCancel ? (
          <View style={{ flex: 1 }}>
            <Btn title="CANCEL" kind="ghost" onPress={onCancel} disabled={mutationsBusy} />
          </View>
        ) : null}
      </View>
    </>
  );

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
        title="Video Management"
        sub="Full Admin only · published videos appear in their user category"
        icon="youtube"
      />

      <Card style={{ marginBottom: 14 }}>
        <Text style={styles.formTitle}>ADD VIDEO</Text>
        {renderVideoForm(form, updateForm, () => { void addVideo(); }, isCreating, 'admin-video-add')}
        {!!error ? (
          <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
        ) : null}
        <Text style={styles.help}>
          Use YouTube watch, youtu.be, Shorts, embed, or live links. A video with watch history cannot be deleted; unpublish it to hide it while retaining its reward history.
        </Text>
      </Card>

      <SectionTitle
        title={`VIDEOS · ${filteredVideos.length} OF ${videos.length}`}
        sub="Search and filter by category and publication status."
        icon="list"
      />
      <Card style={{ marginBottom: 12 }}>
        <Text style={styles.fieldLabel}>SEARCH VIDEOS</Text>
        <Input value={search} onChangeText={setSearch} placeholder="Title, description, URL…" autoCapitalize="none" />
        <Text style={styles.fieldLabel}>CATEGORY FILTER</Text>
        <View style={styles.choiceRow}>
          {([
            ['all', 'ALL'],
            ['application', 'DAILY007 APP'],
            ['youtube', 'YOUTUBE'],
          ] as const).map(([value, label]) => (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityState={{ selected: categoryFilter === value }}
              onPress={() => setCategoryFilter(value)}
              style={[styles.choiceButton, categoryFilter === value && styles.choiceButtonSelected]}
            >
              <Text style={[styles.choiceText, categoryFilter === value && styles.choiceTextSelected]}>{label}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.fieldLabel}>STATUS FILTER</Text>
        <View style={styles.choiceRow}>
          {([
            ['all', 'ALL'],
            ['published', 'PUBLISHED'],
            ['unpublished', 'UNPUBLISHED'],
          ] as const).map(([value, label]) => (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityState={{ selected: statusFilter === value }}
              onPress={() => setStatusFilter(value)}
              style={[styles.choiceButton, statusFilter === value && styles.choiceButtonSelected]}
            >
              <Text style={[styles.choiceText, statusFilter === value && styles.choiceTextSelected]}>{label}</Text>
            </Pressable>
          ))}
        </View>
      </Card>

      {videosQuery.isLoading && !videosQuery.data ? <Loading /> : null}
      {videosQuery.isError ? (
        <Card>
          <Text style={styles.error}>Could not load videos. Pull down to try again.</Text>
        </Card>
      ) : null}
      {!videosQuery.isLoading && !videosQuery.isError && videos.length === 0 ? (
        <Card><Empty text="No videos yet. Add a video above." /></Card>
      ) : null}
      {!videosQuery.isLoading && videos.length > 0 && filteredVideos.length === 0 ? (
        <Card><Empty text="No videos match these search and filter settings." /></Card>
      ) : null}

      {filteredVideos.map((video) => (
        <Card key={video.id} style={{ marginBottom: 10 }}>
          <View style={styles.videoHeader}>
            <View style={{ flex: 1 }}>
              <Text testID={`admin-video-title-${video.id}`} style={styles.videoTitle}>{video.title}</Text>
              <Text testID={`admin-video-topic-${video.id}`} style={styles.videoTopic}>
                {CATEGORY_LABELS[video.category]} · {video.topic}
              </Text>
              <Text style={styles.videoMeta}>
                {video.publishDate.slice(0, 10)} · ORDER {video.displayOrder}
              </Text>
              {video.description ? (
                <Text style={styles.videoDescription}>{video.description}</Text>
              ) : null}
              <Text numberOfLines={1} style={styles.videoUrl}>{video.url}</Text>
            </View>
            <View style={[styles.status, video.active ? styles.statusActive : styles.statusInactive]}>
              <Text testID={`admin-video-status-${video.id}`} style={[styles.statusText, video.active ? styles.statusTextActive : styles.statusTextInactive]}>
                {video.status.toUpperCase()}
              </Text>
            </View>
          </View>
          {editingVideo?.id === video.id ? (
            <View style={styles.editPanel}>
              <Text style={styles.formTitle}>EDIT VIDEO</Text>
              {renderVideoForm(
                editingVideo.form,
                updateEditingForm,
                () => { void saveEdit(); },
                isSavingEdit,
                `admin-video-save-${video.id}`,
                cancelEdit,
              )}
              {!!editError ? (
                <Text accessibilityRole="alert" style={styles.error}>{editError}</Text>
              ) : null}
              <Text style={styles.help}>
                YouTube links cannot be changed after watch history exists. Hidden videos retain all existing reward history.
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
  categoryPicker: { marginBottom: 12 },
  categoryPickerButton: {
    minHeight: 46,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    gap: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: A.border,
    backgroundColor: '#0B1530',
  },
  categoryPickerValue: { color: A.text, flex: 1, fontSize: 11, lineHeight: 16, fontWeight: '800' as const },
  categoryPickerOptions: {
    marginTop: 5,
    padding: 5,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: A.border,
    backgroundColor: A.cardSolid,
  },
  categoryPickerOption: { minHeight: 44, justifyContent: 'center' as const, paddingHorizontal: 10 },
  choiceRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8, marginBottom: 12 },
  choiceButton: {
    minHeight: 42,
    minWidth: 82,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: A.border,
    backgroundColor: '#0B1530',
  },
  choiceButtonSelected: { borderColor: A.cyan, backgroundColor: 'rgba(77,163,255,0.15)' },
  choiceText: { color: A.sub, fontSize: 10, fontWeight: '800' as const, textAlign: 'center' as const },
  choiceTextSelected: { color: A.gold },
  formActions: { flexDirection: 'row' as const, gap: 10, marginTop: 4 },
  help: { color: A.sub, fontSize: 11, lineHeight: 16, marginTop: 10 },
  error: { color: A.danger, fontSize: 12, lineHeight: 17, marginBottom: 10 },
  videoHeader: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 10, marginBottom: 12 },
  editPanel: { borderTopWidth: 1, borderTopColor: A.border, paddingTop: 12 },
  videoTitle: { color: A.text, fontSize: 13, lineHeight: 18, fontWeight: '800' as const },
  videoTopic: { color: A.gold, fontSize: 10, fontWeight: '800' as const, marginTop: 4 },
  videoMeta: { color: A.sub, fontSize: 10, marginTop: 4 },
  videoDescription: { color: A.text, fontSize: 11, lineHeight: 16, marginTop: 5 },
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