import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en';
import hi from './locales/hi';
import gu from './locales/gu';
import type { AppLanguage } from './languagePreference';

const resources = {
  en: { translation: en },
  hi: { translation: hi },
  gu: { translation: gu },
};

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources,
    lng: 'en',
    fallbackLng: 'en',
    supportedLngs: ['en', 'hi', 'gu'],
    defaultNS: 'translation',
    keySeparator: false,
    nsSeparator: false,
    interpolation: { escapeValue: false },
    returnEmptyString: false,
    returnNull: false,
  });
}

export type { AppLanguage };
export { i18n, resources };

export function translateExactText(text: string): string {
  const translated = i18n.t(text, { defaultValue: text });
  if (typeof translated === 'string' && translated !== text) return translated;

  const playerSlotMatch = /^Your player slot is confirmed and (\d+) coins were deducted from your wallet\. Check MY MATCHES for room details\.$/.exec(text);
  if (playerSlotMatch) {
    return i18n.t(
      'Your player slot is confirmed and {{entryCoins}} coins were deducted from your wallet. Check MY MATCHES for room details.',
      { entryCoins: playerSlotMatch[1] },
    );
  }

  const slotMatch = /^Your slot is confirmed and (\d+) coins were deducted from your wallet\. Check MY MATCHES for room details\.$/.exec(text);
  if (slotMatch) {
    return i18n.t(
      'Your slot is confirmed and {{entryCoins}} coins were deducted from your wallet. Check MY MATCHES for room details.',
      { entryCoins: slotMatch[1] },
    );
  }

  const uppercase = text.toUpperCase();
  if (uppercase !== text) {
    const translatedUppercase = i18n.t(uppercase, { defaultValue: uppercase });
    if (typeof translatedUppercase === 'string' && translatedUppercase !== uppercase) {
      return translatedUppercase;
    }
  }

  return text;
}
