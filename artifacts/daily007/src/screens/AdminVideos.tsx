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

type VideoCategory = 'application_related' | 'youtube';

type ManagedVideo = {
  id: string;
  title: string;
  topic: string;
  youtubeId: string;
  url: string;
  category: VideoCategory;
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
  category: VideoCategory;
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

const emptyVideoForm = (category: VideoCategory = 'youtube'): VideoFormState => ({
  title: '',
  url: '',
  category,
  description: '',
  publishDate: todayDate(),
  thumbnailUrl: '',
  displayOrder: '0',
  status: 'published',
});

const CATEGORY_LABELS = {
  application_related: 'DAILY007 APPLICATION RELATED VIDEO',
  youtube: 'YOUTUBE VIDEOS',
} as const;

export default function AdminVideos() {
  const queryClient = useQueryClient();
  const videosQuery = useDaily007AdminListVideos();
  const { mutateAsync: createVideo, isPending: isCreating } = useDaily007AdminCreateVideo();
  const { mutateAsync: setVideoActive, isPending: isToggling } = useDaily007AdminSetVideoActive();
  const { mutateAsync: updateManagedVideo, isPending: isSavingEdit } = useDaily007AdminUpdateVideo();
  const { mutateAsync: deleteManagedVideo, isPending: isDeleting } = useDaily007AdminDeleteVideo();
  const toast = useToast();
  const [form, setForm] = useState<VideoFormState>(emptyVideoForm);
  const [selectedCategory, setSelectedCategory] = useState<VideoCategory | null>(null);
  const [addFormOpen, setAddFormOpen] = useState(false);
  const [error, setError] = useState('');
  const [editError, setEditError] = useState('');
  const [editingVideo, setEditingVideo] = useState<{ id: string; form: VideoFormState } | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | VideoFormState['status']>('all');
  const [pendingDelete, setPendingDelete] = useState<ManagedVideo | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const pendingToggleVideoIdRef = useRef<string | null>(null);
  const [pendingToggleVideoId, setPendingToggleVideoId] = useState<string | null>(null);
  const videos: ManagedVideo[] = (videosQuery.data?.videos ?? []) as ManagedVideo[];
  const categoryVideos = selectedCategory
    ? videos.filter((video) => video.category === selectedCategory)
    : [];
  const filteredVideos = categoryVideos.filter((video) => {
    const haystack = `${video.title} ${video.topic} ${video.description ?? ''} ${video.url} ${CATEGORY_LABELS[video.category]}`.toLowerCase();
    return (!search.trim() || haystack.includes(search.trim().toLowerCase())) &&
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

  const openCategory = (category: VideoCategory) => {
    setSearch('');
    setStatusFilter('all');
    setError('');
    setAddFormOpen(false);
    setForm(emptyVideoForm(category));
    setSelectedCategory(category);
  };

  const closeCategory = () => {
    setSelectedCategory(null);
    setAddFormOpen(false);
    setSearch('');
    setStatusFilter('all');
    setError('');
    setEditError('');
    setEditingVideo(null);
  };

  const updateEditingForm = (key: keyof VideoFormState, value: string) => {
    setEditingVideo((current) =>
      current ? { ...current, form: { ...current.form, [key]: value } } : current,
    );
  };

  const validateForm = (values: VideoFormState): string | null => {
    if (!values.title.trim() || !values.url.trim() || !values.publishDate) {
      return 'Enter a title, video URL, and publish date.';
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
    if (!selectedCategory) return;
    const formError = validateForm(form);
    if (formError) {
      setError(formError);
      return;
    }
    setError('');
    try {
      await createVideo({
        data: {
          ...payloadFromForm(form),
          category: selectedCategory,
          topic: CATEGORY_LABELS[selectedCategory],
        },
      });
      setForm(emptyVideoForm());
      setAddFormOpen(false);
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
    formMode: 'add' | 'edit',
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
      <Text style={styles.fieldLabel}>DESCRIPTION (OPTIONAL)</Text>
      <Input
        value={values.description}
        onChangeText={(value) => onChange('description', value)}
        placeholder="Short video description"
        autoCapitalize="sentences"
        multiline
      />
      <Text style={styles.fieldLabel}>YOUTUBE URL / LINK *</Text>
      <Input
        value={values.url}
        onChangeText={(value) => onChange('url', value)}
        placeholder="https://youtu.be/…"
        autoCapitalize="none"
      />
      {formMode === 'edit' ? (
        <>
          <Text style={styles.fieldLabel}>VIDEO CATEGORY</Text>
          <View style={styles.choiceRow}>
            {(['application_related', 'youtube'] as const).map((category) => (
              <Pressable
                key={category}
                accessibilityRole="button"
                accessibilityState={{ selected: values.category === category }}
                testID={`${testPrefix}-category-${category}`}
                onPress={() => onChange('category', category)}
                style={[styles.choiceButton, values.category === category && styles.choiceButtonSelected]}
              >
                <Text style={[styles.choiceText, values.category === category && styles.choiceTextSelected]}>
                  {category === 'application_related' ? 'DAILY007 APP' : 'YOUTUBE'}
                </Text>
              </Pressable>
            ))}
          </View>
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
        </>
      ) : null}
      <View style={styles.formActions}>
        <View style={{ flex: 1 }}>
          <Btn
            title={formMode === 'add' ? 'ADD VIDEO' : 'SAVE CHANGES'}
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

      {selectedCategory === null ? (
        <View testID="admin-video-category-selector">
          <Text style={styles.categoryIntro}>Choose a video collection to manage.</Text>
          {(['application_related', 'youtube'] as const).map((category) => {
            const count = videos.filter((video) => video.category === category).length;
            return (
              <Pressable
                key={category}
                accessibilityRole="button"
                accessibilityLabel={`${CATEGORY_LABELS[category]}, ${count} videos`}
                accessibilityHint="Opens this video category."
                testID={`admin-video-category-${category}`}
                onPress={() => openCategory(category)}
                style={({ pressed }) => [
                  styles.categoryCard,
                  pressed && { opacity: 0.8 },
                ]}
              >
                <View style={styles.categoryIcon}>
                  <Feather
                    name={category === 'youtube' ? 'youtube' : 'smartphone'}
                    size={22}
                    color={A.gold}
                  />
                </View>
                <View style={styles.categoryContent}>
                  <Text style={styles.categoryTitle}>{CATEGORY_LABELS[category]}</Text>
                  <Text style={styles.categorySubtitle}>
                    {category === 'application_related'
                      ? 'Manage Daily007 feature guides and tutorials.'
                      : 'Manage the existing YouTube video library.'}
                  </Text>
                  <Text style={styles.categoryCount}>{count} videos</Text>
                </View>
                <Feather name="chevron-right" size={20} color={A.cyan} />
              </Pressable>
            );
          })}
        </View>
      ) : (
        <View testID={`admin-video-category-page-${selectedCategory}`}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to video categories"
            testID="admin-video-category-back"
            onPress={closeCategory}
            style={styles.backButton}
          >
            <Feather name="arrow-left" size={17} color={A.cyan} />
            <Text style={styles.backText}>ALL VIDEO CATEGORIES</Text>
          </Pressable>

          <SectionTitle
            title={CATEGORY_LABELS[selectedCategory]}
            sub="Published videos appear in this User Panel category."
            icon={selectedCategory === 'youtube' ? 'youtube' : 'smartphone'}
          />

          <View style={{ marginBottom: 12 }}>
            <Btn
              title={addFormOpen ? 'CLOSE ADD FORM' : 'ADD VIDEO'}
              kind="gold"
              onPress={() => {
                setForm(emptyVideoForm());
                setError('');
                setAddFormOpen((open) => !open);
              }}
              disabled={mutationsBusy}
              testID="admin-video-open-add"
            />
          </View>

          {addFormOpen ? (
            <View testID="admin-video-add-form">
              <Card style={{ marginBottom: 14 }}>
                <Text style={styles.formTitle}>ADD VIDEO TO {selectedCategory === 'youtube' ? 'YOUTUBE' : 'DAILY007 APP'}</Text>
                {renderVideoForm(
                  form,
                  updateForm,
                  () => { void addVideo(); },
                  isCreating,
                  'admin-video-add',
                  'add',
                  () => {
                    setAddFormOpen(false);
                    setError('');
                  },
                )}
                {!!error ? (
                  <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
                ) : null}
                <Text style={styles.help}>
                  The category is set from this page. Supports YouTube watch, youtu.be, Shorts, embed, and live links.
                </Text>
              </Card>
            </View>
          ) : null}

          <SectionTitle
            title={`VIDEOS · ${filteredVideos.length} OF ${categoryVideos.length}`}
            sub="Search and filter videos in this category."
            icon="list"
          />
          <Card style={{ marginBottom: 12 }}>
            <Text style={styles.fieldLabel}>SEARCH VIDEOS</Text>
            <Input value={search} onChangeText={setSearch} placeholder="Title, description, URL…" autoCapitalize="none" />
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
          {!videosQuery.isLoading && !videosQuery.isError && categoryVideos.length === 0 ? (
            <Card><Empty text="No videos in this category yet. Add one above." /></Card>
          ) : null}
          {!videosQuery.isLoading && categoryVideos.length > 0 && filteredVideos.length === 0 ? (
            <Card><Empty text="No videos match these search and status filters." /></Card>
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
                    'edit',
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
        </View>
      )}
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
  categoryIntro: { color: A.sub, fontSize: 12, lineHeight: 18, marginBottom: 12 },
  categoryCard: {
    minHeight: 108,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 13,
    padding: 14,
    marginBottom: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: A.border,
    backgroundColor: A.cardSolid,
  },
  categoryIcon: {
    width: 48,
    height: 48,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderRadius: 14,
    backgroundColor: 'rgba(77,163,255,0.12)',
  },
  categoryContent: { flex: 1, minWidth: 0, gap: 4 },
  categoryTitle: { color: A.gold, fontSize: 13, lineHeight: 18, fontWeight: '900' as const },
  categorySubtitle: { color: A.sub, fontSize: 11, lineHeight: 15 },
  categoryCount: { color: A.cyan, fontSize: 10, lineHeight: 15, fontWeight: '800' as const, marginTop: 2 },
  backButton: {
    minHeight: 44,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  backText: { color: A.cyan, fontSize: 11, fontWeight: '900' as const, letterSpacing: 0.6 },
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