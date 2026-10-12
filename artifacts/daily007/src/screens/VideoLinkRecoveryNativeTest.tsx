import React, { useEffect, useState } from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { ReadableText as Text } from '../components/typography';
import { VideoLinkRecovery, type VideoLinkAction } from '../components/VideoLinkRecovery';
import { useColors } from '@/hooks/useColors';

const VIDEO_URL = 'https://www.youtube.com/watch?v=daily007-talkback-recovery';

export default function VideoLinkRecoveryNativeTest() {
  if (!__DEV__) return <Redirect href="/" />;
  return <VideoLinkRecoveryFixture />;
}

function VideoLinkRecoveryFixture() {
  const colors = useColors();
  const { copy } = useLocalSearchParams<{ copy?: string }>();
  const copyFails = copy === 'fail';
  const [errorVisible, setErrorVisible] = useState(false);
  const [action, setAction] = useState<VideoLinkAction>(null);
  const [status, setStatus] = useState('');
  const [manualUrl, setManualUrl] = useState(false);
  const styles = StyleSheet.create({
    screen: {
      flex: 1,
      padding: 20,
      paddingTop: 72,
      gap: 18,
      backgroundColor: colors.background,
    },
    text: { color: colors.foreground, fontSize: 16, lineHeight: 24 },
  });

  useEffect(() => {
    const timer = setTimeout(() => setErrorVisible(true), 300);
    return () => clearTimeout(timer);
  }, []);

  const retryBrowser = async () => {
    setAction('browser');
    setStatus('');
    setManualUrl(false);
    await Promise.resolve();
    setStatus('The browser still could not open the video. Copy the URL or try again later.');
    setAction(null);
  };

  const copyVideoLink = async () => {
    setAction('copy');
    setStatus('');
    setManualUrl(false);
    await Promise.resolve();
    setStatus(
      copyFails
        ? 'Automatic copy failed. Select and copy the video URL below.'
        : 'Video link copied. Paste it into YouTube or a browser.',
    );
    setManualUrl(copyFails);
    setAction(null);
  };

  return (
    <View style={styles.screen}>
      <Text testID="video-link-recovery-fixture" style={styles.text}>
        Video link recovery · clipboard {copyFails ? 'failure' : 'success'} scenario
      </Text>
      <Text style={styles.text}>Selected video: Daily007 TalkBack recovery demo</Text>
      <Text style={styles.text}>Catalog search: accessibility</Text>
      {errorVisible ? (
        <VideoLinkRecovery
          url={VIDEO_URL}
          action={action}
          status={status}
          copyFailed={manualUrl}
          onRetryBrowser={() => { void retryBrowser(); }}
          onCopyLink={() => { void copyVideoLink(); }}
        />
      ) : (
        <Text style={styles.text}>Preparing the external-link failure announcement…</Text>
      )}
    </View>
  );
}
