import React from 'react';
import { Feather } from '@expo/vector-icons';
import {
  Pressable,
  View,
  type PressableProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { ReadableText as Text } from './typography';

type VideoCatalogBackButtonProps = {
  onPress: () => void;
  buttonStyle: PressableProps['style'];
  textStyle: StyleProp<TextStyle>;
  primaryColor: string;
};

export function VideoCatalogBackButton({
  onPress,
  buttonStyle,
  textStyle,
  primaryColor,
}: VideoCatalogBackButtonProps) {
  return (
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityLabel="Back to videos"
      testID="video-catalog-back"
      onPress={onPress}
      style={buttonStyle}
    >
      <Feather
        name="arrow-left"
        size={17}
        color={primaryColor}
        accessible={false}
        importantForAccessibility="no"
      />
      <Text accessible={false} style={textStyle}>BACK TO VIDEOS</Text>
    </Pressable>
  );
}

type VideoUnavailableErrorAnnouncementProps = {
  message: string;
  announce: boolean;
  containerStyle: StyleProp<ViewStyle>;
  textStyle: StyleProp<TextStyle>;
  iconColor: string;
};

export function VideoUnavailableErrorAnnouncement({
  message,
  announce,
  containerStyle,
  textStyle,
  iconColor,
}: VideoUnavailableErrorAnnouncementProps) {
  return (
    <View
      accessible={false}
      testID="video-watch-error"
      style={containerStyle}
    >
      <Feather
        name="alert-circle"
        size={16}
        color={iconColor}
        accessible={false}
        importantForAccessibility="no"
      />
      <Text
        accessibilityRole="text"
        accessibilityLiveRegion={announce ? 'polite' : undefined}
        testID="video-watch-error-message"
        style={textStyle}
      >
        {message}
      </Text>
    </View>
  );
}
