"use client";

import { useState } from "react";
import type { Profile, SocialAccount } from "./types";

const connectionOptions = [
  ["instagram", "Instagram"], ["facebook", "Facebook"], ["twitter", "X"], ["linkedin", "LinkedIn"],
  ["tiktok", "TikTok"], ["youtube", "YouTube"], ["pinterest", "Pinterest"], ["threads", "Threads"],
  ["reddit", "Reddit"], ["googlebusiness", "Google Business"], ["snapchat", "Snapchat"], ["whatsapp", "WhatsApp"],
  ["discord", "Discord"], ["slack", "Slack"],
];

export function AccountsPanel({ profiles, accounts, profileId, busy, message, canManage, onProfileSelect, onConnect, onRefresh }: {
  profiles: Profile[];
  accounts: SocialAccount[];
  profileId: string;
  busy: boolean;
  message: string;
  canManage: boolean;
  onProfileSelect: (id: string) => void;
  onConnect: (platform: string) => void;
  onRefresh: () => void;
}) {
  const [platform, setPlatform] = useState("instagram");
  return <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
    <section className="panel-card">
      <div className="mb-2 flex items-center justify-between gap-3"><h2 className="section-title">حساب‌های این پروفایل</h2><button className="button-quiet" disabled={busy} onClick={onRefresh}>{busy ? "در حال دریافت…" : "تازه‌سازی"}</button></div>
      {message && <p role="status" className="analytics-note">{message}</p>}
      {accounts.length ? <ul className="plain-list">{accounts.map((account) => {
        const id = account._id || account.id || `${account.platform}-${account.username}`;
        return <li key={id} className="list-row account-row">
          <span className={`platform-mark platform-${account.platform || "other"}`} aria-hidden="true">{(account.platform || "?").slice(0, 1).toUpperCase()}</span>
          <div className="min-w-0 flex-1"><strong dir={account.username ? "ltr" : undefined}>{account.username ? `@${account.username}` : account.displayName || account.platform}</strong><div className="account-id">{account.displayName && account.username ? `${account.displayName} · ` : ""}{account.platform}</div></div>
          <span className={`badge ${account.isActive === false ? "badge-off" : ""}`}>{account.isActive === false ? "غیرفعال" : "فعال"}</span>
        </li>;
      })}</ul> : <p className="empty-note">{busy ? "در حال دریافت…" : canManage ? "هنوز حسابی به این پروفایل وصل نشده. از فرم کناری شروع کن." : "حسابی به کاربری تو اختصاص داده نشده."}</p>}
    </section>

    {canManage && <div className="grid gap-6">
      <section className="panel-card">
        <h2 className="section-title">وصل کردن حساب تازه</h2>
        <p className="muted mt-1">بعد از زدن دکمه، صفحهٔ رسمی همان شبکه باز می‌شود تا اجازهٔ دسترسی بدهی و بعد به همین‌جا برمی‌گردی.</p>
        <div className="mt-4 flex gap-2"><select className="field flex-1" aria-label="شبکهٔ اجتماعی" value={platform} onChange={(event) => setPlatform(event.target.value)}>{connectionOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button className="button-primary" disabled={!profileId || busy} onClick={() => onConnect(platform)}>وصل کن</button></div>
      </section>
      {profiles.length > 0 && <section className="panel-card">
        <h2 className="section-title">پروفایل‌های Zernio</h2>
        <p className="muted mt-1 mb-4">هر پروفایل یک گروه جدا از حساب‌هاست؛ مثلاً یکی برای هر برند.</p>
        <div className="grid gap-2">{profiles.map((profile) => { const id = profile._id || profile.id || ""; return <label key={id} className={`profile-option ${profileId === id ? "profile-option-active" : ""}`}><input type="radio" name="zernio-profile" checked={profileId === id} onChange={() => onProfileSelect(id)} /><span className="flex-1"><strong>{profile.name || "بدون نام"}</strong>{profile.isDefault && <span className="inline-hint">پیش‌فرض</span>}<code className="account-id block" dir="ltr">{id}</code></span></label>; })}</div>
      </section>}
    </div>}
  </div>;
}
