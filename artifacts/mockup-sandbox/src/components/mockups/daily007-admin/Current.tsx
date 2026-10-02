import './_group.css';
import { Activity, BarChart3, ChevronRight, LogOut, RefreshCw, Shield } from 'lucide-react';

const logo = `${import.meta.env.BASE_URL}images/daily007-logo.jpg`;

const stats = [
  { icon: '👥', value: '1,284', label: 'Total Users' },
  { icon: '🏆', value: '3', label: 'Active Tournaments' },
  { icon: '⏳', value: '7', label: 'Pending Regs' },
  { icon: '✅', value: '23', label: 'Approved Regs' },
  { icon: '❌', value: '2', label: 'Rejected Regs' },
  { icon: '💳', value: '4', label: 'Pending Payments' },
  { icon: '🏁', value: '18', label: 'Completed' },
  { icon: '🪙', value: '42,890', label: 'Coins Distributed' },
  { icon: '👛', value: '1,954,600', label: 'Coins in Wallets' },
  { icon: '🎁', value: '₹82,500', label: 'Prize Distributed' },
  { icon: '📅', value: '12', label: "Today's Regs" },
  { icon: '💰', value: '₹9,420', label: "Today's Revenue" },
];

const nav = [
  ['📊', 'Dashboard'], ['🏆', 'Tournaments'], ['📝', 'Regs'], ['💳', 'Payments'], ['🪙', 'Wallet'],
  ['YT', 'Earn'], ['🚪', 'Rooms'], ['🥇', 'Results'], ['👥', 'Users'], ['🔔', 'Notify'], ['⚙️', 'Settings'],
];

export function Current() {
  return (
    <div className="admin-preview admin-preview--current">
      <header className="admin-preview__header">
        <img className="admin-preview__logo" src={logo} alt="Daily007 logo" />
        <div className="admin-preview__brand">
          <div className="admin-preview__brand-title">FREEFIRE <em>DAILY007</em></div>
          <div className="admin-preview__subtitle">ADMIN DASHBOARD</div>
        </div>
        <button className="admin-preview__icon-button" aria-label="Refresh"><RefreshCw size={15} /></button>
        <button className="admin-preview__icon-button" aria-label="Log out"><LogOut size={15} /></button>
      </header>
      <div className="admin-preview__identity">
        <div className="admin-preview__shield"><Shield size={14} /></div>
        <div className="admin-preview__account">
          <div className="admin-preview__account-name">Admin</div>
          <div className="admin-preview__email">admin@daily007.app</div>
        </div>
        <div className="admin-preview__live">● LIVE</div>
        <button className="admin-preview__logout"><LogOut size={12} />LOGOUT</button>
      </div>
      <main className="admin-preview__main">
        <div className="admin-preview__section-title">⚡ PENDING ACTIONS</div>
        <div className="admin-preview__alerts">
          <div className="admin-preview__alert"><span>📝</span><span className="admin-preview__alert-copy">7 registrations waiting for approval</span><ChevronRight size={15} /></div>
          <div className="admin-preview__alert"><span>💳</span><span className="admin-preview__alert-copy">4 payments waiting for approval</span><ChevronRight size={15} /></div>
          <div className="admin-preview__alert"><span>🚪</span><span className="admin-preview__alert-copy">2 tournaments need room details</span><ChevronRight size={15} /></div>
        </div>
        <div className="admin-preview__section-title"><BarChart3 size={14} /> OVERVIEW</div>
        <div className="admin-preview__stats">
          {stats.map((stat) => (
            <div className="admin-preview__stat" key={stat.label}>
              <div className="admin-preview__stat-icon">{stat.icon}</div>
              <div className="admin-preview__stat-value">{stat.value}</div>
              <div className="admin-preview__stat-label">{stat.label}</div>
            </div>
          ))}
        </div>
        <div className="admin-preview__section-title" style={{ marginTop: 17 }}><Activity size={14} /> QUICK ACTIONS</div>
        <div className="admin-preview__quick-actions">
          {['Create Tournament', 'Manage Registrations', 'Approve Payments', 'Publish Room'].map((item) => (
            <div className="admin-preview__quick-action" key={item}><ChevronRight size={14} />{item}</div>
          ))}
        </div>
      </main>
      <nav className="admin-preview__nav">
        {nav.map(([icon, label], i) => (
          <div className={`admin-preview__nav-item${i === 0 ? ' admin-preview__nav-item--active' : ''}`} key={label}>
            <span>{icon}</span><span>{label}</span>
          </div>
        ))}
      </nav>
    </div>
  );
}