# Ombi Request for IMDb & Letterboxd

A Greasemonkey/Tampermonkey-compatible userscript that adds a floating **Request in Ombi** button to IMDb title pages and Letterboxd film pages.

> This is an unofficial community project and is not affiliated with Ombi, IMDb, Letterboxd, Radarr, or Sonarr.

## Features

- Movies on IMDb and Letterboxd, including Letterboxd film subpages and member-review views
- TV series on IMDb (episode pages are mapped to their parent series)
- Exact IMDb-ID matching where available
- Title-and-year fallback for Letterboxd review pages that omit IMDb/TMDb IDs
- Existing availability/request status
- One-click requests without a confirmation dialog
- Optional Radarr/Sonarr quality-profile overrides
- Full-series TV requests
- Reverse-proxy base paths such as `https://example.com/ombi`
- Ombi URL, API key, and optional username stored in the userscript manager

## Install

1. Install a userscript manager: Violentmonkey or Tampermonkey in Chrome; Greasemonkey, Violentmonkey, or Tampermonkey in Firefox.
2. Open the [installable userscript](https://github.com/probably-runs/grease-scripts/raw/main/ombi-requests/dist/ombi-request.user.js) in that browser and approve the userscript installation.
3. Visit an IMDb title or Letterboxd film page and click **Set up Ombi**.
4. Enter the Ombi URL and API key from **Ombi > Settings > Configuration > General**. The username and Radarr/Sonarr quality-profile override are optional. The settings dialog stays open after a successful test so the result is visible.

Ombi API keys provide administrator-level API access. The script stores the key only in the userscript manager. Prefer HTTPS when the Ombi URL is reachable outside the local network.

## Permissions and privacy

- `GM.getValue` and `GM.setValue` store the Ombi URL, API key, optional username, and profile choices in the userscript manager. This storage is local to the browser profile but is not a password vault.
- `GM.xmlHttpRequest` sends the API key only to the Ombi URL entered in the settings dialog.
- `@connect *` is required because self-hosted Ombi instances can use arbitrary hostnames, LAN addresses, ports, and reverse-proxy paths. Security-conscious users can replace `*` with their own Ombi hostname before installation.
- The script runs only on IMDb title pages and Letterboxd pages; it does not read browser cookies, passwords, or history.

## Development

```text
npm test
npm run build
npm run check
```

The generated cross-browser userscript is `dist/ombi-request.user.js`.

The userscript namespace is stable and does not depend on the repository location. Set `OMBI_REQUEST_REPOSITORY_URL` to the public repository URL and `OMBI_REQUEST_REPOSITORY_DIRECTORY` to its subdirectory before running `npm run build`; the builder adds `@homepageURL` and `@supportURL` without changing the script identity.
