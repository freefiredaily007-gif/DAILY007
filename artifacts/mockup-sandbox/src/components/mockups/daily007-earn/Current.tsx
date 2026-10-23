import { useState, type ReactNode } from "react";
import {
  AlertCircle, Check, CheckCircle2, Clock3, Copy, ExternalLink, Gift,
  Instagram, Link2, Send, Share2, Users, Youtube,
} from "lucide-react";

const C = {
  bg: "#070A18", bg2: "#0B1230", card: "#0D1631", card2: "#142043",
  border: "#263765", gold: "#FFD34F", green: "#43D7A4", red: "#FF7187",
  purple: "#A77BFF", text: "#F4F7FF", sub: "#AAB6D5", dim: "#7280A5",
};

function IconButton({ children, label }: { children: ReactNode; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button onClick={() => { setDone(true); window.setTimeout(() => setDone(false), 1500); }}
      aria-label={label} className="icon-button">
      {done ? <Check size={17} /> : children}
    </button>
  );
}

export function Current() {
  return (
    <main className="earn-current">
      <style>{`
        *{box-sizing:border-box} body{margin:0}
        .earn-current{min-height:100dvh;background:${C.bg};color:${C.text};padding:22px 14px 34px;font-family:'DM Sans',sans-serif;font-size:12px;line-height:1.45}
        .earn-current button,.earn-current input,.earn-current textarea{font:inherit}
        .earn-current .eyebrow{font-size:9px;color:${C.dim};letter-spacing:1.8px;font-weight:800}
        .earn-current h1{font-size:22px;line-height:1.1;letter-spacing:1px;margin:5px 0 3px;font-weight:900}
        .earn-current .subtitle{color:${C.sub};margin:0 0 15px;font-size:12px}
        .earn-current .panel{background:${C.card};border:1px solid ${C.border};border-radius:15px;padding:13px;margin-bottom:12px}
        .earn-current .offer{background:${C.card2};padding:13px;border-radius:14px;border:1px solid ${C.border};margin-bottom:14px}
        .earn-current .offer-head,.earn-current .heading,.earn-current .row,.earn-current .task-status,.earn-current .field-row{display:flex;align-items:center;gap:9px}
        .earn-current .offer-title{color:${C.gold};font-weight:800;font-size:13px}
        .earn-current p{color:${C.sub};margin:7px 0 0;font-size:11px;line-height:1.55}
        .earn-current .heading{margin-bottom:7px}
        .earn-current .heading h2{font-size:14px;line-height:1.25;margin:0;font-weight:900;flex:1}
        .earn-current .youtube{border-color:#FF718766}.earn-current .instagram{border-color:#A77BFF66}
        .earn-current .status{display:flex;align-items:flex-start;gap:8px;padding:10px;background:${C.bg2};border:1px solid ${C.border};border-radius:10px;margin:8px 0}
        .earn-current .status-title{font-size:9px;letter-spacing:.55px;font-weight:900;color:${C.green}}
        .earn-current .status-copy{color:${C.sub};font-size:10px;margin-top:3px;line-height:1.5}
        .earn-current .status.action{border-color:#A77BFF66}.earn-current .status.action .status-title{color:${C.purple}}
        .earn-current .btn{height:42px;width:100%;border-radius:10px;border:1px solid;display:flex;align-items:center;justify-content:center;gap:8px;font-weight:900;font-size:10px;letter-spacing:.35px;color:${C.text};background:transparent;margin-top:8px}
        .earn-current .btn.youtube{border-color:#FF718788;background:#FF718722}
        .earn-current .btn.instagram{border-color:#A77BFF88;background:#A77BFF22}
        .earn-current .btn.gold{background:${C.gold};color:${C.bg};border-color:${C.gold}}
        .earn-current .btn.disabled{opacity:.45}
        .earn-current .hint{text-align:center;color:${C.dim};font-size:9px;line-height:1.5;margin-top:7px}
        .earn-current label{display:block;color:${C.sub};font-size:9px;letter-spacing:.8px;font-weight:900;margin:9px 0 4px}
        .earn-current input,.earn-current textarea{width:100%;background:${C.bg2};color:${C.text};border:1px solid ${C.border};border-radius:9px;padding:10px 11px;outline:none;font-size:11px}
        .earn-current input{height:40px}.earn-current textarea{height:58px;resize:vertical}
        .earn-current .section-label{color:${C.gold};font-size:9px;font-weight:900;letter-spacing:1.25px}
        .earn-current .code{font-size:17px;letter-spacing:1.5px;font-weight:900;color:${C.gold};text-align:center;background:${C.bg2};border:1px solid ${C.border};border-radius:9px;padding:9px;flex:1}
        .earn-current .icon-button{height:40px;width:40px;border:0;background:transparent;color:${C.gold};display:grid;place-items:center;cursor:pointer}
        .earn-current .link-box{min-height:44px;display:flex;align-items:center;gap:6px;flex:1;min-width:0;background:${C.bg2};border:1px solid ${C.border};border-radius:9px;padding:8px;color:#6EBBFF;font-size:10px;overflow-wrap:anywhere}
        .earn-current .share{margin-top:10px}
        .earn-current .data-note{font-size:9px;color:${C.dim};margin-top:7px}
        .earn-current .stats{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:0 0 16px}
        .earn-current .stat{background:${C.card};border:1px solid ${C.border};border-radius:11px;padding:10px;min-height:63px}
        .earn-current .stat strong{font-size:19px;line-height:1;font-weight:900;color:${C.text}}
        .earn-current .stat span{display:block;color:${C.sub};font-size:8px;font-weight:900;letter-spacing:.8px;margin-top:6px}
        .earn-current .section-head{font-size:10px;color:${C.sub};letter-spacing:1px;font-weight:900;margin:16px 0 8px}
        .earn-current .empty{text-align:center;padding:17px}
        .earn-current .empty-icon{width:38px;height:38px;display:grid;place-items:center;margin:auto;border:1px solid ${C.border};border-radius:12px;color:${C.dim}}
        .earn-current .empty strong{display:block;margin-top:8px;font-size:12px}
        .earn-current .empty p{font-size:10px;margin-top:4px}
      `}</style>
      <div className="eyebrow">DAILY007 · REWARDS</div>
      <h1>EARN COINS</h1>
      <p className="subtitle">Invite friends and track referral rewards</p>

      <section className="offer">
        <div className="offer-head"><Gift size={17} color={C.gold} /><span className="offer-title">10 coins for your friend at signup</span></div>
        <p>You earn 5 coins once their recharge of at least 50 coins is approved by an administrator.</p>
      </section>

      <section className="panel youtube">
        <div className="heading"><Youtube size={20} color={C.red} /><h2>Subscribe to YouTube &amp; Earn 5 Coins</h2></div>
        <p>Subscribe to the Daily007 channel, then submit your claim. An administrator will verify it before crediting your wallet.</p>
        <button className="btn youtube"><ExternalLink size={14} /> SUBSCRIBE ON YOUTUBE</button>
        <button className="btn gold disabled" disabled><Send size={14} /> I SUBSCRIBED · SUBMIT FOR REVIEW</button>
        <div className="hint">Subscribe on YouTube, then return to Daily007 to submit for review.</div>
      </section>

      <section className="panel instagram">
        <div className="heading"><Instagram size={19} color={C.purple} /><h2>Follow on Instagram &amp; Earn 3 Coins</h2></div>
        <p>Follow the official Daily007 Instagram account and submit your username for admin verification before coins are credited.</p>
        <div className="status action"><AlertCircle size={15} color={C.purple} /><div className="status-title">ACTION REQUIRED · FOLLOW AND SUBMIT CLAIM</div></div>
        <button className="btn instagram"><ExternalLink size={14} /> FOLLOW ON INSTAGRAM</button>
        <label>INSTAGRAM USERNAME</label>
        <input placeholder="Enter your Instagram username" />
        <label>PROOF / NOTE (OPTIONAL)</label>
        <textarea placeholder="Add a verification note or proof link (optional)" />
        <button className="btn gold disabled" disabled><Send size={14} /> SUBMIT FOLLOW CLAIM FOR REVIEW</button>
        <div className="hint">Follow the account, return to Daily007, then submit your Instagram username for review.</div>
      </section>

      <section className="panel">
        <div className="section-label">YOUR 5-LETTER REFERRAL CODE</div>
        <div className="row" style={{ marginTop: 8 }}><div className="code">Your code</div><IconButton label="Copy referral code"><Copy size={17} /></IconButton></div>
        <div className="section-label" style={{ marginTop: 12 }}>CLICKABLE INVITE LINK</div>
        <div className="row" style={{ marginTop: 7 }}><div className="link-box"><Link2 size={14} /> Your invite link</div><IconButton label="Copy referral link"><Copy size={17} /></IconButton></div>
        <button className="btn gold share"><Share2 size={15} /> SHARE INVITE LINK</button>
        <div className="data-note">Account-specific code and link load from your referral dashboard.</div>
      </section>

      <section className="stats">
        {["PEOPLE INVITED", "SUCCESSFUL", "PENDING", "COINS EARNED"].map((label) => <div className="stat" key={label}><strong>—</strong><span>{label}</span></div>)}
      </section>
      <div className="section-head">MY REFERRALS (—)</div>
      <section className="panel empty">
        <div className="empty-icon"><Users size={20} /></div>
        <strong>No referrals yet</strong>
        <p>Share your code or invite link. New players get 10 coins when they sign up with it.</p>
      </section>
    </main>
  );
}
