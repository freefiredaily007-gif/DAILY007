export type AdminTournamentFormat = 'Solo' | 'Duo' | 'Trio' | 'Squad';

export function getAdminTournamentFormatOptions(mode: string) {
  if (mode === 'Battle Royale') {
    return [
      { value: 'Solo' as const, label: 'Solo' },
      { value: 'Duo' as const, label: 'Duo' },
      { value: 'Squad' as const, label: 'Squad' },
    ];
  }

  return [
    { value: 'Solo' as const, label: '1 VS 1' },
    { value: 'Duo' as const, label: '2 VS 2' },
    { value: 'Trio' as const, label: '3 VS 3' },
    { value: 'Squad' as const, label: '4 VS 4' },
  ];
}

export function getAdminTournamentTitle(mode: string, format: string): string {
  const options = getAdminTournamentFormatOptions(mode);
  const label = options.find((option) => option.value === format)?.label ?? options[0].label;
  return `${mode} ${label}`;
}

export function getAdminTournamentCapacity(mode: string, format: string) {
  const playerCountByFormat: Record<AdminTournamentFormat, number> = {
    Solo: 1,
    Duo: 2,
    Trio: 3,
    Squad: 4,
  };
  const selectedFormat: AdminTournamentFormat =
    format === 'Duo' || format === 'Trio' || format === 'Squad' ? format : 'Solo';
  const playersPerTeam = playerCountByFormat[selectedFormat];

  if (mode === 'Battle Royale') {
    if (selectedFormat === 'Solo') return { slots: 48, label: '48 player slots' };
    const teamCount = selectedFormat === 'Duo' ? 24 : 12;
    return {
      slots: teamCount,
      label: `${teamCount} team slots · 48 players`,
    };
  }

  if (selectedFormat === 'Solo') return { slots: 2, label: '2 player slots' };
  return {
    slots: 2,
    label: `2 team slots · ${playersPerTeam * 2} players`,
  };
}
