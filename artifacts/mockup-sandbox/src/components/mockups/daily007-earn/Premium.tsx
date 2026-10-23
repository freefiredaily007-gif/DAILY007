import { useState } from "react";
import {
  AlertCircle, Check, Copy, ExternalLink, Gift, Instagram, Link2,
  Send, Share2, Users, Youtube,
} from "lucide-react";

const gold = "#F4C965";
const muted = "#A7A6A1";

function CopyControl({ label }: { label: string }) {
  const [copied, setCopied] = useState(false);
  return <button className="copy-control" aria-label={label} onClick={() => { setCopied(true); window.setTimeout(() => setCopied(false), 1400); }}>{copied ? <Check size={16} /> : <Copy size={16} />}</button>;
}

export function Premium() {
  return (
    <main className="earn-premium">
      <style>{`
        *{box-sizing:border-box}body{margin:0}
        .earn-premium{--bg:#11110F;--surface:#1A1916;--surface2:#211F1A;--line:#38352D;--text:#F3F0E8;--muted:#A7A6A1;--gold:#F4C965;min-height:100dvh;background:radial-gradient(ellipse at 50% -16%,#4C3B1A 0%,#191710 28%,#11110F 65%);color:var(--text);padding:18px 13px 32px;font-family:'DM Sans',sans-serif;font-size:12px;line-height:1.45}
        .earn-premium button,.earn-premium input,.earn-premium textarea{font:inherit}
        .earn-premium .topline{display:flex;align-items:center;justify-content:space-between;margin:0 1px 13px}
        .earn-premium .brand{font-size:9px;font-weight:900;letter-spacing:1.8px;color:#C9C1AE}
        .earn-premium .reward-mark{display:flex;align-items:center;gap:5px;color:var(--gold);font-size:9px;font-weight:900;letter-spacing:.7px}
        .earn-premium h1{font-size:25px;line-height:1;letter-spacing:.4px;margin:0;font-weight:900}
        .earn-premium .subtitle{margin:6px 0 14px;color:var(--muted);font-size:11px}
        .earn-premium .offer{position:relative;overflow:hidden;border-radius:13px;padding:12px 13px;margin-bottom:11px;background:linear-gradient(105deg,#4D3B1B,#292317 65%,#211F1A);border:1px solid #9B793D}
        .earn-premium .offer:after{content:"";position:absolute;right:-25px;top:-44px;width:112px;height:112px;border:1px solid #F4C96528;border-radius:50%;box-shadow:0 0 0 15px #F4C9650A,0 0 0 32px #F4C96508}
        .earn-premium .offer-title{display:flex;align-items:center;gap:8px;color:#FFE4A0;font-size:12px;font-weight:800}
        .earn-premium p{margin:5px 0 0;color:#C6C1B5;font-size:10px;line-height:1.5}
        .earn-premium .card{background:linear-gradient(160deg,#201F1B,#191815);border:1px solid var(--line);border-radius:13px;padding:12px;margin-bottom:10px}
        .earn-premium .card.youtube{border-top:2px solid #F34C4C}
        .earn-premium .card.instagram{border-top:2px solid #C14CBB}
        .earn-premium .title-row{display:flex;align-items:center;gap:8px}
        .earn-premium h2{font-size:13px;line-height:1.3;margin:0;font-weight:800;flex:1}
        .earn-premium .reward{white-space:nowrap;color:var(--gold);font-size:10px;font-weight:900}
        .earn-premium .status{display:flex;align-items:center;gap:7px;margin-top:9px;padding:8px 9px;background:#28251D;border:1px solid #54442A;border-radius:8px;color:#E2C987;font-size:9px;font-weight:900;letter-spacing:.35px}
        .earn-premium .action{background:#292027;border-color:#594052;color:#E2A7D7}
        .earn-premium .btn{display:flex;align-items:center;justify-content:center;gap:7px;min-height:39px;width:100%;margin-top:8px;border-radius:8px;background:transparent;color:var(--text);border:1px solid #51493D;font-size:9px;font-weight:900;letter-spacing:.45px}
        .earn-premium .btn.youtube{background:#4A2020;border-color:#9B3939}
        .earn-premium .btn.instagram{background:#382238;border-color:#805080}
        .earn-premium .btn.claim{background:linear-gradient(105deg,#F6D785,#E4B94C);border:0;color:#201B10}
        .earn-premium .btn.disabled{opacity:.42}
        .earn-premium .hint{text-align:center;margin:6px 1px 0;color:#8F8C84;font-size:9px;line-height:1.45}
        .earn-premium label{display:block;margin:8px 0 4px;font-size:8px;letter-spacing:1px;font-weight:900;color:#C2BBAA}
        .earn-premium input,.earn-premium textarea{display:block;width:100%;border-radius:8px;border:1px solid #403D35;background:#131310;color:var(--text);padding:9px 10px;font-size:10px;outline:none}
        .earn-premium input{height:37px}.earn-premium textarea{height:52px;resize:vertical}
        .earn-premium .referral{border-color:#625232;background:linear-gradient(160deg,#211F1A,#191815)}
        .earn-premium .section-label{font-size:8px;color:#D6B866;font-weight:900;letter-spacing:1.05px}
        .earn-premium .row{display:flex;align-items:center;gap:5px;margin-top:6px}
        .earn-premium .code{height:39px;flex:1;display:flex;align-items:center;justify-content:center;background:#14130F;border:1px solid #4B4435;border-radius:8px;color:var(--gold);font-size:14px;font-weight:900;letter-spacing:2px}
        .earn-premium .link{min-height:39px;flex:1;min-width:0;display:flex;align-items:center;gap:6px;background:#14130F;border:1px solid #403D35;border-radius:8px;padding:7px 8px;color:#B8C7DA;font-size:9px;overflow-wrap:anywhere}
        .earn-premium .copy-control{height:37px;width:38px;display:grid;place-items:center;background:#28251D;border:1px solid #514832;border-radius:8px;color:var(--gold)}
        .earn-premium .share{margin-top:9px}
        .earn-premium .data-note{font-size:8px;color:#89857A;margin:6px 0 0}
        .earn-premium .stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin:0 0 14px}
        .earn-premium .stat{background:#1A1916;border:1px solid #38352D;border-radius:9px;padding:9px 10px;min-height:60px}
        .earn-premium .stat b{display:block;font-size:18px;line-height:1.1;color:var(--gold)}
        .earn-premium .stat span{display:block;margin-top:5px;font-size:8px;line-height:1.2;letter-spacing:.55px;font-weight:900;color:#AAA69B}
        .earn-premium .ref-head{display:flex;justify-content:space-between;align-items:center;margin:0 1px 7px}
        .earn-premium .ref-head h3{font-size:9px;color:#C8C2B4;margin:0;letter-spacing:1px}
        .earn-premium .ref-head span{font-size:9px;color:#858176}
        .earn-premium .empty{display:flex;gap:10px;align-items:center;padding:12px;background:#191815;border:1px dashed #4A463C;border-radius:10px}
        .earn-premium .empty-icon{width:34px;height:34px;flex:none;border-radius:9px;background:#28251D;color:#B8A46D;display:grid;place-items:center}
        .earn-premium .empty strong{font-size:11px}
        .earn-premium .empty p{font-size:9px;margin-top:3px}
      `}</style>
      <div className="topline"><span className="brand">DAILY007 / REWARDS</span><span className="reward-mark"><Gift size={13} /> COIN VAULT</span></div>
      <h1>Earn coins</h1>
      <p className="subtitle">Bring your squad. Earn together.</p>

      <section className="offer">
        <div className="offer-title"><Gift size={16} color={gold} /> 10 coins for your friend at signup</div>
        <p>You earn 5 coins once their recharge of at least 50 coins is approved by an administrator.</p>
      </section>

      <section className="card youtube">
        <div className="title-row"><Youtube size={19} color="#F34C4C" /><h2>Subscribe to YouTube</h2><span className="reward">+5 COINS</span></div>
        <p>Subscribe to the Daily007 channel, then submit your claim. An administrator will verify it before crediting your wallet.</p>
        <button className="btn youtube"><ExternalLink size={14} /> SUBSCRIBE ON YOUTUBE</button>
        <button className="btn claim disabled" disabled><Send size={13} /> I SUBSCRIBED · SUBMIT FOR REVIEW</button>
        <div className="hint">Subscribe on YouTube, then return to Daily007 to submit for review.</div>
      </section>

      <section className="card instagram">
        <div className="title-row"><Instagram size={18} color="#C14CBB" /><h2>Follow on Instagram</h2><span className="reward">+3 COINS</span></div>
        <p>Follow the official Daily007 Instagram account and submit your username for admin verification before coins are credited.</p>
        <div className="status action"><AlertCircle size={14} /> ACTION REQUIRED · FOLLOW AND SUBMIT CLAIM</div>
        <button className="btn instagram"><ExternalLink size={13} /> FOLLOW ON INSTAGRAM</button>
        <label>INSTAGRAM USERNAME</label><input placeholder="Enter your Instagram username" />
        <label>PROOF / NOTE (OPTIONAL)</label><textarea placeholder="Add a verification note or proof link (optional)" />
        <button className="btn claim disabled" disabled><Send size={13} /> SUBMIT FOLLOW CLAIM FOR REVIEW</button>
        <div className="hint">Follow the account, return to Daily007, then submit your Instagram username for review.</div>
      </section>

      <section className="card referral">
        <div className="section-label">YOUR 5-LETTER REFERRAL CODE</div>
        <div className="row"><div className="code">Your code</div><CopyControl label="Copy referral code" /></div>
        <div className="section-label" style={{ marginTop: 10 }}>CLICKABLE INVITE LINK</div>
        <div className="row"><div className="link"><Link2 size={13} /> Your invite link</div><CopyControl label="Copy referral link" /></div>
        <button className="btn claim share"><Share2 size={14} /> SHARE INVITE LINK</button>
        <div className="data-note">Account-specific code and link load from your referral dashboard.</div>
      </section>

      <section className="stats">
        {["PEOPLE INVITED", "SUCCESSFUL", "PENDING", "COINS EARNED"].map((label) => <div className="stat" key={label}><b>—</b><span>{label}</span></div>)}
      </section>
      <div className="ref-head"><h3>MY REFERRALS</h3><span>— invited</span></div>
      <section className="empty">
        <div className="empty-icon"><Users size={18} /></div>
        <div><strong>No referrals yet</strong><p>Share your code or invite link. New players get 10 coins when they sign up with it.</p></div>
      </section>
    </main>
  );
}
