# Gmail auto-capture — owner setup (one-time)

The code is complete and shipped **gated**: the "Connect Gmail" panel on `/tracker` stays hidden and
every endpoint no-ops until you provision Google OAuth credentials. These are the steps only you can
do (they require your Google account + Vercel dashboard). ~10–15 minutes.

## 1. Google Cloud project + Gmail API
1. Go to <https://console.cloud.google.com/> → create a project (e.g. "Seen") or pick an existing one.
2. **APIs & Services → Library → enable "Gmail API".**

## 2. OAuth consent screen
1. **APIs & Services → OAuth consent screen → External.**
2. App name "Seen", your support email, app logo/links as you like.
3. **Scopes → add these two** (both are all we request — no message-body access):
   - `.../auth/gmail.metadata`  (headers only — From/Subject/Date)
   - `.../auth/userinfo.email`
4. While in **Testing**, add your own Gmail under **Test users** to try it immediately.
5. To open it to all users later, **Publish** and submit for verification. Note: `gmail.metadata`
   is a *sensitive* scope (needs Google's standard OAuth verification) but **not** a *restricted*
   scope — so it avoids the expensive CASA security assessment that `gmail.readonly` (body access)
   would require. This is why the classifier is deliberately headers-only.

## 3. OAuth client credentials
1. **APIs & Services → Credentials → Create credentials → OAuth client ID → Web application.**
2. **Authorized redirect URIs** — add exactly:
   - `https://seenjobs.io/api/gmail?action=callback`
   - (optional, for preview testing) your Vercel preview URL + `/api/gmail?action=callback`
3. Copy the **Client ID** and **Client secret**.

## 4. Vercel environment variables
Add these in **Vercel → Project → Settings → Environment Variables**, then redeploy:

| Variable | Value |
| --- | --- |
| `GOOGLE_OAUTH_CLIENT_ID` | the client ID from step 3 |
| `GOOGLE_OAUTH_CLIENT_SECRET` | the client secret from step 3 |
| `GMAIL_TOKEN_KEY` | a long random string (used to AES-256-GCM-encrypt stored refresh tokens). Generate with `openssl rand -base64 48`. Keep it stable — rotating it invalidates existing connections. |
| `GMAIL_REDIRECT_URI` | *(optional)* defaults to `https://<host>/api/gmail?action=callback`; set it if your callback host differs. |

That's it. Once those are set and deployed, the **Connect Gmail** panel appears on `/tracker`, the
daily `sync_all` cron starts pulling likely-hiring mail, and users can confirm captured suggestions
into their tracker. Nothing touches a company's aggregate score until a user confirms a suggestion.
