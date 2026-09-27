# Your steps

All free. No credit card.

## 1. Accounts & keys
- [x] **Appwrite:** restored
- [ ] **Appwrite bucket:** Storage → your bucket → Settings → Permissions → add role **Any** → tick **Read** → Update
      (right now videos and thumbnails give "401 no permission", so Instagram can't download them)
- [x] **Gemini key** (tested, works)
- [x] **Pexels key** (tested, works)
- [ ] **Instagram:** Settings → Account type → switch to **Creator**
- [ ] **Burner Instagram account** → Settings → Sessions → add it (needed for trend view counts; never your real account)

## 1b. Keep your real account safe (burner rules)
- [ ] **Never** log into the burner on your phone's Instagram app or in the browser where your real account is logged in. If you already did: log the burner out there and remove it from the app's account list ("Remove account from this device"). Don't add it to Accounts Center.
- [ ] The burner has its own email (not linked to your real one) and doesn't follow, like or message your real account. Don't post from it.
- [ ] Add the burner only in this app: **Sessions → Log in**, proxy field **empty** (the app gives it its own fixed IP automatically).
- [ ] If Instagram asks the burner for a code by email, type it in the app's login box. If it asks for a checkpoint, don't open it on your phone; tell me.

## 2. Posting: Send to phone ✅ (chosen)
No Meta app needed. You'll get a push notification with the video + caption and post from the Instagram app.
- [ ] Install the **ntfy** app on your phone (free) → subscribe to a topic name only you know
- [ ] In the web app: Notifications → add an **ntfy** channel with that same topic

## 3. Vercel → Settings → Environment Variables
- [ ] `GEMINI_API_KEY`
- [ ] `PEXELS_API_KEY`
- [ ] `APP_URL` = your Vercel address, e.g. `https://your-app.vercel.app` (the phone notification links to it)

## 4. Deploy
- [ ] Commit (commit `package.json`, `pnpm-lock.yaml` and `pnpm-workspace.yaml` together) → push
- [ ] Wait for Vercel to finish deploying

## 5. Test on Vercel & send me the output
Replace `SECRET`, `YOUR-DOMAIN`:
```
curl -H "Authorization: Bearer SECRET" https://YOUR-DOMAIN/api/dev/render-test
curl -H "Authorization: Bearer SECRET" https://YOUR-DOMAIN/api/dev/voice-test
```
- [ ] Paste both results to me (cut the long `previewDataUrl` line)

## 6. Try the Studio
- [ ] Open the app → **Studio** → set your niche → add 5–10 accounts (or tap *Suggest accounts*)
- [ ] **Sound bank** (on Studio): add ~20 music tracks + ~10 effects (whoosh, pop, riser, ding) from Pixabay Music / Sound Effects. Upload the file (≤4 MB) or paste its direct download link, plus the page link as licence
- [ ] Approve an idea → the Reels card shows each step; the finished reel appears in ~4-5 min (keep the page open until the scheduler below is set up)
- [ ] Open the reel → watch it → **Send now** (or **Send at best time**) → on your phone: download the video, copy the caption, post in Instagram, turn on the **AI label** → back in the app: **Mark as posted**

## 7. Scheduler (cron-job.org, free)
- [ ] New job: `https://YOUR-DOMAIN/api/cron/reels`, every 5 min, header `Authorization: Bearer SECRET`, timeout 300s

## 8. Optional: Gemini limits
- [ ] aistudio.google.com → **Rate limits**: send me the requests/day for the Gemini models (free tier is small, e.g. 20/day for gemini-3.8-flash; the app switches to other models when one runs out)
   