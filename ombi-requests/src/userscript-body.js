(function runOmbiRequestUserscript() {
    "use strict";

    const Core = globalThis.OmbiRequestCore;
    const CONFIG_KEY = "ombi-request-config-v1";
    const APP_ID = "ombi-request-anywhere";
    const state = {
        busy: false,
        config: null,
        details: null,
        media: null,
        status: "setup",
    };

    async function loadConfig() {
        const stored = await GM.getValue(CONFIG_KEY, "");
        if (!stored) return null;
        if (typeof stored === "string") {
            try {
                return JSON.parse(stored);
            } catch {
                return null;
            }
        }
        // Keep compatibility with the 1.0.0 build, which stored the object directly.
        return stored;
    }

    async function saveConfig(config) {
        await GM.setValue(CONFIG_KEY, JSON.stringify(config));
    }

    function gmRequest(options) {
        return new Promise((resolve, reject) => {
            GM.xmlHttpRequest({
                ...options,
                onload: resolve,
                onerror: () => reject(new Error("Could not reach Ombi.")),
                ontimeout: () => reject(new Error("Ombi took too long to respond.")),
                timeout: 15000,
            });
        });
    }

    async function api(path, options = {}) {
        const config = options.config || state.config;
        if (!config) throw new Error("Connect Ombi first.");
        const headers = {
            Accept: "application/json",
            ApiKey: config.apiKey,
            ...(options.body ? { "Content-Type": "application/json" } : {}),
            ...(config.userName ? { UserName: config.userName } : {}),
        };
        const response = await gmRequest({
            method: options.method || "GET",
            url: Core.endpoint(config.baseUrl, path),
            headers,
            data: options.body ? JSON.stringify(options.body) : undefined,
        });

        let payload = null;
        if (response.responseText) {
            try {
                payload = JSON.parse(response.responseText);
            } catch {
                payload = response.responseText;
            }
        }
        if (response.status < 200 || response.status >= 300) {
            const reason = Core.requestErrorMessage(payload, `Ombi returned HTTP ${response.status}.`);
            const error = new Error(reason);
            error.status = response.status;
            throw error;
        }
        return payload;
    }

    function documentInput() {
        const jsonLdTexts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
            .map((node) => node.textContent || "")
            .filter(Boolean);
        const externalUrls = Array.from(document.querySelectorAll("a[href]"))
            .map((node) => node.href)
            .filter((href) => /imdb\.com\/title\/tt|themoviedb\.org\/movie\//i.test(href));
        const tmdbNode = document.querySelector("[data-tmdb-id]");
        const imdbSeriesNode = document.querySelector('[data-testid="hero-title-block__series-link"]');
        const ogTitleNode = document.querySelector('meta[property="og:title"]');

        const liveInput = {
            externalUrls,
            heading:
                document.querySelector("main h1")?.textContent ||
                document.querySelector("h1")?.textContent ||
                "",
            hostname: location.hostname,
            jsonLd: Core.parseJsonLdTexts(jsonLdTexts),
            ogTitle: ogTitleNode?.getAttribute("content") || "",
            pageUrl: location.href,
            pathname: location.pathname,
            series: imdbSeriesNode ? {
                name: imdbSeriesNode.textContent || "",
                url: imdbSeriesNode.href || imdbSeriesNode.getAttribute("href") || "",
            } : null,
            tmdbDataId: tmdbNode?.getAttribute("data-tmdb-id") || "",
            yearText:
                document.querySelector("[data-testid='hero-title-block__metadata']")?.textContent ||
                document.querySelector(".releaseyear")?.textContent ||
                document.querySelector('main a[href^="/films/year/"]')?.textContent ||
                "",
        };
        const testInput = ["127.0.0.1", "localhost"].includes(location.hostname)
            ? globalThis.__OMBI_REQUEST_TEST_INPUT__
            : null;
        return testInput
            ? { ...liveInput, ...testInput }
            : liveInput;
    }

    async function resolveMovie() {
        const path = Core.movieLookupPath(state.media);
        if (path) return api(path);
        if (!state.media.title) {
            throw new Error("This page does not expose a usable movie title or external ID.");
        }

        const results = await api(`/api/v2/Search/multi/${encodeURIComponent(state.media.title)}`, {
            method: "POST",
            body: { movies: true, tvShows: false, music: false, people: false },
        });
        const candidate = Core.matchingMovieCandidate(results, state.media);
        const id = Number(candidate?.id || candidate?.theMovieDbId);
        if (!Number.isInteger(id) || id <= 0) {
            throw new Error("Ombi could not uniquely match this Letterboxd movie.");
        }
        return api(`/api/v2/Search/movie/${id}`);
    }

    async function resolveTv() {
        if (!state.media.title) throw new Error("Could not read this show title.");

        const results = await api(`/api/v2/Search/multi/${encodeURIComponent(state.media.title)}`, {
            method: "POST",
            body: { movies: false, tvShows: true, music: false, people: false },
        });
        const candidates = Core.exactTitleCandidates(results, state.media.title).slice(0, 6);
        if (!candidates.length) throw new Error("Ombi could not find this TV show.");

        const detailResults = [];
        for (const candidate of candidates) {
            try {
                detailResults.push(await api(`/api/v2/Search/tv/moviedb/${candidate.id}`));
            } catch {
                // Keep checking the bounded set; one stale TMDb result should not end resolution.
            }
        }
        const match = Core.matchingTvDetails(detailResults, state.media);
        if (!match) {
            throw new Error("Ombi found multiple possible shows. Open Ombi to choose the right one.");
        }
        return match;
    }

    async function resolveMedia() {
        state.details = state.media.mediaType === "tv" ? await resolveTv() : await resolveMovie();
        state.status = Core.mediaStatus(state.details);
    }

    function qualityProfileId(config = state.config) {
        const id = Number(config?.qualityProfileOverrides?.[state.media.mediaType]);
        return Number.isInteger(id) && id > 0 ? id : null;
    }

    async function qualityProfiles(config) {
        const service = state.media.mediaType === "tv" ? "Sonarr" : "Radarr";
        const result = await api(`/api/v1/${service}/Profiles`, { config });
        return (Array.isArray(result) ? result : [])
            .map((profile) => ({ id: Number(profile?.id), name: String(profile?.name || "").trim() }))
            .filter((profile) => Number.isInteger(profile.id) && profile.id > 0 && profile.name);
    }

    function requestPathAndBody() {
        const profileId = qualityProfileId();
        if (state.media.mediaType === "tv") {
            return {
                path: "/api/v2/Requests/tv",
                body: Core.tvRequestBody(state.details, profileId),
            };
        }
        return {
            path: "/api/v1/Request/movie",
            body: Core.movieRequestBody(state.details, profileId),
        };
    }

    async function submitRequest() {
        const request = requestPathAndBody();
        const result = await api(request.path, { method: "POST", body: request.body });
        if (!Core.requestSucceeded(result)) {
            throw new Error(Core.requestErrorMessage(result, "Ombi did not accept the request."));
        }
        state.status = "requested";
    }

    function openDiscover() {
        window.open(Core.discoverUrl(state.config.baseUrl, state.media), "_blank", "noopener");
    }

    function makeUi() {
        const existing = document.getElementById(APP_ID);
        if (existing) existing.remove();

        const host = document.createElement("div");
        host.id = APP_ID;
        host.style.cssText = "all:initial;position:fixed;z-index:2147483647;right:20px;bottom:20px";
        const shadow = host.attachShadow({ mode: "open" });
        shadow.innerHTML = `
            <style>
                :host { color-scheme: dark; }
                * { box-sizing: border-box; }
                .dock { display:flex; align-items:stretch; filter:drop-shadow(0 8px 24px #0008); font:600 14px/1.2 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
                button { border:0; color:#fff; cursor:pointer; font:inherit; }
                #main { min-width:164px; padding:12px 16px; border-radius:12px 0 0 12px; background:#7c3aed; transition:transform .15s ease,background .15s ease; }
                #main:hover:not(:disabled) { background:#8b5cf6; transform:translateY(-1px); }
                #main:disabled { cursor:default; opacity:.88; }
                #settings { width:42px; border-left:1px solid #ffffff35; border-radius:0 12px 12px 0; background:#6d28d9; font-size:17px; }
                #settings:hover { background:#8b5cf6; }
                .available #main { background:#087f5b; }
                .requested #main { background:#2563eb; }
                .error #main { background:#b42318; }
                .busy #main { background:#4b5563; }
                .modal-backdrop { position:fixed; inset:0; display:grid; place-items:center; background:#0009; font:14px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
                .modal { width:min(440px,calc(100vw - 32px)); border:1px solid #ffffff26; border-radius:16px; padding:22px; background:#18181b; color:#f4f4f5; box-shadow:0 24px 80px #000b; }
                h2 { margin:0 0 4px; font-size:20px; }
                p { margin:0 0 16px; color:#a1a1aa; }
                label { display:block; margin:13px 0 5px; color:#e4e4e7; font-weight:650; }
                input, select { width:100%; border:1px solid #3f3f46; border-radius:9px; padding:10px 11px; background:#27272a; color:#fff; font:inherit; outline:none; }
                input:focus, select:focus { border-color:#8b5cf6; box-shadow:0 0 0 3px #7c3aed33; }
                select:disabled { color:#a1a1aa; cursor:wait; }
                .hint { margin-top:5px; color:#a1a1aa; font-size:12px; }
                .warning { margin-top:13px; border-radius:9px; padding:10px; background:#78350f55; color:#fde68a; font-size:12px; }
                .message { min-height:20px; margin-top:10px; color:#fca5a5; font-size:13px; }
                .message.success { color:#86efac; }
                .actions { display:flex; justify-content:flex-end; gap:9px; margin-top:10px; }
                .actions button { border-radius:9px; padding:9px 13px; background:#3f3f46; }
                .actions .primary { background:#7c3aed; }
            </style>
            <div class="dock">
                <button id="main" type="button">Set up Ombi</button>
                <button id="settings" type="button" title="Ombi Request settings" aria-label="Ombi Request settings">⚙</button>
            </div>
        `;
        document.documentElement.appendChild(host);

        const main = shadow.getElementById("main");
        const dock = shadow.querySelector(".dock");
        const settings = shadow.getElementById("settings");

        function render() {
            const labels = {
                setup: "Set up Ombi",
                resolving: "Checking Ombi…",
                requestable: "Request in Ombi",
                requested: "Already requested ✓",
                available: "Available in library ✓",
                error: "Open in Ombi",
            };
            main.textContent = labels[state.status] || "Request in Ombi";
            main.disabled = state.busy || ["available", "requested"].includes(state.status);
            dock.className = `dock ${state.busy ? "busy" : state.status}`;
            main.title = state.media?.title || "Ombi Request";
        }

        async function withBusy(work) {
            if (state.busy) return;
            state.busy = true;
            render();
            try {
                await work();
            } catch (error) {
                console.error("[Ombi Request]", error);
                state.status = "error";
                main.title = error.message;
                showToast(error.message);
            } finally {
                state.busy = false;
                render();
            }
        }

        function showToast(message) {
            const old = shadow.getElementById("toast");
            if (old) old.remove();
            const toast = document.createElement("div");
            toast.id = "toast";
            toast.textContent = message;
            toast.style.cssText = "position:absolute;right:0;bottom:54px;width:300px;border-radius:10px;padding:10px 12px;background:#27272a;color:#fff;box-shadow:0 8px 30px #0009;font:13px/1.35 system-ui,sans-serif";
            shadow.appendChild(toast);
            setTimeout(() => toast.remove(), 6500);
        }

        function showSettings() {
            if (shadow.querySelector(".modal-backdrop")) return;
            const wrapper = document.createElement("div");
            wrapper.className = "modal-backdrop";
            wrapper.innerHTML = `
                <form class="modal">
                    <h2>Connect Ombi</h2>
                    <p>These settings stay in your userscript manager.</p>
                    <label for="url">Ombi URL</label>
                    <input id="url" name="url" type="url" required placeholder="https://ombi.example.com" autocomplete="url">
                    <label for="key">Ombi API key</label>
                    <input id="key" name="key" type="password" required autocomplete="off">
                    <label for="user">Ombi username <span style="color:#a1a1aa;font-weight:400">(optional)</span></label>
                    <input id="user" name="user" autocomplete="username" placeholder="Attributes the request to this user">
                    <label for="profile">${state.media.mediaType === "tv" ? "Sonarr" : "Radarr"} quality profile override</label>
                    <select id="profile" name="profile" disabled>
                        <option value="">Connect to load profiles</option>
                    </select>
                    <div id="profile-help" class="hint">Leave this on Ombi default unless this request should use another profile.</div>
                    <div class="warning">Ombi API keys grant administrator-level API access. Prefer HTTPS outside your home network.</div>
                    <div class="message" role="status"></div>
                    <div class="actions">
                        <button type="button" data-action="cancel">Close</button>
                        <button type="submit" class="primary">Test & save</button>
                    </div>
                </form>
            `;
            shadow.appendChild(wrapper);
            const form = wrapper.querySelector("form");
            const url = wrapper.querySelector("#url");
            const key = wrapper.querySelector("#key");
            const user = wrapper.querySelector("#user");
            const profile = wrapper.querySelector("#profile");
            const profileHelp = wrapper.querySelector("#profile-help");
            const message = wrapper.querySelector(".message");
            const submit = form.querySelector('[type="submit"]');
            url.value = state.config?.baseUrl || "";
            key.value = state.config?.apiKey || "";
            user.value = state.config?.userName || "";
            url.focus();

            function setProfileOptions(profiles, selectedId) {
                profile.replaceChildren();
                const defaultOption = document.createElement("option");
                defaultOption.value = "";
                defaultOption.textContent = "Use Ombi default";
                profile.appendChild(defaultOption);
                for (const item of profiles) {
                    const option = document.createElement("option");
                    option.value = String(item.id);
                    option.textContent = item.name;
                    profile.appendChild(option);
                }
                if (selectedId && !profiles.some((item) => item.id === selectedId)) {
                    const savedOption = document.createElement("option");
                    savedOption.value = String(selectedId);
                    savedOption.textContent = `Saved profile (${selectedId})`;
                    profile.appendChild(savedOption);
                }
                profile.value = selectedId ? String(selectedId) : "";
                profile.disabled = false;
                profileHelp.textContent = "Leave this on Ombi default unless this request should use another profile.";
            }

            async function loadProfileOptions(config, selectedId) {
                profile.disabled = true;
                profileHelp.textContent = "Loading profiles from Ombi…";
                try {
                    setProfileOptions(await qualityProfiles(config), selectedId);
                } catch (error) {
                    setProfileOptions([], selectedId);
                    profileHelp.textContent = `Profiles unavailable: ${error.message}`;
                }
            }

            if (state.config) {
                void loadProfileOptions(state.config, qualityProfileId(state.config));
            }

            wrapper.querySelector('[data-action="cancel"]').addEventListener("click", () => wrapper.remove());
            wrapper.addEventListener("click", (event) => {
                if (event.target === wrapper) wrapper.remove();
            });
            form.addEventListener("input", () => {
                message.textContent = "";
                message.className = "message";
                submit.textContent = "Test & save";
            });
            form.addEventListener("submit", async (event) => {
                event.preventDefault();
                const previousConfig = state.config;
                submit.disabled = true;
                message.textContent = "Testing connection…";
                message.className = "message";
                try {
                    const profileOverrides = { ...(previousConfig?.qualityProfileOverrides || {}) };
                    const selectedProfileId = profile.disabled
                        ? qualityProfileId(previousConfig)
                        : Number(profile.value);
                    if (Number.isInteger(selectedProfileId) && selectedProfileId > 0) {
                        profileOverrides[state.media.mediaType] = selectedProfileId;
                    } else {
                        delete profileOverrides[state.media.mediaType];
                    }
                    const proposed = {
                        baseUrl: Core.normalizeBaseUrl(url.value),
                        apiKey: key.value.trim(),
                        userName: user.value.trim(),
                        qualityProfileOverrides: profileOverrides,
                    };
                    const version = await api("/api/v1/Status/info", { config: proposed });
                    await loadProfileOptions(proposed, qualityProfileId(proposed));
                    state.config = proposed;
                    await saveConfig(proposed);
                    message.textContent = `Saved. Connected to Ombi ${version || "successfully"}. You can close this window.`;
                    message.className = "message success";
                    submit.textContent = "Saved ✓";
                    state.status = "resolving";
                    render();
                    await withBusy(async () => resolveMedia());
                } catch (error) {
                    state.config = previousConfig;
                    message.textContent = error.message;
                } finally {
                    submit.disabled = false;
                }
            });
        }

        main.addEventListener("click", () => {
            if (!state.config) return showSettings();
            if (state.status === "error") return openDiscover();
            withBusy(async () => {
                if (!state.details) await resolveMedia();
                if (state.status === "requestable") {
                    await submitRequest();
                    showToast(`Requested ${state.media.title || "this title"} in Ombi.`);
                }
            });
        });
        settings.addEventListener("click", showSettings);

        return { render, showSettings, showToast };
    }

    async function main() {
        state.media = Core.detectPage(documentInput());
        if (!state.media) return;

        const ui = makeUi();
        ui.render();
        try {
            state.config = await loadConfig();
        } catch (error) {
            console.error("[Ombi Request] userscript storage failed", error);
            ui.showToast("Ombi Request is running, but userscript storage is unavailable.");
        }
        state.status = state.config ? "resolving" : "setup";
        ui.render();
        if (typeof GM.registerMenuCommand === "function") {
            GM.registerMenuCommand("Ombi Request: Settings", ui.showSettings);
        }

        if (state.config) {
            state.busy = true;
            ui.render();
            try {
                await resolveMedia();
            } catch (error) {
                console.error("[Ombi Request]", error);
                state.status = "error";
            } finally {
                state.busy = false;
                ui.render();
            }
        }
    }

    main().catch((error) => console.error("[Ombi Request] startup failed", error));
})();
