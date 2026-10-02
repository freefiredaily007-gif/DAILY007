import './_group.css';

const results = [
  { rank: 1, gameName: 'NITIN THAKUR', kills: 5, prizeCoins: 45 },
  { rank: 2, gameName: 'JH MANISH', kills: 2, prizeCoins: 0 },
];

export function Current() {
  return (
    <main className="d7-played-frame">
      <section className="d7-results-panel">
        <h2 className="d7-results-title">TOURNAMENT RESULTS</h2>
        {results.map((entry) => (
          <p className="d7-current-result" key={entry.rank}>
            #{entry.rank} · {entry.gameName} · {entry.kills} kills · {entry.prizeCoins} coins
          </p>
        ))}
      </section>
    </main>
  );
}