export const MY_MATCHES_TEXT_SCALE_RESULTS = Array.from({ length: 10 }, (_, index) => {
  const rank = index + 1;
  return {
    rank,
    gameName: `International Free Fire Champion With A Name That Wraps Across The Result Card ${rank}`,
    teamName: `Blue Phoenix Squad With A Long Tournament Team Name ${rank}`,
    kills: 18 - index,
    prizeCoins: 1_000_000 - index * 137,
  };
});

export const MY_MATCHES_TEXT_SCALE_REGISTRATIONS = [{
  id: 'native-large-text-fixture',
  status: 'rejected',
  tournament: {
    id: 'native-large-text-tournament',
    name: 'Large Text Result Fixture',
    mode: 'battle royale',
    teamType: 'squad',
    status: 'completed',
    startsAt: '2024-01-01T10:00:00.000Z',
    results: MY_MATCHES_TEXT_SCALE_RESULTS,
  },
}];
