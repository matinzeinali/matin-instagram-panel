// Helpers for comment-to-DM rules (Zernio /comment-automations).
// Zernio compares keywords against the raw comment text, so Persian spelling variants
// (Arabic ي/ك, half-space, Persian vs Latin digits, upper/lower case) are added as extra
// keywords here; otherwise a comment typed on an Arabic keyboard silently never matches.

export type MatchMode = "contains" | "word" | "exact";
export type RepeatPolicy = { mode: "once" | "every_comment"; cooldownHours?: number };

export type AutomationRule = {
  id?: string;
  _id?: string;
  name?: string;
  createdAt?: string;
  accountId?: string;
  platform?: string;
  trigger?: string;
  keywords?: string[];
  excludeKeywords?: string[];
  matchMode?: MatchMode;
  dmMessage?: string;
  commentReply?: string;
  commentReplyVariations?: string[];
  dmMessageVariations?: string[];
  buttons?: Array<{ type?: string; title?: string; url?: string }>;
  dmDelaySeconds?: number;
  typoTolerance?: boolean;
  actions?: { likeComment?: boolean; hideComment?: boolean };
  isActive?: boolean;
  repeatPolicy?: RepeatPolicy;
  publicReplyPolicy?: "after_dm" | "always";
  audience?: { followerStatus?: "any" | "follower" | "non_follower"; whenUnknown?: "send" | "skip" | "verify"; tapToUnlock?: boolean };
  followGate?: { message?: string; buttonLabel?: string; notFollowingMessage?: string };
  platformPostId?: string;
  postTitle?: string;
  stats?: {
    triggered?: number; dmsSent?: number; dmsFailed?: number; uniqueContacts?: number;
    trackedSends?: number; linkClicks?: number; uniqueClicks?: number; read?: number;
    followGateSent?: number; followGatePassed?: number; followGateFailed?: number;
  };
};

const ARABIC_TO_PERSIAN: Record<string, string> = { "ي": "ی", "ى": "ی", "ك": "ک", "ة": "ه", "ۀ": "ه", "أ": "ا", "إ": "ا", "ٱ": "ا" };
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/** Canonical form used for comparing and de-duplicating: Persian letters, Latin digits, no diacritics/tatweel/ZWNJ, lower case, single spaces. */
export function normalizeText(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[يىكةۀأإٱ]/g, (char) => ARABIC_TO_PERSIAN[char] || char)
    .replace(/[۰-۹]/g, (digit) => String(PERSIAN_DIGITS.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String(ARABIC_DIGITS.indexOf(digit)))
    .replace(/[ً-ٰٟـ]/g, "") // harakat, superscript alef, tatweel
    .replace(/[‌‍‎‏]/g, "") // ZWNJ/ZWJ/direction marks
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}

/** Key for "is this the same word?": normalized and without spaces, so «می‌خوام», «می خوام» and «میخوام» are one keyword. */
const keyOf = (value: string) => normalizeText(value).replace(/ /g, "");

/** Split what the user typed into keywords: English or Persian comma, semicolons, or new lines. */
export function parseKeywords(value: string) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of value.split(/[,،;؛\n]+/)) {
    const keyword = part.replace(/\s+/g, " ").trim();
    if (!keyword) continue;
    const key = keyOf(keyword);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(keyword);
  }
  return result;
}

/** All spellings of a keyword that a commenter might realistically type. */
export function keywordVariants(keyword: string) {
  const base = keyword.trim();
  const persian = normalizeText(base).replace(/\s+/g, " ");
  const withArabicLetters = persian.replace(/ی/g, "ي").replace(/ک/g, "ك");
  const variants = new Set<string>([
    base,
    persian,
    withArabicLetters,
    base.replace(/‌/g, " "), // half-space typed as a normal space
    base.replace(/‌/g, ""), // half-space dropped
    persian.replace(/[0-9]/g, (digit) => PERSIAN_DIGITS[Number(digit)]),
    // Zernio compares raw text, so cover the usual Latin casings (hermes / HERMES / Hermes / Prompt Master).
    base.toLocaleLowerCase("en-US"),
    base.toLocaleUpperCase("en-US"),
    base.charAt(0).toLocaleUpperCase("en-US") + base.slice(1).toLocaleLowerCase("en-US"),
    base.toLocaleLowerCase("en-US").replace(/(^|\s)(\S)/g, (_match, space: string, letter: string) => space + letter.toLocaleUpperCase("en-US")),
  ]);
  return [...variants].map((item) => item.trim()).filter(Boolean);
}

/** Keywords as sent to Zernio: what the user wrote plus spelling variants, de-duplicated exactly. */
export function expandKeywords(keywords: string[]) {
  const result: string[] = [];
  for (const keyword of keywords) for (const variant of keywordVariants(keyword)) if (!result.includes(variant)) result.push(variant);
  return result;
}

