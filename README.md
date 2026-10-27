# Follow me here: My own personal link tree.

I figured instead of using the generic link websites, I would make my own personal one. Live at [toppirl.com](https://toppirl.com).

## How It's Made:

HTML / CSS, with no framework and no build step. A few small Netlify functions: one checks Twitch so the page can show when I'm live, the rest serve the gear list and let me edit it from `/admin`.

```
public/                  everything that gets published
  index.html             the page: profile, social icons, link cards, retro grid
  gear.html              /gear: the gear I use, grouped by category, with an affiliate disclosure
  404.html               shown for any missing URL
  css/style.css          all styles, including the grid; base colors are variables at the top
  js/live.js             checks Twitch every minute and switches the page into live mode
                         (red grid, LIVE badge, uptime line, Watch on Twitch card)
  js/gear.js             loads /api/gear and draws the gear page's cards (or its empty or error message)
  admin/index.html       /admin: sign-in, not linked from the site (with js/admin.js, css/admin.css)
  img/                   favicons, apple-touch-icon, og-image (link previews)
netlify/functions/
  twitch-live.mjs        /api/twitch-live: asks Twitch if I'm streaming
  gear.mjs               /api/gear: the public gear list, drafts left out
  gear-image.mjs         /api/gear/img/<id>: gear photos
  admin-*.mjs            /api/admin/*: sign-in and sign-out, and editing the gear list and photos
netlify/lib/
  auth.mjs               admin sign-in, shared by the admin functions
  gear-store.mjs         the gear list and photos in Netlify Blobs, and the rules a save must pass
netlify.toml             publish folder and security headers
package.json             the functions' npm packages, pinned (package-lock.json pins the rest)
```

## Editing the page

- **Link cards:** in `public/index.html`, paste one of the two templates from the comment above the link list into `<ul class="links">`, after the live card. The thumbnail is either an `<img class="link-thumb">` (a square image, 112px or larger, saved in `public/img/`) or an icon tile.
- **Avatar:** save a square photo (192px or larger) as `public/img/avatar.jpg` and swap the `JT` placeholder for the `<img>` line in the comment above it.
- **Social icons:** each one is an inline SVG inside `<ul class="socials">`.
- **Gear:** edited from `/admin` and saved to Netlify Blobs, not the repo. See [Managing gear](#managing-gear).
- **Colors:** change the base colors (`--bg`, `--surface`, `--accent`, `--live`, …) at the top of `public/css/style.css`. The card, glow and grid colors below them are mixed from those, so they follow automatically.

To preview, open `public/index.html` in a browser. Everything works except the live check, which needs Netlify (the page just stays in its offline look). With Node installed, `npx netlify-cli@27.12.1 dev` runs the functions locally too, at http://localhost:8888; the gear page and `/admin` need it.

## Twitch live indicator

1. Go to the [Twitch developer console](https://dev.twitch.tv/console/apps) and choose **Register Your Application**: any name, OAuth redirect URL `http://localhost` (required but unused), category **Website Integration**, client type **Confidential**.
2. Copy the **Client ID**, then choose **New Secret** and copy the secret.
3. In Netlify, open **Site configuration > Environment variables** and add `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` (mark the secret as secret). `TWITCH_LOGIN` is optional and defaults to `toppirl`.
4. Redeploy, then open `https://toppirl.com/api/twitch-live`. It should say `{"live":false}` while offline.

Never put the secret in the repo. For `netlify dev`, it can go in a `.env` file, which Git ignores.

## Managing gear

The gear list at [toppirl.com/gear](https://toppirl.com/gear) is edited from **`/admin`** ([toppirl.com/admin](https://toppirl.com/admin)), which nothing on the site links to. For now that page only signs you in; the editor comes next.

### Setting the admin password (once)

1. In Netlify, open **Site configuration > Environment variables** and choose **Add a variable**.
2. Key `ADMIN_PASSWORD`. Tick **Contains secret values**, and give it the **Functions** scope.
3. Set a value for **Production**, and one for **Deploy Previews** too if you want to sign in on PR previews (they can differ). Use a long passphrase that you don't use anywhere else.
4. Redeploy (functions only see a changed variable after a deploy). For a PR preview, push a commit or choose **Retry deploy** on it.

Changing the password signs every browser out. Without it, `/admin` says sign-in isn't set up yet. Five wrong passwords from one address lock sign-in there for 15 minutes, and 50 attempts in an hour lock it for everyone for up to an hour.

### What's stored, and where

Everything lives in [Netlify Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/), the site's own storage (browse it in the Netlify UI under **Blobs**), not in the repo:

| Store | Key | What |
|---|---|---|
| `gear` | `gear.json` | the list: categories and items in display order, with drafts, a revision number and when it was last saved |
| `gear` | `img/<id>` | the photos, as uploaded (JPEG, PNG or WebP, 512 KB at most) |
| `admin` | `signing-key` | signs the sign-in cookie; made on first use |
| `admin` | `attempts/…` | recent sign-in attempts, for the lockout |

Only the production site uses those stores. Deploy previews, branch deploys and `netlify dev` use **`gear-preview`** and **`admin-preview`** instead, so testing never touches the live list. All previews share that one copy. `netlify dev` keeps its copy on disk under `.netlify/` (Git ignores it).

The public list is cached by Netlify's CDN until a save clears it, so edits show straight away. A photo is deleted when a save leaves it unused.

### Running it locally

Put a made-up password in `.env` (Git ignores it), then run `npx netlify-cli@27.12.1 dev` and open http://localhost:8888/admin:

```
ADMIN_PASSWORD=any-long-test-password
```

## Deploying (Netlify + toppirl.com)

1. In Netlify, import `toppirl/toppirl-web` from GitHub, or relink the old site to this repo. `netlify.toml` supplies the settings, so leave the build command empty. Every push to `main` deploys, and other branches get preview links.
2. In **Domain management**, add `toppirl.com` and let it add `www` too. Because the domain lapsed and was bought back, Netlify may ask for a TXT record to prove ownership.
3. Keep DNS at Namecheap; don't switch to Netlify's nameservers, or the email forwarding (MX records) stops and the NAS records would need recreating. Under **Advanced DNS**, add:

   | Type | Host | Value |
   |---|---|---|
   | ALIAS | `@` | `apex-loadbalancer.netlify.com` (or an A record to `75.2.60.5`) |
   | CNAME | `www` | `<your-site>.netlify.app` |

   Use the exact values Netlify's domain page shows if they differ. Leave `drive`, `photos`, `nas` and the mail records alone; they point at `drive.toppirl.com`, not at the root domain, so the site doesn't affect them.
4. Netlify issues the HTTPS certificate once DNS has updated, usually within an hour.

## Optimizations

I will slowly work on making this more fine tuned as I develop it and master my crafts.

## Lessons Learned:

Allows me to work on solving common CSS & HTML issues that might come up from not using it everyday.
