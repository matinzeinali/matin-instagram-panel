export type Profile = { _id?: string; id?: string; name?: string; isDefault?: boolean };

export type SocialAccount = {
  _id?: string;
  id?: string;
  platform?: string;
  username?: string;
  displayName?: string;
  isActive?: boolean;
  profileId?: string | { _id?: string; id?: string };
};

export type Post = {
  _id?: string;
  id?: string;
  content?: string;
  status?: string;
  scheduledFor?: string;
  publishedAt?: string;
  createdAt?: string;
  platforms?: Array<{ platform?: string; status?: string; accountId?: string; platformPostUrl?: string }>;
};

export type Conversation = {
  id?: string;
  conversationId?: string;
  accountId?: string;
  platform?: string;
  participantName?: string;
  participantId?: string;
  lastMessage?: string;
  lastMessageAt?: string;
  unreadCount?: number;
};

export type InboxMessage = {
  id?: string;
  message?: string;
  senderName?: string;
  senderId?: string;
  direction?: "incoming" | "outgoing";
  createdAt?: string;
  sentAt?: string;
  attachments?: Array<{ url?: string; type?: string }>;
};

export type InboxComment = {
  id?: string;
  commentId?: string;
  postId?: string;
  accountId?: string;
  platform?: string;
  username?: string;
  authorName?: string;
  text?: string;
  message?: string;
  createdAt?: string;
};

export type Automation = {
  id?: string;
  _id?: string;
  name?: string;
  trigger?: string;
  keywords?: string[];
  dmMessage?: string;
  isActive?: boolean;
  matchMode?: "contains" | "word" | "exact";
  commentReply?: string;
};

export type ApiEnvelope<T> = {
  profiles?: T[];
  accounts?: T[];
  posts?: T[];
  data?: T[];
  conversations?: T[];
  comments?: T[];
  automations?: T[];
  error?: string;
  message?: string;
  pagination?: { hasMore?: boolean; nextCursor?: string; total?: number };
  [key: string]: unknown;
};

export function readList<T>(data: ApiEnvelope<T> | T[], ...keys: Array<keyof ApiEnvelope<T>>): T[] {
  if (Array.isArray(data)) return data;
  for (const key of keys) {
    const value = data[key];
    if (Array.isArray(value)) return value as T[];
  }
  return [];
}

export function responseError(data: unknown, fallback: string) {
  if (typeof data === "object" && data !== null && !Array.isArray(data)) {
    const record = data as Record<string, unknown>;
    if (typeof record.error === "string") return record.error;
    if (typeof record.message === "string") return record.message;
  }
  return fallback;
}

/** Label for an account inside <option>/plain text. The LRM keeps "@handle · platform" in Latin order inside RTL text. */
export function accountOptionLabel(account: SocialAccount) {
  const id = account._id || account.id || "";
  const name = account.username ? `@${account.username}` : account.displayName || id.slice(-6);
  return `\u200E${name} · ${account.platform || "?"}\u200E`;
}