/** Collapse a stored keyword list (which contains the variants) back to what the user originally wrote. */
export function collapseKeywords(keywords: string[] = []) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const keyword of keywords) {
    const key = keyOf(keyword);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(keyword);
  }
  return result;
}

function wordMatch(text: string, keyword: string) {
  // Unicode-aware word boundary: Persian letters are not \w, so \b cannot be used.
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "u").test(text);
}

function keywordHits(text: string, keyword: string, mode: MatchMode) {
  if (!keyword) return false;
  if (mode === "exact") return text === keyword;
  if (mode === "word") return wordMatch(text, keyword);
  return text.includes(keyword);
}

/** Predict whether a comment fires a rule. Approximates Zernio's matcher on normalized text. */
export function predictMatch(rule: Pick<AutomationRule, "keywords" | "excludeKeywords" | "matchMode">, comment: string) {
  const text = normalizeText(comment);
  const mode = rule.matchMode || "contains";
  const keywords = (rule.keywords || []).map(normalizeText);
  const excluded = (rule.excludeKeywords || []).map(normalizeText).find((keyword) => keywordHits(text, keyword, mode));
  if (excluded) return { matched: false, reason: `کلمهٔ استثنا «${excluded}» در کامنت هست` };
  if (!keywords.length) return { matched: true, reason: "این قانون کلیدواژه ندارد و به هر کامنتی جواب می‌دهد" };
  const hit = keywords.find((keyword) => keywordHits(text, keyword, mode));
  return hit ? { matched: true, reason: `کلمهٔ «${hit}» پیدا شد` } : { matched: false, reason: "هیچ‌کدام از کلمه‌ها پیدا نشد" };
}

/** Keywords that appear in more than one active rule of the same account (a commenter would get two DMs). */
export function overlappingKeywords(rule: AutomationRule, others: AutomationRule[]) {
  const mine = new Set(collapseKeywords(rule.keywords).map(keyOf));
  const clashes: Array<{ keyword: string; other: string }> = [];
  for (const other of others) {
    if (other === rule || other.isActive === false || (other.id || other._id) === (rule.id || rule._id)) continue;
    // Rules only compete on the same door (comment vs story reply) and the same post; an unbound rule covers every post.
    if ((other.trigger || "comment") !== (rule.trigger || "comment")) continue;
    if (rule.platformPostId && other.platformPostId && rule.platformPostId !== other.platformPostId) continue;
    for (const keyword of collapseKeywords(other.keywords)) {
      if (mine.has(keyOf(keyword))) clashes.push({ keyword, other: other.name || "بدون نام" });
    }
  }
  return clashes;
}

const STATUS_LABELS: Record<string, string> = { sent: "فرستاده شد", failed: "ناموفق", skipped: "رد شد", pending: "در صف", gated: "منتظر تأیید فالو" };
export const logStatusLabel = (status?: string) => STATUS_LABELS[status || ""] || status || "رویداد";

/** Turn Zernio/Meta error strings into a sentence the owner can act on. */
export function explainError(error?: string | null) {
  if (!error) return "";
  const text = error.toLowerCase();
  if (text.includes("instagram_manage_engagement") || text.includes("platform_beta_restricted") || (text.includes("liking") && text.includes("limited release")))
    return "لایک نشد: متا هنوز اجازهٔ لایک خودکار کامنت در اینستاگرام را به Zernio نداده (فقط حساب‌های آزمایشی Zernio). از دست پنل کاری برنمی‌آید؛ تا آن موقع کامنت‌ها را در خود اینستاگرام لایک کن.";
  if (text.includes("already sent dm")) return "قبلاً به این نفر دایرکت داده شده و قانون روی «هر نفر فقط یک بار» است.";
  if (text.includes("cooldown")) return "این نفر به‌تازگی دایرکت گرفته و هنوز در فاصلهٔ استراحت قانون است.";
  if (text.includes("identical") || text.includes("dedupe")) return "همین متن به‌تازگی برای این نفر فرستاده شده بود.";
  if (text.includes("does not exist") || text.includes("cannot be loaded")) return "کامنت پیدا نشد؛ احتمالاً حذف شده، یا جواب به کامنتِ یک کامنت بوده که اینستاگرام اجازهٔ پاسخ عمومی به آن را نمی‌دهد.";
  if (text.includes("permission")) return "اینستاگرام اجازهٔ این کار را نداد؛ حساب را یک بار از بخش «حساب‌های متصل» دوباره وصل کن.";
  if (text.includes("outside of allowed window") || text.includes("allowed window")) return "مهلت ۷ روزهٔ اینستاگرام برای پاسخ خصوصی به این کامنت تمام شده بود.";
  if (text.includes("rate") || text.includes("limit")) return "اینستاگرام موقتاً تعداد ارسال را محدود کرده؛ کمی بعد خودکار ادامه می‌دهد.";
  return error;
}
