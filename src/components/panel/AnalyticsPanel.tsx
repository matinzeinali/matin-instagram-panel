"use client";

import { useCallback, useEffect, useState } from "react";
import type { SocialAccount } from "./types";
import { accountOptionLabel, responseError } from "./types";

type MetricSet = Record<string, number | undefined>;
type DailyMetric = { date: string; engagement?: number; impressions?: number; views?: number; followersGained?: number };
type TopPost = { postId?: string; platform?: string; publishedAt?: string; metrics?: MetricSet };
type AnalyticsData = {
  totals?: MetricSet;
  followers?: { current?: number; gained?: number };
  daily?: DailyMetric[];
  topPosts?: TopPost[];
  dataAsOf?: string;
  error?: string;
  message?: string;
};
type AnalyticsPost = { _id?: string; postId?: string; platform?: string; publishedAt?: string; analytics?: MetricSet };
type AccountAnalyticsResponse = { posts?: AnalyticsPost[]; pagination?: { total?: number; pages?: number }; error?: string; message?: string };
type DashboardResponse = AnalyticsData & { followers?: AnalyticsData["followers"] & { byAccount?: Array<{ accountId?: string; current?: number; gained?: number }> } };

// Use the local calendar date; toISOString() is UTC and gives yesterday's date after local midnight in Tehran.
const dateString = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const numberText = (value?: number) => (value ?? 0).toLocaleString("fa-IR");
const metricsForPost = (post: AnalyticsPost): MetricSet => post.analytics || {};
const engagementForPost = (metrics: MetricSet) => (metrics.likes || 0) + (metrics.comments || 0) + (metrics.shares || 0) + (metrics.saves || 0);

