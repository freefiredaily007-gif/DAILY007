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

  const teamCapacityMatch =
    /^(\d+)\/(\d+) PLAYERS · (\d+)\/(\d+) TEAMS$/.exec(text);
  if (teamCapacityMatch) {
    return i18n.t('{{filledPlayers}}/{{totalPlayers}} PLAYERS · {{filledTeams}}/{{totalTeams}} TEAMS', {
      filledPlayers: teamCapacityMatch[1],
      totalPlayers: teamCapacityMatch[2],
      filledTeams: teamCapacityMatch[3],
      totalTeams: teamCapacityMatch[4],
    });
  }

  const joinedTeamCountMatch = /^(\d+)\/(\d+) JOINED$/.exec(text);
  if (joinedTeamCountMatch) {
    return i18n.t('{{joinedCount}}/{{teamSize}} JOINED', {
      joinedCount: joinedTeamCountMatch[1],
      teamSize: joinedTeamCountMatch[2],
    });
  }

  const joinedPlayersAccessibilityMatch = /^(\d+) of (\d+) players joined$/.exec(text);
  if (joinedPlayersAccessibilityMatch) {
    return i18n.t('{{joinedCount}} of {{teamSize}} players joined', {
      joinedCount: joinedPlayersAccessibilityMatch[1],
      teamSize: joinedPlayersAccessibilityMatch[2],
    });
  }

  const registrationLocationMatch = /^Your registration: Team (\d+), slot (\d+)\.$/.exec(text);
  if (registrationLocationMatch) {
    return i18n.t('Your registration: Team {{teamNumber}}, slot {{slotNumber}}.', {
      teamNumber: registrationLocationMatch[1],
      slotNumber: registrationLocationMatch[2],
    });
  }

  const roomCredentialMatch = /^(Room ID|Password): (.+)$/.exec(text);
  if (roomCredentialMatch) {
    return i18n.t(
      roomCredentialMatch[1] === 'Room ID' ? 'Room ID: {{value}}' : 'Password: {{value}}',
      { value: roomCredentialMatch[2] },
    );
  }

  const selectedMatch = /^Selected Upcoming match: (.*)\. Match (\d+) of (\d+)\.$/.exec(text);
  if (selectedMatch) {
    return i18n.t('Selected Upcoming match: {{name}}. Match {{index}} of {{total}}.', {
      name: selectedMatch[1],
      index: selectedMatch[2],
      total: selectedMatch[3],
    });
  }

  const ongoingMatch = /^Tournament (.+) is now ongoing\.$/.exec(text);
  if (ongoingMatch) {
    return i18n.t('Tournament {{name}} is now ongoing.', { name: ongoingMatch[1] });
  }

  const participantMatch = /^Participant list updated\. Joined (teams|players): (\d+)\.$/.exec(text);
  if (participantMatch) {
    return i18n.t('Participant list updated. Joined {{group}}: {{count}}.', {
      group: i18n.t(participantMatch[1] === 'teams' ? 'teams' : 'players'),
      count: participantMatch[2],
    });
  }

  const leaderboardUpdate = /^Leaderboard updated\. (.+)\.$/.exec(text);
  if (leaderboardUpdate) {
    const changes = leaderboardUpdate[1].split('; ').map((change) => {
      const player = /^Rank (\d+), (.*), ([\d,]+) coins$/.exec(change);
      if (player) {
        return i18n.t('Rank {{rank}}, {{name}}, {{points}} coins', {
          rank: player[1],
          name: player[2],
          points: player[3],
        });
      }
      const emptyRank = /^Rank (\d+) no longer has a player$/.exec(change);
      if (emptyRank) return i18n.t('Rank {{rank}} no longer has a player', { rank: emptyRank[1] });
      return change;
    });
    return i18n.t('Leaderboard updated. {{changes}}.', { changes: changes.join('; ') });
  }

  if (text.startsWith('Could not load tournaments:')) {
    return `${i18n.t('Could not load tournaments:')} ${text.slice('Could not load tournaments:'.length).trim()}`;
  }

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
