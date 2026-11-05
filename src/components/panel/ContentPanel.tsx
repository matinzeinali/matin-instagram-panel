"use client";

import { useCallback, useEffect, useState } from "react";
import type { Post, SocialAccount } from "./types";
import { readList, responseError, type ApiEnvelope } from "./types";

type Props = { profileId: string; accounts: SocialAccount[] };
type MediaItem = { url: string; type: "image" | "video" };

export function ContentPanel({ profileId, accounts }: Props) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [content, setContent] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [postType, setPostType] = useState("feed");
  const [scheduleAt, setScheduleAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [postsLoading, setPostsLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setSelectedAccounts(accounts.filter((account) => account.isActive !== false).map((account) => account._id || account.id || "").filter(Boolean));
  }, [accounts]);

  const loadPosts = useCallback(async () => {
    if (!profileId) { setPostsLoading(false); return; }
    setPostsLoading(true);
    try {
      const response = await fetch(`/api/zernio/posts?profileId=${encodeURIComponent(profileId)}&limit=20`, { cache: "no-store" });
      const data: ApiEnvelope<Post> | Post[] = await response.json();
      if (!response.ok) throw new Error(responseError(data, `دریافت محتوا ناموفق بود (${response.status}).`));
      setPosts(readList(data, "posts", "data"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "دریافت محتوا ناموفق بود.");
    } finally {
      setPostsLoading(false);
    }
  }, [profileId]);

  useEffect(() => { void loadPosts(); }, [loadPosts]);

  async function uploadFiles(): Promise<MediaItem[]> {
    const media: MediaItem[] = [];
    for (const file of files) {
      if (!(file.type.startsWith("image/") || file.type.startsWith("video/"))) throw new Error("فقط عکس یا ویدیو قابل بارگذاری است.");
      const presignResponse = await fetch("/api/zernio/media/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, contentType: file.type, size: file.size }),
      });
      const presign = await presignResponse.json();
      if (!presignResponse.ok) throw new Error(presign.error || "گرفتن لینک بارگذاری ناموفق بود.");
      if (typeof presign.uploadUrl !== "string" || typeof presign.publicUrl !== "string") throw new Error("Zernio لینک بارگذاری معتبر برنگرداند.");
      const uploadResponse = await fetch(presign.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!uploadResponse.ok) throw new Error(`بارگذاری ${file.name} ناموفق بود.`);
      media.push({ url: presign.publicUrl, type: file.type.startsWith("video/") ? "video" : "image" });
    }
    return media;
  }

  async function submitPost(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedAccounts.length) return setMessage("حداقل یک حساب متصل را انتخاب کن.");
    if (!content.trim() && !files.length) return setMessage("متن یا فایل رسانه لازم است.");
    if (postType === "story" && files.length !== 1) return setMessage("استوری باید دقیقاً یک فایل رسانه داشته باشد.");
    setBusy(true);
    setMessage(files.length ? "در حال بارگذاری فایل‌ها و ارسال محتوا..." : "در حال ارسال محتوا...");
    try {
      const mediaItems = await uploadFiles();
      const targets = accounts
        .filter((account) => selectedAccounts.includes(account._id || account.id || ""))
        .map((account) => {
          const target: Record<string, unknown> = {
            platform: account.platform,
            accountId: account._id || account.id,
          };
          if (postType === "story" && ["instagram", "facebook"].includes(account.platform || "")) {
            target.platformSpecificData = { contentType: "story" };
          }
          if (postType === "reel" && account.platform === "facebook") {
            target.platformSpecificData = { contentType: "reel" };
          }
          return target;
        });
      const payload: Record<string, unknown> = { content, mediaItems, platforms: targets };
      if (scheduleAt) {
        payload.scheduledFor = scheduleAt;
        payload.timezone = "Asia/Tehran";
      } else {
        payload.publishNow = true;
      }
      const response = await fetch("/api/zernio/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(responseError(result, `ارسال محتوا ناموفق بود (${response.status}).`));
      setMessage(scheduleAt ? "محتوا برای زمان انتخاب‌شده زمان‌بندی شد." : "درخواست انتشار ثبت شد.");
      setContent("");
      setFiles([]);
      setScheduleAt("");
      await loadPosts();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "ارسال محتوا ناموفق بود.");
    } finally {
      setBusy(false);
    }
  }

  const fileSizeText = (size: number) => size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} کیلوبایت` : `${(size / (1024 * 1024)).toFixed(1)} مگابایت`;
  const statusLabel = (status?: string) => ({ published: "منتشر شده", scheduled: "زمان‌بندی‌شده", failed: "ناموفق", draft: "پیش‌نویس", queued: "در صف انتشار" }[status?.toLowerCase() || ""] || status || "محتوا");

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(300px,1fr)]">
      <section className="panel-card compose-panel">
        <form onSubmit={submitPost}>
          <label className="compose-label">متن پست
            <textarea value={content} onChange={(event) => setContent(event.target.value)} rows={6} maxLength={2200} className="field" placeholder="کپشن را اینجا بنویس…" />
            <span className="char-count">{content.length.toLocaleString("fa-IR")} / ۲٬۲۰۰</span>
          </label>

          <div className="compose-field"><span>عکس یا ویدیو</span>
            <label className="upload-zone"><input className="upload-input" type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm" multiple onChange={(event) => { setFiles((current) => [...current, ...Array.from(event.target.files || [])]); event.target.value = ""; }} /><span className="upload-icon" aria-hidden="true">+</span><span><strong>انتخاب فایل از کامپیوتر</strong><small>JPG، PNG، WebP، MP4 یا MOV · برای کاروسل چند فایل انتخاب کن</small></span></label>
            {files.length > 0 && <ul className="selected-files">{files.map((file, index) => <li key={`${file.name}-${file.lastModified}-${index}`}><span className="file-type">{file.type.startsWith("video/") ? "ویدیو" : "عکس"}</span><span className="file-details"><strong dir="ltr">{file.name}</strong><small>{fileSizeText(file.size)}</small></span><button className="file-remove" type="button" aria-label={`حذف ${file.name}`} onClick={() => setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))}>×</button></li>)}</ul>}
          </div>

          <div className="compose-options">
            <div className="compose-field"><span>نوع پست</span>
              <div className="segmented" role="group" aria-label="نوع پست">
                {[["feed", "پست"], ["reel", "ریلز"], ["story", "استوری"]].map(([value, label]) => <button key={value} type="button" aria-pressed={postType === value} onClick={() => setPostType(value)}>{label}</button>)}
              </div>
              {postType === "story" && <span className="field-hint">استوری دقیقاً یک عکس یا ویدیو لازم دارد.</span>}
            </div>
            <label className="compose-field">زمان انتشار
              <input type="datetime-local" dir="ltr" className="field" value={scheduleAt} onChange={(event) => setScheduleAt(event.target.value)} />
              <span className="field-hint">{scheduleAt ? <>به وقت تهران · <button type="button" className="link-button" onClick={() => setScheduleAt("")}>انتشار فوری</button></> : "خالی بگذار تا همین حالا منتشر شود."}</span>
            </label>
          </div>

          {accounts.length > 0 ? <fieldset className="destination-fieldset">
            <div className="destination-head"><legend>منتشر شود در</legend><span className="field-hint">{selectedAccounts.length.toLocaleString("fa-IR")} از {accounts.length.toLocaleString("fa-IR")} حساب</span></div>
            <div className="destination-list">{accounts.map((account) => {
              const id = account._id || account.id || "";
              const checked = selectedAccounts.includes(id);
              return <label key={id} className={`destination-option ${checked ? "destination-option-active" : ""}`}><input type="checkbox" checked={checked} onChange={() => setSelectedAccounts((old) => checked ? old.filter((value) => value !== id) : [...old, id])} /><span className={`platform-mark platform-${account.platform || "other"}`} aria-hidden="true">{(account.platform || "?").slice(0, 1).toUpperCase()}</span><span className="destination-name"><strong dir={account.username ? "ltr" : undefined}>{account.username ? `@${account.username}` : account.displayName || account.platform}</strong><small>{account.platform}</small></span><span className="check-mark" aria-hidden="true">✓</span></label>;
            })}</div>
          </fieldset> : <p className="empty-note">هنوز حسابی وصل نیست. از بخش «حساب‌های متصل» یک حساب اضافه کن.</p>}

          <div className="compose-submit"><button className="button-primary publish-button" disabled={busy || !accounts.length || !selectedAccounts.length}>{busy ? "در حال ارسال…" : scheduleAt ? "زمان‌بندی کن" : "همین حالا منتشر کن"}</button><p role="status" aria-live="polite" className="compose-status">{message}</p></div>
        </form>
      </section>

      <section className="panel-card">
        <div className="mb-2 flex items-center justify-between"><h2 className="section-title">پست‌های اخیر</h2><button onClick={() => void loadPosts()} className="button-quiet" disabled={postsLoading}>تازه‌سازی</button></div>
        {postsLoading ? <div className="posts-loading" role="status"><span className="spinner" aria-hidden="true" /><span>در حال دریافت…</span></div> : posts.length ? <ul className="post-list">{posts.map((post) => <li key={post._id || post.id} className="post-row"><div className="post-row-top"><span className={`post-status post-status-${post.status || "unknown"}`}>{statusLabel(post.status)}</span><span className="post-platforms">{post.platforms?.map((item) => item.platform).filter(Boolean).join("، ")}</span></div><p className="post-copy">{post.content || "بدون کپشن"}</p><p className="post-date">{post.publishedAt || (post.status === "published" && post.scheduledFor) ? `منتشر شده ${new Date(post.publishedAt || post.scheduledFor || "").toLocaleString("fa-IR", { dateStyle: "medium", timeStyle: "short" })}` : post.scheduledFor ? `برای ${new Date(post.scheduledFor).toLocaleString("fa-IR", { dateStyle: "medium", timeStyle: "short" })}` : "زمان انتشار ثبت نشده"}</p></li>)}</ul> : <div className="posts-empty"><strong>هنوز پستی نیست</strong><p>اولین پست را از فرم کناری منتشر یا زمان‌بندی کن.</p></div>}
      </section>
    </div>
  );
}
