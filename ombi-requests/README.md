# Ombi Requests

A Greasemonkey/Tampermonkey-compatible userscript that adds a floating **Request in Ombi** button to IMDb title pages, Letterboxd film pages, and Rotten Tomatoes movie and TV pages.

> This is an unofficial community project and is not affiliated with Ombi, IMDb, Letterboxd, Rotten Tomatoes, Radarr, or Sonarr.

## Features

- Movies on IMDb and Letterboxd, including Letterboxd film subpages and member-review views
- TV series on IMDb (episode pages are mapped to their parent series)
- Movies and TV series on Rotten Tomatoes (season and episode pages are mapped to their parent series)
- Exact IMDb-ID matching where available
- Title-and-year matching for Rotten Tomatoes and Letterboxd pages that omit IMDb/TMDb IDs
- Ambiguous title/year matches open Ombi for manual selection
- Existing availability/request status
- One-click requests without a confirmation dialog
- Optional Radarr/Sonarr quality-profile overrides
- Full-series TV requests
- Reverse-proxy base paths such as `https://example.com/ombi`
- Ombi URL, API key, and optional username stored in the userscript manager

## Install

1. Install a userscript manager: Violentmonkey or Tampermonkey in Chrome; Greasemonkey, Violentmonkey, or Tampermonkey in Firefox.
2. Open the [installable userscript](https://github.com/probably-runs/grease-scripts/raw/main/ombi-requests/dist/ombi-request.user.js) in that browser and approve the userscript installation.
3. Visit an IMDb title, Letterboxd film, or Rotten Tomatoes movie/TV page and click **Set up Ombi**.
4. Enter the Ombi URL and API key from **Ombi > Settings > Configuration > General**. The username and Radarr/Sonarr quality-profile override are optional. The settings dialog stays open after a successful test so the result is visible.

Ombi API keys provide administrator-level API access. The script stores the key only in the userscript manager. Prefer HTTPS when the Ombi URL is reachable outside the local network.

Existing users can update the installed script from the same link. Its userscript name, namespace, and saved Ombi settings stay the same; version 1.2.0 adds Rotten Tomatoes page permissions. TV requests still request the full series, including when browsing a Rotten Tomatoes season or episode. If a season or episode page omits its parent-series metadata, the button is hidden.

## Permissions and privacy

- `GM.getValue` and `GM.setValue` store the Ombi URL, API key, optional username, and profile choices in the userscript manager. This storage is local to the browser profile but is not a password vault.
- `GM.xmlHttpRequest` sends the API key only to the Ombi URL entered in the settings dialog.
- `@connect *` is required because self-hosted Ombi instances can use arbitrary hostnames, LAN addresses, ports, and reverse-proxy paths. Security-conscious users can replace `*` with their own Ombi hostname before installation.
- The script runs only on IMDb title pages, Letterboxd pages, and Rotten Tomatoes movie/TV pages; it does not read browser cookies, passwords, or history.

## Development

```text
npm test
npm run build
npm run check
```

The generated cross-browser userscript is `dist/ombi-request.user.js`.

For browser smoke tests, run `npm --workspace ombi-requests run fixtures`, then open the printed localhost URL. The fixture uses sanitized Rotten Tomatoes markup and a mock Ombi API. Use `?page=movie`, `?page=series`, `?page=season`, or `?page=episode`; add `&schema=0` to test movie/series DOM fallbacks or `&ambiguous=1` to test manual selection. Clicking the request button sends only a mock request. Stop the server with Ctrl+C.

The userscript namespace is stable and does not depend on the repository location. Set `OMBI_REQUEST_REPOSITORY_URL` to the public repository URL and `OMBI_REQUEST_REPOSITORY_DIRECTORY` to its subdirectory before running `npm run build`; the builder adds `@homepageURL` and `@supportURL` without changing the script identity.
