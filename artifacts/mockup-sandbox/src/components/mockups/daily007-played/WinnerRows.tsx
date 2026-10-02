import './_group.css';

const results = [
  {
    rank: 1,
    gameName: 'NITIN THAKUR',
    playerName: 'Ashu Thkre',
    kills: 5,
    prizeCoins: 45,
    avatarTone: 'coral',
  },
  {
    rank: 2,
    gameName: 'JH MANISH',
    playerName: 'MANISH KUMAR',
    kills: 2,
    prizeCoins: 0,
    avatarTone: 'brown',
  },
];

function medalClass(rank: number) {
  if (rank === 1) return 'd7-rank-medal--gold';
  if (rank === 2) return 'd7-rank-medal--silver';
  if (rank === 3) return 'd7-rank-medal--bronze';
  return '';
}

export function WinnerRows() {
  return (
    <main className="d7-played-frame">
      <section className="d7-results-panel">
        <h2 className="d7-results-title">TOURNAMENT RESULTS</h2>
        {results.map((entry) => (
          <article className="d7-winner-row" key={entry.rank}>
            <div className={`d7-rank-medal ${medalClass(entry.rank)}`}>{entry.rank}</div>
            <div className={`d7-avatar d7-avatar--${entry.avatarTone}`}>
              {entry.playerName.charAt(0).toUpperCase()}
            </div>
            <div className="d7-winner-identity">
              <div className="d7-winner-name">{entry.gameName}</div>
              <div className="d7-profile-name">{entry.playerName}</div>
              <div className="d7-kills">{entry.kills} KILLS</div>
            </div>
            <div className="d7-prize">
              <div className="d7-prize-amount">
                <span className="d7-coin">★</span>
                {entry.prizeCoins}
              </div>
              <div className="d7-prize-label">Prize Won</div>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}