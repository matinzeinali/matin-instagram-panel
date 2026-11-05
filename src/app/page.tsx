"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AccessPanel } from "@/components/panel/AccessPanel";
import { AccountsPanel } from "@/components/panel/AccountsPanel";
import { AnalyticsPanel } from "@/components/panel/AnalyticsPanel";
import { AutomationPanel } from "@/components/panel/AutomationPanel";
import { ContentPanel } from "@/components/panel/ContentPanel";
import { InboxPanel } from "@/components/panel/InboxPanel";
import { LoginPanel } from "@/components/panel/LoginPanel";
import type { Profile, SocialAccount } from "@/components/panel/types";
import { readList, responseError, type ApiEnvelope } from "@/components/panel/types";

type Section = "content" | "inbox" | "analytics" | "automations" | "accounts" | "access";
type AuthUser = { id: string; username: string; role: "admin" | "user"; profileId?: string; accountId?: string };
const sections: Array<{ id: Section; label: string; description: string }> = [
  { id: "content", label: "انتشار محتوا", description: "متن و رسانه را آماده کن، حساب‌های مقصد را بزن و همین حالا منتشر یا زمان‌بندی کن." },
  { id: "inbox", label: "پیام‌ها و کامنت‌ها", description: "دایرکت‌ها و کامنت‌های حساب انتخاب‌شده را بخوان و جواب بده." },
  { id: "analytics", label: "آمار", description: "ببین پست‌ها در بازهٔ انتخابی چقدر دیده شدند و چقدر تعامل گرفتند." },
  { id: "automations", label: "پاسخ خودکار", description: "وقتی کسی کلیدواژه‌ای کامنت کرد، خودکار برایش دایرکت بفرست." },
  { id: "accounts", label: "حساب‌های متصل", description: "حساب‌های اجتماعی این پروفایل و اتصال حساب تازه." },
  { id: "access", label: "کاربران و گذرواژه", description: "گذرواژه‌ات را عوض کن؛ مدیر می‌تواند برای همکاران حساب بسازد." },
];