export function AnalyticsPanel({ profileId, accounts, allowAllAccounts }: { profileId: string; accounts: SocialAccount[]; allowAllAccounts: boolean }) {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 29);
  const [fromDate, setFromDate] = useState(dateString(start));
  const [toDate, setToDate] = useState(dateString(end));
  const [platform, setPlatform] = useState("all");
  const [accountId, setAccountId] = useState(allowAllAccounts ? "all" : "");
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [accountNote, setAccountNote] = useState("");

  const availableAccounts = accounts.filter((account) => account.platform && (platform === "all" || account.platform === platform));
  const selectedAccount = availableAccounts.find((account) => (account._id || account.id) === accountId);
  const firstAvailableId = availableAccounts[0]?._id || availableAccounts[0]?.id || "";

  // Keep the selection valid. Non-admin users may not use "all" (the dashboard endpoint is admin-only),
  // so they fall back to their first account instead.
  useEffect(() => {
    if (accountId === "all" ? allowAllAccounts : Boolean(selectedAccount)) return;
    setAccountId(allowAllAccounts ? "all" : firstAvailableId);
  }, [accountId, allowAllAccounts, selectedAccount, firstAvailableId]);

  const loadAnalytics = useCallback(async () => {
    if (!profileId || (!allowAllAccounts && (accountId === "all" || !selectedAccount))) return;
    setBusy(true);
    setError("");
    setAccountNote("");
    try {
      if (accountId !== "all" && selectedAccount) {
        const query = new URLSearchParams({ profileId, accountId, platform: selectedAccount.platform || "all", fromDate, toDate, limit: "100", page: "1", sortBy: "date", order: "desc" });
        const response = await fetch(`/api/zernio/analytics/posts?${query}`, { cache: "no-store" });
        const result: AccountAnalyticsResponse = await response.json();
        if (!response.ok) throw new Error(responseError(result, `دریافت آمار حساب ناموفق بود (${response.status}).`));

        let posts = result.posts || [];
        const pageCount = Math.min(result.pagination?.pages || 1, 15);
        for (let page = 2; page <= pageCount; page += 1) {
          const pageQuery = new URLSearchParams(query);
          pageQuery.set("page", String(page));
          const pageResponse = await fetch(`/api/zernio/analytics/posts?${pageQuery}`, { cache: "no-store" });
          const pageResult: AccountAnalyticsResponse = await pageResponse.json();
          if (!pageResponse.ok) throw new Error(responseError(pageResult, `دریافت صفحهٔ ${page} از آمار ناموفق بود (${pageResponse.status}).`));
          posts = posts.concat(pageResult.posts || []);
        }

        const totals: MetricSet = {};
        for (const metric of ["impressions", "reach", "likes", "comments", "shares", "saves", "clicks", "views"]) {
          totals[metric] = posts.reduce((sum, post) => sum + (metricsForPost(post)[metric] || 0), 0);
        }
        const dailyMap = new Map<string, DailyMetric>();
        for (const post of posts) {
          if (!post.publishedAt) continue;
          const date = post.publishedAt.slice(0, 10);
          const row = dailyMap.get(date) || { date, engagement: 0, impressions: 0, views: 0 };
          const metrics = metricsForPost(post);
          row.engagement = (row.engagement || 0) + engagementForPost(metrics);
          row.impressions = (row.impressions || 0) + (metrics.impressions || 0);
          row.views = (row.views || 0) + (metrics.views || 0);
          dailyMap.set(date, row);
        }
        const topPosts = posts
          .slice()
          .sort((a, b) => engagementForPost(metricsForPost(b)) - engagementForPost(metricsForPost(a)))
          .slice(0, 5)
          .map((post) => ({ postId: post._id || post.postId, platform: post.platform || selectedAccount.platform, publishedAt: post.publishedAt, metrics: metricsForPost(post) }));

        const nextData: AnalyticsData = {
          totals,
          daily: Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date)),
          topPosts,
        };

        // The dashboard endpoint provides current follower counts per account; keep this optional
        // because post analytics can still load when follower insights are unavailable.
        try {
          const dashboardQuery = new URLSearchParams({ profileId, platform: selectedAccount.platform || "all", fromDate, toDate });
          const dashboardResponse = await fetch(`/api/zernio/analytics/dashboard?${dashboardQuery}`, { cache: "no-store" });
          if (dashboardResponse.ok) {
            const dashboard: DashboardResponse = await dashboardResponse.json();
            const follower = dashboard.followers?.byAccount?.find((entry) => entry.accountId === accountId);
            if (follower) nextData.followers = { current: follower.current, gained: follower.gained };
            nextData.dataAsOf = dashboard.dataAsOf;
          }
        } catch {
          // Account post metrics remain useful if follower data is temporarily unavailable.
        }

        setData(nextData);
        if ((result.pagination?.total || 0) > posts.length) setAccountNote(`آمار ${posts.length.toLocaleString("fa-IR")} پست از ${result.pagination?.total?.toLocaleString("fa-IR")} پست بارگذاری شد؛ برای جلوگیری از درخواست‌های سنگین، حداکثر ۱۵۰۰ پست خوانده می‌شود.`);
        else setAccountNote("این عددها جمع آمار پست‌هایی است که در این بازه منتشر شده‌اند.");
      } else {
        const query = new URLSearchParams({ profileId, platform, fromDate, toDate, compare: "previous_period" });
        const response = await fetch(`/api/zernio/analytics/dashboard?${query}`, { cache: "no-store" });
        const result: AnalyticsData = await response.json();
        if (!response.ok) throw new Error(responseError(result, `دریافت آمار ناموفق بود (${response.status}).`));
        setData(result);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "دریافت آمار ناموفق بود.");
    } finally {
      setBusy(false);
    }
  }, [profileId, accountId, selectedAccount, allowAllAccounts, platform, fromDate, toDate]);

  useEffect(() => { void loadAnalytics(); }, [loadAnalytics]);

  const totals = data?.totals || {};
  const cards: Array<[string, number | undefined]> = [
    ["نمایش", totals.impressions], ["دسترسی", totals.reach], ["تعامل (پسند، کامنت، اشتراک، ذخیره)", (totals.likes || 0) + (totals.comments || 0) + (totals.shares || 0) + (totals.saves || 0)],
    ["بازدید ویدیو", totals.views], ["دنبال‌کننده", data?.followers?.current], ["دنبال‌کنندهٔ تازه", data?.followers?.gained],
  ];
  const maxEngagement = Math.max(1, ...(data?.daily || []).map((day) => day.engagement || 0));

  return (
    <section className="panel-card analytics-panel">
      <form className="analytics-filters" onSubmit={(event) => { event.preventDefault(); void loadAnalytics(); }}>
        <label className="analytics-filter">حساب<select className="field" value={accountId} onChange={(event) => setAccountId(event.target.value)}>{allowAllAccounts && <option value="all">همهٔ حساب‌ها</option>}{availableAccounts.map((account) => { const id = account._id || account.id || ""; return <option key={id} value={id}>{accountOptionLabel(account)}</option>; })}</select></label>
        {allowAllAccounts && <label className="analytics-filter">شبکه<select className="field" value={platform} onChange={(event) => setPlatform(event.target.value)}><option value="all">همه</option><option value="instagram">Instagram</option><option value="facebook">Facebook</option><option value="twitter">X</option><option value="linkedin">LinkedIn</option><option value="tiktok">TikTok</option><option value="youtube">YouTube</option></select></label>}
        <label className="analytics-filter">از تاریخ<input type="date" dir="ltr" className="field" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label>
        <label className="analytics-filter">تا تاریخ<input type="date" dir="ltr" className="field" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label>
        <button className="button-secondary analytics-apply" disabled={busy}>{busy ? "در حال دریافت…" : "به‌روزرسانی"}</button>
      </form>
      {error ? <p role="alert" className="error-note">{error}</p> : data ? <>
        {accountNote && <p className="analytics-note">{accountNote}</p>}
        <div className="metric-grid">{cards.map(([label, value], index) => <div key={label} className={`metric-card ${index === 2 ? "metric-lead" : ""}`}><span>{label}</span><strong>{value === undefined ? "—" : numberText(value)}</strong></div>)}</div>
        <div className="mt-8 grid gap-10 lg:grid-cols-[1.3fr_1fr]">
          <div><h3 className="subsection-title mb-4">{accountId === "all" ? "تعامل روزانه" : "تعامل بر اساس روز انتشار پست"}</h3>{data.daily?.length ? <div className="grid gap-2">{data.daily.map((day) => <div key={day.date} className="bar-row"><time>{new Date(`${day.date}T12:00:00Z`).toLocaleDateString("fa-IR", { month: "short", day: "numeric" })}</time><div className="bar-track"><div className="bar-fill" style={{ width: `${Math.max(2, ((day.engagement || 0) / maxEngagement) * 100)}%` }} /></div><span className="bar-value">{numberText(day.engagement)}</span></div>)}</div> : <p className="empty-note">در این بازه داده‌ای ثبت نشده.</p>}</div>
          <div><h3 className="subsection-title mb-2">پربازدیدترین پست‌ها</h3>{data.topPosts?.length ? <ul className="post-list">{data.topPosts.map((post, index) => <li className="post-row" key={post.postId || index}><div className="post-row-top"><strong>{post.platform || "پست"}</strong><span className="post-date">{post.publishedAt ? new Date(post.publishedAt).toLocaleDateString("fa-IR") : ""}</span></div><p className="muted mt-1">{numberText(post.metrics?.likes)} پسند · {numberText(post.metrics?.comments)} کامنت · {numberText(post.metrics?.reach)} دسترسی</p></li>)}</ul> : <p className="empty-note">پستی در این بازه نیست.</p>}</div>
        </div>
        {data.dataAsOf && <p className="post-date mt-6">آخرین به‌روزرسانی داده‌ها: {new Date(data.dataAsOf).toLocaleString("fa-IR", { dateStyle: "medium", timeStyle: "short" })}</p>}
      </> : <div className="analytics-empty">{busy && <span className="spinner" aria-hidden="true" />}<strong>{busy ? "در حال دریافت آمار…" : "آماری برای نمایش نیست"}</strong><p>{busy ? "" : profileId ? "حساب و بازهٔ زمانی را انتخاب کن." : "اول باید یک پروفایل و حساب متصل وجود داشته باشد."}</p></div>}
    </section>
  );
}
