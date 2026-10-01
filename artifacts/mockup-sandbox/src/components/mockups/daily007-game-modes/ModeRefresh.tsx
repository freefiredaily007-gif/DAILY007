import './_group.css';

const modes = [
  {
    image: '/__mockup/images/daily007/mode-solo-logo.jpg',
    title: '🔥 BATTLE ROYALE SOLO',
    capacity: '48 PLAYER SLOTS',
    tag: 'Solo tournament',
    button: 'VIEW TOURNAMENTS',
    accent: '#ffb020',
  },
  {
    image: '/__mockup/images/daily007/mode-squad-logo.jpg',
    title: '⚔️ BATTLE ROYALE SQUAD',
    capacity: '12 TEAMS × 4 PLAYERS',
    tag: 'Squad tournament',
    button: 'VIEW TOURNAMENTS',
    accent: '#ff3d3d',
  },
  {
    image: '/__mockup/images/daily007/mode-clash-logo.jpg',
    title: '💥 CLASH SQUAD',
    capacity: '4V4',
    tag: 'Team tournament',
    button: 'VIEW TOURNAMENTS',
    accent: '#a05cff',
  },
];

export function ModeRefresh() {
  return (
    <main className="d7-modes-frame d7-refresh-frame">
      <header className="d7-refresh-intro">
        <div className="d7-refresh-kicker">
          <span className="d7-refresh-kicker-mark" />
          PICK YOUR BATTLE
        </div>
        <h1 className="d7-refresh-title">GAME MODES</h1>
        <p className="d7-refresh-copy">Choose a mode to find its next open tournament.</p>
      </header>
      <div className="d7-mode-list">
        {modes.map((mode, index) => (
          <article
            className="d7-mode-choice"
            key={mode.title}
            style={{ '--mode-accent': mode.accent } as React.CSSProperties}
          >
            <div className="d7-mode-art">
              <img className="d7-mode-art-image" src={mode.image} alt="" />
            </div>
            <div className="d7-mode-info">
              <span className="d7-mode-kicker">{mode.capacity}</span>
              <h2 className="d7-mode-title">{mode.title}</h2>
              <p className="d7-mode-description">{mode.tag}</p>
              <button className="d7-mode-cta" type="button">
                <span>{mode.button}</span>
                <span className="d7-mode-cta-arrow" aria-hidden="true">›</span>
              </button>
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}