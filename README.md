# Matin Social Panel

📘 **راهنمای فارسی:** [راهنما.md](راهنما.md)

A local, Persian-language social media workspace powered by Zernio. The Zernio API key is used only by server routes and is never sent to the browser.

## Features

- **Accounts:** load Zernio profiles and connected accounts; start OAuth connections for Instagram, Facebook, X, LinkedIn, TikTok, YouTube, Pinterest, Threads, Reddit, Google Business, Snapchat, WhatsApp, Discord, and Slack.
- **Publishing:** prepare posts for one or more connected accounts, upload photos/videos through Zernio's presigned media flow, publish now, or schedule with the Asia/Tehran timezone. Includes feed, Reel, and Story targets where the selected platform supports them.
- **Inbox:** view conversations and messages, reply to DMs, review comments, and reply to comments.
- **Analytics:** review account totals, daily engagement, follower counts, and top posts over a selected date range.
- **Automations:** create, pause, resume, and remove Instagram comment-to-DM and story-reply automations.
- **OAuth return:** show connection success/failure and confirm the returned account appears in the selected Zernio profile.

What appears and works depends on the Zernio plan, enabled API scopes, connected platform, and the platform's account eligibility. Meta features generally require a Business or Creator Instagram account. Analytics and inbox data may be unavailable until enabled for the Zernio profile.

## Requirements

- Node.js and npm
- A Zernio API key and an active Zernio profile

## Setup on Windows

Copy `.env.example` to `.env.local`, then set your API key and local callback URL:

```env
ZERNIO_API_KEY=your_real_key_here
ZERNIO_BASE_URL=https://zernio.com/api/v1
APP_URL=http://localhost:3000
```

Install dependencies and start the local workspace:

```powershell
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Keep the server running while connecting accounts so the OAuth return can reach this machine.

## Panel logins

On the first visit, create the administrator login. There is no built-in default password. The administrator can then create separate user logins, choose one connected social account for each user, and reset passwords from **حساب کاربری**. The administrator can also change an existing user's assigned account; this closes that user's existing sessions. Regular users only see and operate the account assigned to them. Each user can change their own password there as well. User passwords are stored as salted scrypt hashes in the ignored `.data/users.json` file; the signing key is created in `.data/session-secret`. Back up `.data` securely if you need to preserve local logins across machine changes.

**Forgot a password (including the administrator's)?** Run this in the project folder, then type the new password twice (it is hidden while typing):

```powershell
npm run reset-password -- <username>
```

Run it without a username to list the existing users. It changes only that user's password and signs out their existing sessions.

Sessions use an HTTP-only, same-site cookie and expire after eight hours. All Zernio and account-connection API routes require a valid login; administrator routes also check the user's role on the server. Passwords must be at least 12 characters. Resetting a user's password ends that user's existing sessions.

For a production build, use `npm run build` and `npm run start`. Production output uses `.next-prod`, separate from the `.next` directory used by `next dev`, so a production build does not overwrite an open development server.

## Security and account access

- Keep `ZERNIO_API_KEY` in `.env.local`; never add it to client-side code or commit it.
- OAuth tokens and platform credentials remain with Zernio; this panel does not keep its own token database.
- The app uses the browser's local storage only to remember the selected Zernio profile ID.
- Connecting an account requires approving access on the platform's own consent screen.
- Publishing, replying, deleting an automation, or activating an automation changes the connected social account. Review the selected account and content before using those actions.
- This is a local single-user workspace. Do not expose it publicly without adding authentication and deployment security.

## API routes

The browser calls these local routes; they attach the server-side Zernio key:

```text
/api/zernio/profiles
/api/zernio/accounts
/api/zernio/posts
/api/zernio/media/presign
/api/zernio/analytics/dashboard
/api/zernio/inbox/conversations
/api/zernio/inbox/conversations/[conversationId]/messages
/api/zernio/inbox/comments
/api/zernio/inbox/comments/[postId]
/api/zernio/comment-automations
/api/zernio/comment-automations/[automationId]
/api/connect/[platform]
/api/connect/callback
```

## Troubleshooting

- If profiles cannot load, check the API key and base URL in `.env.local`, then restart the server.
- If OAuth returns to the wrong place, make sure the Zernio callback configuration uses the same `APP_URL` and that the local server is running.
- A connected account may not expose every feature. Check its platform type, permissions, Zernio plan, and Meta account type.
