import './_group.css';

const modes = [
  {
    image: '/__mockup/images/daily007/banner-solo.jpg',
    title: 'BATTLE ROYALE SOLO',
    type: 'BATTLE ROYALE · SOLO',
    tag: '1 Player · All alone · Survive & win',
    button: 'PLAY SOLO',
    accent: '#ffb020',
  },
  {
    image: '/__mockup/images/daily007/banner-squad.jpg',
    title: 'BATTLE ROYALE SQUAD',
    type: 'BATTLE ROYALE · SQUAD',
    tag: '4 Players · Team up · Play together',
    button: 'REGISTER NOW',
    accent: '#ff3d3d',
  },
  {
    image: '/__mockup/images/daily007/banner-clash.jpg',
    title: 'CLASH SQUAD',
    type: 'CLASH SQUAD',
    tag: '4 Players · Skill based · Fast match',
    button: 'REGISTER NOW',
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
              <span className="d7-mode-art-shade" />
              <span className="d7-mode-index">{String(index + 1).padStart(2, '0')}</span>
            </div>
            <div className="d7-mode-info">
              <span className="d7-mode-kicker">{mode.type}</span>
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