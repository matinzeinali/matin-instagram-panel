import "server-only";

import { randomBytes, randomUUID, scrypt as scryptCallback, createHmac, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

const scrypt = promisify(scryptCallback);
const cookieName = "matin_panel_session";
const sessionLifetimeSeconds = 60 * 60 * 8;
const dataDirectory = path.resolve(process.cwd(), process.env.AUTH_DATA_DIR?.trim() || ".data");
const usersPath = path.join(dataDirectory, "users.json");
const secretPath = path.join(dataDirectory, "session-secret");

export type PanelRole = "admin" | "user";
export type PanelUser = { id: string; username: string; role: PanelRole; createdAt: string; sessionVersion: number; profileId?: string; accountId?: string };
type StoredUser = PanelUser & { passwordSalt: string; passwordHash: string };
type UserStore = { users: StoredUser[] };

let secretCache: Buffer | undefined;
let mutationQueue: Promise<void> = Promise.resolve();

async function getSecret() {
  if (secretCache) return secretCache;
  if (process.env.AUTH_SECRET?.trim()) {
    if (Buffer.byteLength(process.env.AUTH_SECRET.trim(), "utf8") < 32) throw new Error("AUTH_SECRET must contain at least 32 bytes.");
    secretCache = Buffer.from(process.env.AUTH_SECRET.trim(), "utf8");
    return secretCache;
  }
  await mkdir(dataDirectory, { recursive: true });
  try {
    secretCache = await readFile(secretPath);
  } catch {
    const created = randomBytes(48);
    try {
      await writeFile(secretPath, created, { flag: "wx", mode: 0o600 });
      secretCache = created;
    } catch {
      secretCache = await readFile(secretPath);
    }
  }
  return secretCache;
}

async function readStore(): Promise<UserStore> {
  try {
    const parsed = JSON.parse(await readFile(usersPath, "utf8")) as UserStore;
    return { users: Array.isArray(parsed.users) ? parsed.users : [] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { users: [] };
    throw error;
  }
}

async function writeStore(store: UserStore) {
  await mkdir(dataDirectory, { recursive: true });
  const temporaryPath = `${usersPath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(store, null, 2), { mode: 0o600 });
  await rename(temporaryPath, usersPath);
}

export async function updateUserStore<T>(update: (store: UserStore) => Promise<T> | T): Promise<T> {
  let release: () => void = () => undefined;
  const previous = mutationQueue;
  mutationQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    const store = await readStore();
    const result = await update(store);
    await writeStore(store);
    return result;
  } finally {
    release();
  }
}

export async function listUsers() {
  const store = await readStore();
  return store.users.map(({ id, username, role, createdAt, profileId, accountId }) => ({ id, username, role, createdAt, profileId, accountId }));
}

export async function findUserByUsername(username: string) {
  const store = await readStore();
  return store.users.find((user) => user.username === username);
}

export async function getSetupStatus() {
  const store = await readStore();
  return { setupRequired: !store.users.some((user) => user.role === "admin") };
}

export function normalizeUsername(value: unknown) {
  if (typeof value !== "string") return "";
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

export function validateCredentials(usernameValue: unknown, passwordValue: unknown) {
  const username = normalizeUsername(usernameValue);
  const password = typeof passwordValue === "string" ? passwordValue : "";
  if (!/^[\p{L}\p{N}._-]{3,32}$/u.test(username)) return { error: "نام کاربری باید ۳ تا ۳۲ حرف یا عدد داشته باشد؛ نقطه، خط تیره و زیرخط هم مجاز است." };
  if (password.length < 12 || password.length > 256) return { error: "گذرواژه باید حداقل ۱۲ نویسه داشته باشد." };
  return { username, password };
}

async function hashPassword(password: string, salt = randomBytes(16).toString("hex")) {
  const derived = await scrypt(password, salt, 64) as Buffer;
  return { passwordSalt: salt, passwordHash: derived.toString("hex") };
}

export async function passwordMatches(password: string, user: StoredUser) {
  const derived = await scrypt(password, user.passwordSalt, 64) as Buffer;
  const saved = Buffer.from(user.passwordHash, "hex");
  return saved.length === derived.length && timingSafeEqual(saved, derived);
}

export async function createUser(username: string, password: string, role: PanelRole = "user", assignment: { profileId?: string; accountId?: string } = {}): Promise<StoredUser> {
  const hash = await hashPassword(password);
  return { id: randomUUID(), username, role, createdAt: new Date().toISOString(), sessionVersion: 1, ...assignment, ...hash };
}

function base64Url(value: Buffer | string) {
  return Buffer.from(value).toString("base64url");
}

async function sign(payload: string) {
  return createHmac("sha256", await getSecret()).update(payload).digest("base64url");
}

export async function setSessionCookie(response: NextResponse, user: PanelUser) {
  const payload = base64Url(JSON.stringify({ sub: user.id, ver: user.sessionVersion, exp: Math.floor(Date.now() / 1000) + sessionLifetimeSeconds }));
  const token = `${payload}.${await sign(payload)}`;
  response.cookies.set(cookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" && process.env.APP_URL?.startsWith("https://"),
    sameSite: "lax",
    path: "/",
    maxAge: sessionLifetimeSeconds,
  });
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(cookieName, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
}

export async function readSessionUser(request: Request): Promise<PanelUser | null> {
  const cookieHeader = request.headers.get("cookie") || "";
  const token = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  if (!token) return null;
  let decodedToken: string;
  try { decodedToken = decodeURIComponent(token); } catch { return null; }
  const [payload, signature, ...extra] = decodedToken.split(".");
  if (!payload || !signature || extra.length) return null;
  const expected = Buffer.from(await sign(payload));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: string; ver?: number; exp?: number };
    if (!claims.sub || !claims.exp || claims.exp <= Math.floor(Date.now() / 1000)) return null;
    const store = await readStore();
    const user = store.users.find((candidate) => candidate.id === claims.sub && candidate.sessionVersion === claims.ver);
    if (!user) return null;
    const { id, username, role, createdAt, sessionVersion, profileId, accountId } = user;
    return { id, username, role, createdAt, sessionVersion, profileId, accountId };
  } catch {
    return null;
  }
}

export function withAccountAuth<R extends Request, A extends unknown[]>(
  handler: (request: R, ...args: A) => Response | Promise<Response>,
  accountIdFromRequest: (request: Request) => string | string[] | undefined | Promise<string | string[] | undefined>,
) {
  return async (request: R, ...args: A) => {
    const user = await readSessionUser(request);
    if (!user) return NextResponse.json({ error: "برای ادامه وارد حساب شو." }, { status: 401 });
    if (user.role !== "admin") {
      let requestedAccountId: string | string[] | undefined;
      try { requestedAccountId = await accountIdFromRequest(request.clone()); } catch { requestedAccountId = undefined; }
      const requestedIds = Array.isArray(requestedAccountId) ? requestedAccountId : requestedAccountId ? [requestedAccountId] : [];
      // proxyZernio forwards every query parameter (the last duplicate wins) and the raw body, so
      // every accountId/profileId the upstream could see must belong to this user, not just the first.
      const searchParams = new URL(request.url).searchParams;
      let body: { accountId?: unknown; profileId?: unknown } = {};
      if (request.method !== "GET" && request.method !== "HEAD") {
        const parsed = await request.clone().json().catch(() => ({}));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as typeof body;
      }
      const forwardedAccountIds = [...searchParams.getAll("accountId"), ...(body.accountId === undefined ? [] : [body.accountId])];
      if (!user.accountId || !requestedIds.length || [...requestedIds, ...forwardedAccountIds].some((id) => id !== user.accountId)) {
        return NextResponse.json({ error: "این حساب به حساب اجتماعی انتخاب‌شده دسترسی ندارد." }, { status: 403 });
      }
      const forwardedProfileIds = [...searchParams.getAll("profileId"), ...(body.profileId === undefined ? [] : [body.profileId])];
      if (forwardedProfileIds.some((id) => id !== user.profileId)) {
        return NextResponse.json({ error: "این پروفایل به حساب کاربری تو تخصیص داده نشده است." }, { status: 403 });
      }
    }
    return handler(request, ...args);
  };
}

export function withAuth<R extends Request, A extends unknown[]>(
  handler: (request: R, ...args: A) => Response | Promise<Response>,
  requiredRole?: PanelRole,
) {
  return async (request: R, ...args: A) => {
    const user = await readSessionUser(request);
    if (!user) return NextResponse.json({ error: "برای ادامه وارد حساب شو." }, { status: 401 });
    if (requiredRole && user.role !== requiredRole) return NextResponse.json({ error: "دسترسی مدیر لازم است." }, { status: 403 });
    return handler(request, ...args);
  };
}
