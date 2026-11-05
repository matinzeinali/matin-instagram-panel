#!/usr/bin/env node
// Reset a panel user's password from the command line (for when the admin password is forgotten).
//
//   npm run reset-password -- <username>
//   npm run reset-password -- <username> --data-dir .data-preview
//
// The new password is typed twice (hidden) and stored with the same scrypt format as src/lib/auth.ts.
// Existing sessions of that user are signed out.
import { randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

function parseArgs(argv) {
  const args = { username: "", dataDir: process.env.AUTH_DATA_DIR?.trim() || ".data" };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--data-dir") args.dataDir = argv[++index] || args.dataDir;
    else if (!args.username) args.username = argv[index];
  }
  args.username = args.username.normalize("NFKC").trim().toLocaleLowerCase("en-US");
  return args;
}

/** Read one line; hide the typed characters when running in a terminal. */
function ask(question, lines) {
  if (!process.stdin.isTTY) return Promise.resolve(lines.shift() ?? "");
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          stdin.setRawMode(false); stdin.pause(); stdin.off("data", onData);
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (char === "\u0003") { process.stdout.write("\n"); process.exit(130); }
        // Echo a star per character so the user can see the keystrokes arrive.
        if (char === "\u007f" || char === "\b") {
          if (value) { value = value.slice(0, -1); process.stdout.write("\b \b"); }
        } else if (char >= " ") {
          value += char;
          process.stdout.write("*");
        }
      }
    };
    stdin.on("data", onData);
  });
}

async function readPipedLines() {
  if (process.stdin.isTTY) return [];
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  return text.split(/\r?\n/);
}

const { username, dataDir } = parseArgs(process.argv.slice(2));
const usersPath = path.resolve(process.cwd(), dataDir, "users.json");

const store = JSON.parse(await readFile(usersPath, "utf8").catch(() => {
  console.error(`فایل کاربران پیدا نشد: ${usersPath}`);
  process.exit(1);
}));
const users = Array.isArray(store.users) ? store.users : [];

if (!username) {
  console.error("نام کاربری را بده. مثال: npm run reset-password -- adimn");
  console.error(`کاربران موجود: ${users.map((user) => `${user.username} (${user.role})`).join("، ") || "—"}`);
  process.exit(1);
}
const target = users.find((user) => user.username === username);
if (!target) {
  console.error(`کاربر «${username}» پیدا نشد. کاربران موجود: ${users.map((user) => user.username).join("، ")}`);
  process.exit(1);
}

const piped = await readPipedLines();
const password = await ask(`گذرواژهٔ تازه برای ${username} (حداقل ۱۲ نویسه): `, piped);
if (password.length < 12 || password.length > 256) {
  console.error("گذرواژه باید بین ۱۲ تا ۲۵۶ نویسه باشد. چیزی تغییر نکرد.");
  process.exit(1);
}
const confirmation = await ask("تکرار گذرواژه: ", piped);
if (confirmation !== password) {
  console.error("دو گذرواژه یکسان نیستند. چیزی تغییر نکرد.");
  process.exit(1);
}

const passwordSalt = randomBytes(16).toString("hex");
target.passwordSalt = passwordSalt;
target.passwordHash = (await scrypt(password, passwordSalt, 64)).toString("hex");
target.sessionVersion = (Number(target.sessionVersion) || 0) + 1;

const temporaryPath = `${usersPath}.${randomUUID()}.tmp`;
await writeFile(temporaryPath, JSON.stringify(store, null, 2), { mode: 0o600 });
await rename(temporaryPath, usersPath);
console.log(`گذرواژهٔ «${username}» عوض شد. نشست‌های قبلی این کاربر بسته شدند؛ حالا با گذرواژهٔ تازه وارد شو.`);
