import './_group.css';

const modes = [
  {
    image: '/__mockup/images/daily007/banner-solo.jpg',
    title: 'BATTLE ROYALE SOLO',
    tag: '1 Player | All Alone | Survive & Win',
    button: 'PLAY SOLO',
    accent: '#ffb020',
  },
  {
    image: '/__mockup/images/daily007/banner-squad.jpg',
    title: 'BATTLE ROYALE SQUAD',
    tag: '4 Players | Team Up | Play Together',
    button: 'REGISTER NOW',
    accent: '#ff3d3d',
  },
  {
    image: '/__mockup/images/daily007/banner-clash.jpg',
    title: 'CLASH SQUAD',
    tag: '4 Players | Skill Based | Fast Match',
    button: 'REGISTER NOW',
    accent: '#a05cff',
  },
];

export function Current() {
  return (
    <main className="d7-modes-frame">
      <div className="d7-section-title">
        <span className="d7-section-accent" />
        GAME MODES
      </div>
      {modes.map((mode) => (
        <article
          className="d7-current-card"
          key={mode.title}
          style={{ '--mode-accent': mode.accent } as React.CSSProperties}
        >
          <img className="d7-current-image" src={mode.image} alt="" />
          <div className="d7-current-body">
            <h2 className="d7-current-title">{mode.title}</h2>
            <p className="d7-current-copy">{mode.tag}</p>
            <button className="d7-current-cta" type="button">{mode.button} ›</button>
          </div>
        </article>
      ))}
    </main>
  );
}