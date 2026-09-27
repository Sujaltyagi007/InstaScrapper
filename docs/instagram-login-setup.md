# Connect your Instagram account for posting (no Facebook Page)

> **Needs a Facebook account for step 2.** Meta only lets developers register while logged into Facebook. The person who creates the Meta app (steps 2–3) must have one. The Instagram account being connected doesn't: it only has to accept the tester invite (step 4). If the app owner is someone else, they add your Instagram username in step 4 and send you the App ID and secret for step 5.

This connects the Instagram account your reels get posted to, using Instagram's **official** API ("Instagram API with Instagram Login"). You need **no Facebook Page** and **no credit card**, and because it's your own account, no app review.

Takes about 10 minutes.

## 1. Make your Instagram a Creator account
Instagram app → **Settings** → **Account type and tools** → **Switch to professional account** → choose **Creator**. It stays public, and you can switch back later.

## 2. Create a Meta developer app
1. Go to **developers.facebook.com** and log in (register as a developer if asked).
2. **My Apps → Create app**.
3. For the use case, pick the one about **managing messaging and content on Instagram**.
4. Finish creating the app. It starts in **Development** mode, which is fine: development mode works for accounts that have a role on the app, and yours will.

## 3. Set up Instagram Login inside the app
1. In the app dashboard, open **Instagram → API setup with Instagram login**.
2. Under **Business login settings**, add this **OAuth redirect URI** exactly:
   ```
   https://<your-app-domain>/api/ig/callback
   ```
   Use your **stable** Vercel domain (e.g. `your-app.vercel.app`), not a one-off preview URL, because the address must match exactly every time. Instagram only accepts `https`, so `localhost` won't work.
3. On the same page, copy the **Instagram App ID** and **Instagram App Secret**.
   These are **not** the same as the app ID at the top of the dashboard (`META_APP_ID`).

## 4. Add yourself as a tester
1. App dashboard → **App roles → Roles** → **Instagram testers** → add your Instagram username.
2. Accept the invite: open the Instagram website → **Settings → Apps and websites → Tester invites** → **Accept**.

## 5. Set the environment variables
Add these in **Vercel → Project → Settings → Environment Variables** (and in `.env` for local builds):

| Name | Value |
|---|---|
| `INSTAGRAM_APP_ID` | the Instagram App ID from step 3 |
| `INSTAGRAM_APP_SECRET` | the Instagram App Secret from step 3 |
| `APP_URL` | `https://<your-app-domain>`, the same domain as the redirect URI |

Redeploy after adding them.

## 6. Connect
Open the app → **Settings** → **Instagram posting account** → **Connect Instagram** → log in and allow. You'll land back in Settings with your `@username` shown as ACTIVE.

## 7. Test posting (optional)
Check the connection without posting anything:
```
curl -H "Authorization: Bearer YOUR_CRON_SECRET" "https://<your-app-domain>/api/dev/publish-test?username=YOUR_HANDLE&dry=1"
```
Post a real test reel (use the `url` returned by `/api/dev/render-test`), then delete it from Instagram afterwards:
```
curl -H "Authorization: Bearer YOUR_CRON_SECRET" "https://<your-app-domain>/api/dev/publish-test?username=YOUR_HANDLE&url=VIDEO_URL&caption=test"
```

## If something goes wrong
- **"Invalid redirect_uri":** the URI in step 3 doesn't exactly match `APP_URL` + `/api/ig/callback` (check `https`, trailing slashes, and the domain).
- **"Insufficient developer role" / can't log in:** the tester invite in step 4 hasn't been accepted yet.
- **The account shows REAUTH_REQUIRED:** the token was revoked or couldn't renew. Click **Reconnect**.
- **Tokens last 60 days** and renew automatically through the daily `/api/cron/refresh-meta-tokens` job, as long as it keeps running.
