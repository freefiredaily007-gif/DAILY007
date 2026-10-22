import { Alert } from 'react-native';
import { translateExactText } from './index';

export function showLocalizedAlert(
  title: string,
  message?: string,
  buttons?: Array<{
    text?: string;
    style?: 'default' | 'cancel' | 'destructive';
    onPress?: () => void;
  }>,
) {
  Alert.alert(
    translateExactText(title),
    message === undefined ? undefined : translateExactText(message),
    buttons?.map((button) => ({
      ...button,
      text: button.text ? translateExactText(button.text) : button.text,
    })),
  );
}
