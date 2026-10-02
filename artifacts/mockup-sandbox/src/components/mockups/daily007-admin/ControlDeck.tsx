import './_group.css';
import { Activity, AlertCircle, Award, BarChart3, Bell, CalendarDays, CheckCircle2, ChevronRight, Clock3, CreditCard, Crosshair, Database, DollarSign, FileText, Flag, Gift, KeyRound, LayoutDashboard, LogOut, RefreshCw, Settings2, Shield, Target, TrendingUp, Users, Youtube } from 'lucide-react';

const logo = `${import.meta.env.BASE_URL}images/daily007-logo.jpg`;

const stats = [
  { icon: Users, value: '1,284', label: 'Total Users', tint: '#4da3ff' },
  { icon: Award, value: '3', label: 'Active Tournaments', tint: '#ffb020' },
  { icon: Clock3, value: '7', label: 'Pending Regs', tint: '#ff7a1a' },
  { icon: CheckCircle2, value: '23', label: 'Approved Regs', tint: '#2ecc71' },
  { icon: AlertCircle, value: '2', label: 'Rejected Regs', tint: '#ff5c5c' },
  { icon: CreditCard, value: '4', label: 'Pending Payments', tint: '#ff4b36' },
  { icon: Flag, value: '18', label: 'Completed', tint: '#4da3ff' },
  { icon: DollarSign, value: '42,890', label: 'Coins Distributed', tint: '#ffb020' },
  { icon: Database, value: '1,954,600', label: 'Coins in Wallets', tint: '#ffb020' },
  { icon: Gift, value: '₹82,500', label: 'Prize Distributed', tint: '#2ecc71' },
  { icon: CalendarDays, value: '12', label: "Today's Regs", tint: '#4da3ff' },
  { icon: TrendingUp, value: '₹9,420', label: "Today's Revenue", tint: '#2ecc71' },
];

const nav = [
  [LayoutDashboard, 'Dashboard'], [Award, 'Tournaments'], [FileText, 'Regs'], [CreditCard, 'Payments'],
  [Database, 'Wallet'], [Youtube, 'Earn'], [KeyRound, 'Rooms'], [Target, 'Results'], [Users, 'Users'],
  [Bell, 'Notify'], [Settings2, 'Settings'],
] as const;

export function ControlDeck() {
  return (
    <div className="admin-preview admin-preview--refresh">
      <header className="admin-preview__header">
        <div className="admin-preview__logo"><img src={logo} alt="Daily007 logo" /></div>
        <div className="admin-preview__brand">
          <div className="admin-preview__eyebrow">FREE FIRE / ADMIN OPS</div>
          <div className="admin-preview__brand-title">DAILY<span style={{ color: '#ff7a1a' }}>007</span></div>
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
        <div className="admin-preview__live"><span className="admin-preview__live-dot" />LIVE</div>
        <button className="admin-preview__logout"><LogOut size={12} />LOGOUT</button>
      </div>
      <main className="admin-preview__main">
        <section className="admin-preview__hero">
          <div>
            <div className="admin-preview__hero-kicker">DAILY007 / LIVE OPERATIONS</div>
            <div className="admin-preview__hero-title">COMMAND CENTER</div>
            <div className="admin-preview__hero-sub">Tournament management at a glance</div>
          </div>
          <div className="admin-preview__hero-mark"><Crosshair size={22} /></div>
        </section>
        <div className="admin-preview__section-title"><AlertCircle size={14} /> PENDING ACTIONS</div>
        <div className="admin-preview__alerts">
          <div className="admin-preview__alert">
            <span className="admin-preview__alert-icon"><FileText size={15} /></span>
            <span className="admin-preview__alert-copy">7 registrations waiting for approval</span><ChevronRight className="admin-preview__alert-arrow" size={15} />
          </div>
          <div className="admin-preview__alert">
            <span className="admin-preview__alert-icon"><CreditCard size={15} /></span>
            <span className="admin-preview__alert-copy">4 payments waiting for approval</span><ChevronRight className="admin-preview__alert-arrow" size={15} />
          </div>
          <div className="admin-preview__alert">
            <span className="admin-preview__alert-icon"><KeyRound size={15} /></span>
            <span className="admin-preview__alert-copy">2 tournaments need room details</span><ChevronRight className="admin-preview__alert-arrow" size={15} />
          </div>
        </div>
        <div className="admin-preview__section-title"><BarChart3 size={14} /> OVERVIEW</div>
        <div className="admin-preview__stats">
          {stats.map(({ icon: Icon, value, label, tint }) => (
            <div className="admin-preview__stat" key={label}>
              <div className="admin-preview__stat-icon" style={{ color: tint }}><Icon size={14} /></div>
              <div className="admin-preview__stat-value">{value}</div>
              <div className="admin-preview__stat-label">{label}</div>
            </div>
          ))}
        </div>
        <div className="admin-preview__section-title" style={{ marginTop: 17 }}><Activity size={14} /> QUICK ACTIONS</div>
        <div className="admin-preview__quick-actions">
          {[
            [Crosshair, 'Create Tournament'], [FileText, 'Manage Registrations'],
            [CreditCard, 'Approve Payments'], [KeyRound, 'Publish Room'],
          ].map(([Icon, label]) => (
            <div className="admin-preview__quick-action" key={label as string}>
              <Icon size={15} /><span>{label as string}</span>
            </div>
          ))}
        </div>
      </main>
      <nav className="admin-preview__nav">
        {nav.map(([Icon, label], i) => (
          <div className={`admin-preview__nav-item${i === 0 ? ' admin-preview__nav-item--active' : ''}`} key={label}>
            <Icon size={15} /><span>{label}</span>
          </div>
        ))}
      </nav>
    </div>
  );
}