export default function Home() {
  const [section, setSection] = useState<Section>("content");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [profileId, setProfileId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [authStatus, setAuthStatus] = useState<"checking" | "authenticated" | "unauthenticated">("checking");
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [setupRequired, setSetupRequired] = useState(false);

  const loadAccounts = useCallback(async (targetProfileId: string, expectedAccountId?: string) => {
    if (!targetProfileId) return [];
    const response = await fetch(`/api/zernio/accounts?profileId=${encodeURIComponent(targetProfileId)}`, { cache: "no-store" });
    const data: ApiEnvelope<SocialAccount> | SocialAccount[] = await response.json();
    if (!response.ok) throw new Error(responseError(data, `دریافت حساب‌ها ناموفق بود (${response.status}).`));
    const list = readList(data, "accounts", "data");
    setAccounts(list);
    if (expectedAccountId) {
      const connected = list.find((account) => (account._id || account.id) === expectedAccountId);
      const name = connected?.username || connected?.displayName;
      setMessage(connected ? `حساب ${name ? `@${name} ` : ""}با موفقیت به Zernio وصل شد.` : "برگشت OAuth دریافت شد؛ حساب در فهرست Zernio هنوز پیدا نشد. دوباره تازه‌سازی کن.");
    }
    return list;
  }, []);

  const loadProfiles = useCallback(async (preferredId = "", expectedAccountId = "") => {
    setBusy(true);
    setMessage("در حال دریافت پروفایل‌ها و حساب‌ها...");
    try {
      const response = await fetch("/api/zernio/profiles", { cache: "no-store" });
      const data: ApiEnvelope<Profile> | Profile[] = await response.json();
      if (!response.ok) throw new Error(responseError(data, `دریافت پروفایل ناموفق بود (${response.status}).`));
      const list = readList(data, "profiles", "data");
      setProfiles(list);
      if (!list.length) {
        setAccounts([]);
        setProfileId("");
        setMessage("پروفایلی در Zernio پیدا نشد. ابتدا یک پروفایل بساز.");
        return;
      }
      const saved = preferredId || window.localStorage.getItem("matin-zernio-profile-id") || "";
      const selected = list.some((profile) => (profile._id || profile.id) === saved)
        ? saved
        : (list.find((profile) => profile.isDefault)?._id || list.find((profile) => profile.isDefault)?.id || list[0]._id || list[0].id || "");
      setProfileId(selected);
      window.localStorage.setItem("matin-zernio-profile-id", selected);
      const loadedAccounts = await loadAccounts(selected, expectedAccountId);
      if (!expectedAccountId) setMessage(`${list.length} پروفایل و ${loadedAccounts.length} حساب دریافت شد.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "ارتباط با Zernio ناموفق بود.");
    } finally {
      setBusy(false);
    }
  }, [loadAccounts]);

  const initializePanel = useCallback((assignedProfileId = "") => {
    const params = new URLSearchParams(window.location.search);
    const connection = params.get("connection");
    if (connection === "failed") {
      setMessage(`اتصال کامل نشد${params.get("reason") ? ` (${params.get("reason")})` : ""}. دوباره تلاش کن.`);
    } else if (connection === "incomplete" || connection === "callback_received") {
      setMessage("پاسخ اتصال قدیمی یا ناقص بود؛ حساب‌ها را دوباره دریافت کن.");
    }
    const connected = connection === "connected" && !assignedProfileId;
    const returnedProfileId = assignedProfileId || params.get("profileId") || "";
    const returnedAccountId = params.get("accountId") || "";
    const saved = window.localStorage.getItem("matin-zernio-profile-id") || "";
    window.history.replaceState(null, "", window.location.pathname);
    void loadProfiles(returnedProfileId || saved, connected ? returnedAccountId : "");
  }, [loadProfiles]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/session", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("بررسی نشست انجام نشد.");
        return response.json();
      })
      .then((data) => {
        if (cancelled) return;
        setSetupRequired(Boolean(data.setupRequired));
        if (data.authenticated && data.user) {
          setAuthUser(data.user);
          setAuthStatus("authenticated");
          initializePanel(data.user.profileId || "");
        } else {
          setAuthStatus("unauthenticated");
        }
      })
      .catch(() => { if (!cancelled) setAuthStatus("unauthenticated"); });
    return () => { cancelled = true; };
  }, [initializePanel]);

  function completeLogin(user: AuthUser) {
    setAuthUser(user);
    setAuthStatus("authenticated");
    initializePanel(user.profileId || "");
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    setAuthUser(null);
    setProfiles([]);
    setAccounts([]);
    setProfileId("");
    setSection("content");
    setAuthStatus("unauthenticated");
  }

  async function connectPlatform(platform: string) {
    if (!profileId) return setMessage("ابتدا پروفایل Zernio را انتخاب کن.");
    setBusy(true);
    setMessage(`در حال شروع اتصال ${platform}...`);
    try {
      const response = await fetch(`/api/connect/${encodeURIComponent(platform)}?profileId=${encodeURIComponent(profileId)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `شروع اتصال ناموفق بود (${response.status}).`);
      const authUrl = data.authUrl || data.url || data.redirectUrl;
      if (typeof authUrl !== "string") throw new Error("Zernio لینک تأیید را برنگرداند.");
      window.location.assign(authUrl);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "شروع اتصال ناموفق بود.");
      setBusy(false);
    }
  }

  async function changeProfile(id: string) {
    setProfileId(id);
    window.localStorage.setItem("matin-zernio-profile-id", id);
    setBusy(true);
    try {
      await loadAccounts(id);
      setMessage("حساب‌های پروفایل انتخاب‌شده به‌روز شد.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "دریافت حساب‌ها ناموفق بود.");
    } finally {
      setBusy(false);
    }
  }

  const activeProfile = profiles.find((profile) => (profile._id || profile.id) === profileId);
  const activeLabel = activeProfile?.name || (profileId ? "بدون نام" : "انتخاب نشده");

  if (authStatus === "checking") return <main className="auth-screen"><p className="auth-checking"><span className="spinner" aria-hidden="true" /> در حال بررسی ورود…</p></main>;
  if (authStatus !== "authenticated" || !authUser) return <LoginPanel setupRequired={setupRequired} onSuccess={completeLogin} />;

  const isAdmin = authUser.role === "admin";
  const current = sections.find((item) => item.id === section) || sections[0];
  const showSetupHint = !profileId && !busy;

  return <main className="app-shell">
    <header className="app-header">
      <Link className="brand" href="/" aria-label="صفحهٔ اصلی پنل">متین</Link>
      <div className="header-profile">
        {isAdmin && profiles.length > 1
          ? <label className="profile-switch"><span>پروفایل</span><select value={profileId} disabled={busy} onChange={(event) => void changeProfile(event.target.value)}>{profiles.map((profile) => { const id = profile._id || profile.id || ""; return <option key={id} value={id}>{profile.name || "بدون نام"}</option>; })}</select></label>
          : <span className="profile-name"><span>پروفایل</span><strong>{activeLabel}</strong></span>}
        <span className="header-count">{accounts.length.toLocaleString("fa-IR")} حساب</span>
      </div>
      <div className="header-user">
        <span dir="ltr">{authUser.username}</span>
        {isAdmin && <span className="user-role">مدیر</span>}
        <button className="button-quiet" onClick={() => void logout()}>خروج</button>
      </div>
    </header>

    <div className="dashboard-layout">
      <nav className="sidebar" aria-label="بخش‌های پنل">
        {sections.map((item) => <button key={item.id} className={`nav-item ${section === item.id ? "nav-active" : ""}`} onClick={() => setSection(item.id)} aria-current={section === item.id ? "page" : undefined}>{item.label}</button>)}
      </nav>

      <div className="main-column">
        <div className="page-heading">
          <h1>{current.label}</h1>
          <p className="page-description">{current.description}</p>
        </div>
        {showSetupHint && <div className="notice-bar" role="status">{isAdmin
          ? <>پروفایلی از Zernio دریافت نشد{message ? ` (${message})` : ""}. اگر کلید تنظیم نشده، مقدار <code dir="ltr">ZERNIO_API_KEY</code> را در فایل <code dir="ltr">.env.local</code> بگذار و سرور را دوباره اجرا کن. <button className="link-button" onClick={() => void loadProfiles(profileId)}>دوباره امتحان کن</button></>
          : <>هنوز حسابی به کاربری تو وصل نشده. از مدیر پنل بخواه یک حساب اجتماعی به تو اختصاص دهد.</>}</div>}
        {section === "content" && <ContentPanel profileId={profileId} accounts={accounts} />}
        {section === "inbox" && <InboxPanel profileId={profileId} accounts={accounts} />}
        {section === "analytics" && <AnalyticsPanel profileId={profileId} accounts={accounts} allowAllAccounts={isAdmin} />}
        {section === "automations" && <AutomationPanel profileId={profileId} accounts={accounts} />}
        {section === "accounts" && <AccountsPanel profiles={profiles} accounts={accounts} profileId={profileId} busy={busy} message={message} canManage={isAdmin} onProfileSelect={(id) => void changeProfile(id)} onConnect={(platform) => void connectPlatform(platform)} onRefresh={() => void loadProfiles(profileId)} />}
        {section === "access" && <AccessPanel user={authUser} profileId={profileId} accounts={accounts} />}
      </div>
    </div>
  </main>;
}
