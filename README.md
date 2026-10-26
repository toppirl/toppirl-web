# Follow me here: My own personal link tree.

I figured instead of using the generic link websites, I would make my own personal one. Live at [toppirl.com](https://toppirl.com).

## How It's Made:

HTML / CSS, with no framework and no build step. One small Netlify function checks Twitch so the page can show when I'm live.

```
public/                  everything that gets published
  index.html             the page: profile, social icons, link cards
  404.html               shown for any missing URL
  css/style.css          all styles; colors are variables at the top
  js/live.js             reveals the "Live now" card while streaming
  img/                   favicons, apple-touch-icon, og-image (link previews)
netlify/functions/
  twitch-live.mjs        /api/twitch-live: asks Twitch if I'm streaming
netlify.toml             publish folder and security headers
```

## Editing the page

- **Link cards:** in `public/index.html`, paste one of the two templates from the comment above `<ul class="links">` into the list, after the live card. The thumbnail is either an `<img class="link-thumb">` (a square image, 112px or larger, saved in `public/img/`) or an icon tile.
- **Avatar:** save a square photo (192px or larger) as `public/img/avatar.jpg` and swap the `JT` placeholder for the `<img>` line in the comment above it.
- **Social icons:** each one is an inline SVG inside `<ul class="socials">`.
- **Colors:** change the variables in the `:root` block at the top of `public/css/style.css`.

To preview, open `public/index.html` in a browser. Everything works except the live check, which needs Netlify (the card just stays hidden). With Node installed, `npx netlify-cli dev` runs the function locally too.

## Twitch live indicator

1. Go to the [Twitch developer console](https://dev.twitch.tv/console/apps) and choose **Register Your Application**: any name, OAuth redirect URL `http://localhost` (required but unused), category **Website Integration**, client type **Confidential**.
2. Copy the **Client ID**, then choose **New Secret** and copy the secret.
3. In Netlify, open **Site configuration > Environment variables** and add `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` (mark the secret as secret). `TWITCH_LOGIN` is optional and defaults to `toppirl`.
4. Redeploy, then open `https://toppirl.com/api/twitch-live`. It should say `{"live":false}` while offline.

Never put the secret in the repo. For `netlify dev`, it can go in a `.env` file, which Git ignores.

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
