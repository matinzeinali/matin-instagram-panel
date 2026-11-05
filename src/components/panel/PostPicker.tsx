"use client";

export type PlatformPost = { id: string; message?: string; createdTime?: string; permalink?: string; picture?: string; mediaType?: string; commentCount?: number };
export type ActiveStory = { id: string; mediaUrl?: string | null; thumbnailUrl?: string | null; permalink?: string | null; timestamp?: string | null; mediaType?: string | null };

export const captionSnippet = (text?: string, length = 70) => {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  return clean.length > length ? `${clean.slice(0, length)}…` : clean;
};

const shortDate = (value?: string | null) => value ? new Date(value).toLocaleDateString("fa-IR", { month: "short", day: "numeric" }) : "";

export function PostThumb({ src, label }: { src?: string | null; label: string }) {
  // Instagram CDN images; a background image avoids layout jumps when a URL has expired.
  return <span className="post-thumb" role="img" aria-label={label} style={src ? { backgroundImage: `url("${src}")` } : undefined} />;
}

/** Choose which post (or story) a rule listens to. `value` is the platform media id, "" = every post. */
export function PostPicker({ trigger, mode, onModeChange, posts, stories, loading, error, value, fallbackTitle, onChange, onReload }: {
  trigger: "comment" | "story_reply";
  mode: "any" | "one";
  onModeChange: (mode: "any" | "one") => void;
  posts: PlatformPost[];
  stories: ActiveStory[];
  loading: boolean;
  error: string;
  value: string;
  fallbackTitle?: string;
  onChange: (selection: { platformPostId: string; postTitle: string }) => void;
  onReload: () => void;
}) {
  const isStory = trigger === "story_reply";
  const items = isStory
    ? stories.map((story) => ({ id: story.id, thumb: story.thumbnailUrl || story.mediaUrl, title: `استوری ${shortDate(story.timestamp)}`, meta: story.mediaType === "VIDEO" ? "ویدیو" : "عکس", link: story.permalink }))
    : posts.map((post) => ({ id: post.id, thumb: post.picture, title: captionSnippet(post.message) || "بدون کپشن", meta: `${shortDate(post.createdTime)}${post.commentCount ? ` · ${post.commentCount.toLocaleString("fa-IR")} کامنت` : ""}`, link: post.permalink }));
  const selectedMissing = value && !items.some((item) => item.id === value);

  return <div className="post-picker">
    <div className="segmented" role="group" aria-label="کدام پست">
      <button type="button" aria-pressed={mode === "any"} onClick={() => onModeChange("any")}>{isStory ? "همهٔ استوری‌ها" : "همهٔ پست‌ها"}</button>
      <button type="button" aria-pressed={mode === "one"} onClick={() => onModeChange("one")}>{isStory ? "فقط یک استوری" : "فقط یک پست"}</button>
    </div>

    {mode === "one" && <>
      {error ? <p className="error-note mt-2">{error} <button type="button" className="link-button" onClick={onReload}>دوباره</button></p>
        : loading ? <p className="field-hint mt-2"><span className="spinner" aria-hidden="true" /> در حال دریافت {isStory ? "استوری‌ها" : "پست‌ها"}…</p>
        : <>
          {!value && items.length > 0 && <p className="field-hint mt-2">روی {isStory ? "استوری" : "پست"} مورد نظر بزن.</p>}
          {selectedMissing && <p className="field-hint mt-2">انتخاب فعلی: «{fallbackTitle || value}» {isStory ? "(این استوری دیگر فعال نیست)" : "(جزو ۲۵ پست آخر نیست)"}</p>}
          {items.length ? <div className="post-grid" role="listbox" aria-label={isStory ? "استوری‌ها" : "پست‌ها"}>{items.map((item) => <button type="button" role="option" aria-selected={item.id === value} key={item.id} className={`post-card ${item.id === value ? "post-card-active" : ""}`} onClick={() => onChange({ platformPostId: item.id, postTitle: item.title })}>
            <PostThumb src={item.thumb} label={item.title} />
            <span className="post-card-text"><span className="post-card-title">{item.title}</span><span className="post-card-meta">{item.meta}</span></span>
          </button>)}</div>
            : <p className="field-hint mt-2">{isStory ? "الان استوری فعالی نیست؛ استوری‌ها فقط ۲۴ ساعت دیده می‌شوند." : "پستی پیدا نشد."}</p>}
          <p className="field-hint mt-1">{isStory ? "استوری‌های فعال" : "۲۵ پست آخر حساب"} · <button type="button" className="link-button" onClick={onReload}>تازه‌سازی</button></p>
        </>}
    </>}
  </div>;
}
