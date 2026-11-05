# OpenLinguist

A Stremio addon that shows subtitles in two languages at once. One language is on top and the other is underneath in italics. Subtitles come from OpenSubtitles, through Stremio's own OpenSubtitles v3 addon, so you don't need an API key.

```
I am speaking to my family now.
Le estoy hablando a mi familia.   ← italics
```

## Run it

You need Node 18 or newer. There are no dependencies to install.

```bash
npm start
```

Then open http://127.0.0.1:7000/configure, pick your two languages, and install:

- **Stremio app:** copy the manifest URL (`http://127.0.0.1:7000/eng-spa/manifest.json`), click **Add addon** on the Addons page, and paste it. Don't use a `stremio://` link with a local server. Stremio opens those as `https://` and drops the port.
- **web.stremio.com:** use the "Install on web.stremio.com" button. Your browser may ask permission for the page to reach your local network.

While you watch, choose **"English + Spanish"** (or your pair) in the player's subtitle menu. When files have different timing, you get these options:

- **(best match)** picks the file whose length is closest to your video. This needs the userscript (see below) to read the video's length. Without it, you get the top-ranked file.
- **(41:13, with recap)** and similar are the individual files, up to four, labelled with their length and whether they start with a "Previously on" recap.

If the subtitles start out of sync or drift as you watch, your stream probably has a recap or runs at a different speed from the file, which is common with PAL (25fps) copies. Try another option before adjusting the delay.

The server has to keep running while you watch.

## Hover a word to translate it

Hover a word in the italic line and a tooltip shows what it means in that sentence, with the whole line translated underneath. Translations come from DeepL, through the OpenLinguist server.

### 1. Add a DeepL key

Sign up for DeepL API Free at https://www.deepl.com/pro-api and copy your key from the account page. Put it in a file named `.env` in this folder, then restart the server:

```
DEEPL_API_KEY=your-key:fx
```

The free plan is a one-time allowance of 1,000,000 characters. Each new word you hover sends its subtitle line, about 50 characters, so that's around 20,000 lookups. Hovering the same word in the same line again is free until Stremio reloads.

### 2a. In the Stremio desktop app (Windows)

The app can't load scripts on its own, so a launcher starts it with a debugging port open and injects the script. You need Node 22 or newer. Quit Stremio first (right-click its tray icon, Quit), then:

```bash
npm run desktop
```

This also starts the addon server if `npm start` isn't running, so it's the only command you need. Keep its window open while you watch. It closes when Stremio quits.

**The trade-off:** while Stremio runs this way, any program on your PC can control the Stremio window through port 9317. Web pages can't. Quit Stremio to close the port, and start Stremio normally when you don't need hover. A Stremio update could also break the launcher.

### 2b. In a browser (web.stremio.com)

1. Install the Tampermonkey extension. In Chrome, open its extension details and turn on **Allow User Scripts**.
2. With the server running, open http://127.0.0.1:7000/openlinguist.user.js and click **Install**.

If you installed an earlier version in Tampermonkey, open http://127.0.0.1:7000/openlinguist.user.js again and click **Reinstall** or **Update** to get word colours.

### Other language pairs

Pick your pair and the language you're learning on the configure page. The script reads them from the server, so there's nothing to edit. Only the line in your learning language can be hovered.

### Limits

- Only subtitles drawn as page text can be hovered, like OpenLinguist's. Subtitles built into the video file are drawn by the desktop app's video player (mpv), so they can't.
- Clicking a word does nothing yet. Opening a dictionary is planned.

## Colour-coded words

Words that match between the two lines get the same subtle colour, so you can see which word means which. Words with no match stay plain. This uses the same userscript as hover translation, so set that up first. It runs on your own PC, works offline, and doesn't use your DeepL allowance.

Change it on the configure page, in **Hover and word colours**: on or off, palette, background tint or underline, and strength. Changes are saved straight away to `settings.json` and reach the player within a subtitle line or two, as the script checks for them when a line appears.

### How it matches words

The English and Spanish lines are separate translations, so they often say things differently. OpenLinguist uses a table of word translations learned from 1.5 million line pairs of real film and TV subtitles (`data/eng-spa.tsv.gz`, 2.3 MB). It takes the strongest pairs first, also matches names and similar spellings, and leaves a word plain rather than guess.

On a hand-checked sample of 25 real cues it hadn't been tuned on, 77 of its 78 links were right, and it found about 63% of the links a person marked. Most colours you see should be right, but a line that's been reworded a lot may have few or none.

### Language pairs

Only English + Spanish has a table, in either order. For other pairs, subtitles and hover work as usual and the words stay plain. To add a pair, download its file from OPUS OpenSubtitles and unzip it. The address looks like `https://object.pouta.csc.fi/OPUS-OpenSubtitles/v2018/moses/en-fr.txt.zip` (en-es is about 1.9 GB). Then run this, using OpenSubtitles language codes in the output name:

```bash
node --max-old-space-size=3072 tools/train-table.js OpenSubtitles.en-fr.en OpenSubtitles.en-fr.fr data/eng-fre.tsv.gz
```

For en-es this took about 4 minutes. Allow about 3 GB of free memory, and restart the server afterwards.

## How it picks and syncs the files

1. **Ranking.** It ranks subtitle files for each language. It boosts files whose release name matches your video's filename and files matched by file hash. It demotes files split across CDs and files labelled with the wrong episode. It then downloads the best eight for the top language and offers the best-ranked of each timing group, so the options differ from each other. "Best match" prefers a file matched by hash, then the closest length.
2. **Alignment.** The top-ranked file sets the timing. It downloads the eight best files for the second language and searches each for the speed and offset that line it up best. That covers a constant delay plus the 25fps↔23.976fps drift (×1.0427). It keeps the file that lines up best.
3. **Merging.** Each line in the second language is attached to the top-language line it overlaps most. A line that overlaps nothing is shown on its own.

The console shows what it chose, e.g.
`[merge] tt0903747:1:1 eng-spa#0: …orpheus.srt + …Pilot.srt (offset 275ms, speed x1.0000, overlap 98%)`.

## Settings (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `7000` | Port to listen on |
| `HOST` | `127.0.0.1` | Use `0.0.0.0` to accept connections from other devices |
| `PUBLIC_URL` | (from request) | Public base URL when hosted behind a proxy, e.g. `https://subs.example.com` |
| `UPSTREAM_URL` | `https://opensubtitles-v3.strem.io` | Where subtitle lists come from |
| `DEEPL_API_KEY` | (none) | DeepL key for hover translation. Put it in `.env` |
| `STREMIO_DEBUG_PORT` | `9317` | Debugging port `npm run desktop` opens in Stremio |
| `STREMIO_EXE` | `%LOCALAPPDATA%\Programs\Stremio\stremio-shell-ng.exe` | Where `npm run desktop` finds Stremio |

Stremio on phones and TVs only installs addons over HTTPS. To use it there, host the addon somewhere with HTTPS and set `HOST=0.0.0.0` and `PUBLIC_URL`.

## Limitations

- One speed plus one offset can't fix a different *cut* of the video, such as a TV broadcast against a Blu-ray. If the bottom line drifts partway through, try another option in the subtitle menu.
- Length is only a hint, as a file's last line isn't always at the end of the video. "Best match" can pick wrong, and if no file was timed for your stream, none of the options will stay in sync.
- The bottom line is always in italics. That's the one style both Stremio players are known to render.
- The userscript tells the two languages apart by those italics. If a top-language subtitle has its own italic words, they're treated as the bottom language, which can leave that line's colours missing or wrong.

## Tests

```bash
npm test
```
