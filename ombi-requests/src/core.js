(function initOmbiRequestCore(root, factory) {
    const api = factory();
    if (typeof module === "object" && module.exports) {
        module.exports = api;
    } else {
        root.OmbiRequestCore = api;
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function createCore() {
    "use strict";

    const TV_TYPES = new Set([
        "TVEpisode",
        "TVMiniSeries",
        "TVSeason",
        "TVSeries",
    ]);

    function asArray(value) {
        if (Array.isArray(value)) return value;
        return value == null ? [] : [value];
    }

    function compactText(value) {
        return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
    }

    function normalizeTitle(value) {
        return compactText(value)
            .normalize("NFKD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/&/g, " and ")
            .replace(/[^a-zA-Z0-9]+/g, " ")
            .trim()
            .toLowerCase();
    }

    function extractImdbId(value) {
        const match = String(value || "").match(/\b(tt\d{5,12})\b/i);
        return match ? match[1].toLowerCase() : null;
    }

    function extractTmdbMovieId(value) {
        const match = String(value || "").match(/themoviedb\.org\/movie\/(\d+)/i);
        return match ? Number(match[1]) : null;
    }

    function extractYear(value) {
        const match = String(value || "").match(/\b(18|19|20|21)\d{2}\b/);
        return match ? Number(match[0]) : null;
    }

    function flattenJsonLd(value) {
        const queue = asArray(value);
        const objects = [];

        while (queue.length) {
            const item = queue.shift();
            if (!item || typeof item !== "object") continue;
            objects.push(item);
            if (Array.isArray(item["@graph"])) queue.push(...item["@graph"]);
            if (item.itemReviewed) queue.push(...asArray(item.itemReviewed));
            if (item.mainEntity) queue.push(...asArray(item.mainEntity));
        }

        return objects;
    }

    function parseJsonLdTexts(texts) {
        const objects = [];
        for (const text of texts || []) {
            try {
                const cleaned = String(text)
                    .replace(/^\s*\/\*\s*<!\[CDATA\[\s*\*\/\s*/, "")
                    .replace(/\s*\/\*\s*\]\]>\s*\*\/\s*$/, "");
                objects.push(...flattenJsonLd(JSON.parse(cleaned)));
            } catch {
                // Sites occasionally leave stale or partially hydrated JSON-LD in the DOM.
            }
        }
        return objects;
    }

    function schemaTypes(item) {
        return asArray(item && item["@type"]).map(String);
    }

    function isTitleSchema(item) {
        return schemaTypes(item).some((type) => type === "Movie" || TV_TYPES.has(type));
    }

    function firstTitleSchema(jsonLd) {
        return (jsonLd || []).find(isTitleSchema) || null;
    }

    function findUrl(values, extractor) {
        for (const value of values) {
            const result = extractor(value);
            if (result) return result;
        }
        return null;
    }

    function detectImdbPage(input) {
        const pathnameId = extractImdbId(input.pathname);
        if (!pathnameId) return null;

        const schema = firstTitleSchema(input.jsonLd);
        const types = schemaTypes(schema);
        const isEpisode = types.includes("TVEpisode");
        const schemaSeries = isEpisode && schema && typeof schema.partOfSeries === "object"
            ? schema.partOfSeries
            : null;
        const series = isEpisode ? (input.series || schemaSeries) : null;
        const seriesId = series
            ? findUrl([series.url, series["@id"], ...(asArray(series.sameAs))], extractImdbId)
            : null;
        const mediaType = types.some((type) => TV_TYPES.has(type)) ? "tv" : "movie";

        return {
            source: "imdb",
            mediaType,
            imdbId: seriesId || pathnameId,
            tmdbId: null,
            title: compactText((series && series.name) || (schema && schema.name) || input.heading),
            year: extractYear((schema && (schema.datePublished || schema.dateCreated)) || input.yearText),
            pageUrl: input.pageUrl,
        };
    }

    function detectLetterboxdPage(input) {
        const pathname = String(input.pathname || "");
        const isFilmPath = /^\/film\/[^/]+(?:\/.*)?$/i.test(pathname)
            || /^\/[^/]+\/film\/[^/]+(?:\/.*)?$/i.test(pathname);
        if (!isFilmPath && !input.tmdbDataId) return null;

        const schema = firstTitleSchema(input.jsonLd);
        const candidateUrls = [
            ...(input.externalUrls || []),
            ...(schema ? asArray(schema.sameAs) : []),
            schema && schema.url,
        ];
        const imdbId = findUrl(candidateUrls, extractImdbId);
        const tmdbId = input.tmdbDataId
            ? Number(input.tmdbDataId)
            : findUrl(candidateUrls, extractTmdbMovieId);
        const title = compactText((schema && schema.name) || input.ogTitle || input.heading)
            .replace(/\s*\((18|19|20|21)\d{2}\)\s*$/, "");

        return {
            source: "letterboxd",
            mediaType: "movie",
            imdbId,
            tmdbId: Number.isInteger(tmdbId) && tmdbId > 0 ? tmdbId : null,
            title,
            year: extractYear(
                input.ogTitle
                || input.yearText
                || (schema && (schema.dateCreated || schema.datePublished)),
            ),
            pageUrl: input.pageUrl,
        };
    }

    function detectPage(input) {
        const host = String(input.hostname || "").replace(/^www\./, "").toLowerCase();
        if (host === "imdb.com") return detectImdbPage(input);
        if (host === "letterboxd.com") return detectLetterboxdPage(input);
        return null;
    }

    function normalizeBaseUrl(value) {
        const raw = compactText(value).replace(/\/+$/, "");
        if (!raw) throw new Error("Enter your Ombi URL.");

        let parsed;
        try {
            parsed = new URL(raw);
        } catch {
            throw new Error("Enter a full Ombi URL, including http:// or https://.");
        }
        if (!/^https?:$/.test(parsed.protocol)) {
            throw new Error("The Ombi URL must start with http:// or https://.");
        }
        parsed.hash = "";
        parsed.search = "";
        return parsed.toString().replace(/\/$/, "");
    }

    function endpoint(baseUrl, path) {
        return `${normalizeBaseUrl(baseUrl)}${path.startsWith("/") ? "" : "/"}${path}`;
    }

    function discoverUrl(baseUrl, media) {
        const title = compactText(media && media.title);
        return endpoint(baseUrl, `/discover/${encodeURIComponent(title)}`);
    }

    function movieLookupPath(media) {
        if (media.tmdbId) return `/api/v2/Search/movie/${media.tmdbId}`;
        if (media.imdbId) return `/api/v2/Search/movie/imdb/${encodeURIComponent(media.imdbId)}`;
        return null;
    }

    function matchingMovieCandidate(results, media) {
        const withoutYear = (value) => compactText(value)
            .replace(/\s*\((18|19|20|21)\d{2}\)\s*$/, "");
        const expectedTitle = normalizeTitle(withoutYear(media && media.title));
        const candidates = (results || []).filter((item) =>
            String(item && item.mediaType || "").toLowerCase().includes("movie"),
        );
        const exact = candidates.filter(
            (item) => normalizeTitle(withoutYear(item && item.title)) === expectedTitle,
        );
        const expectedYear = Number(media && media.year);
        if (Number.isInteger(expectedYear)) {
            const byYear = exact.filter((item) => extractYear(
                item.releaseDate || item.release_date || item.year || item.title,
            ) === expectedYear);
            if (byYear.length) return byYear[0];
        }
        return exact.length === 1 ? exact[0] : null;
    }

    function applyQualityProfileOverride(body, qualityProfileId) {
        const id = Number(qualityProfileId);
        if (Number.isInteger(id) && id > 0) body.qualityPathOverride = id;
        return body;
    }

    function movieRequestBody(details, qualityProfileId) {
        const id = Number(details && (details.id || details.theMovieDbId));
        if (!Number.isInteger(id) || id <= 0) {
            throw new Error("Ombi did not return a valid TMDb movie ID.");
        }
        return applyQualityProfileOverride({
            theMovieDbId: id,
            languageCode: "en",
            is4kRequest: false,
        }, qualityProfileId);
    }

    function tvRequestBody(details, qualityProfileId) {
        const id = Number(details && (details.id || details.theMovieDbId));
        if (!Number.isInteger(id) || id <= 0) {
            throw new Error("Ombi did not return a valid TMDb TV ID.");
        }
        return applyQualityProfileOverride({
            theMovieDbId: id,
            requestAll: true,
            latestSeason: false,
            firstSeason: false,
            seasons: [],
            languageCode: "en",
        }, qualityProfileId);
    }

    function mediaStatus(details) {
        if (!details || typeof details !== "object") return "unknown";
        if (details.available || details.fullyAvailable) return "available";
        if (details.requested || Number(details.requestId) > 0) return "requested";
        return "requestable";
    }

    function exactTitleCandidates(results, title) {
        const normalized = normalizeTitle(title);
        const tvResults = (results || []).filter((item) =>
            String(item.mediaType || "").toLowerCase().includes("tv"),
        );
        const exact = tvResults.filter((item) => normalizeTitle(item.title) === normalized);
        return exact.length ? exact : tvResults;
    }

    function matchingTvDetails(detailResults, media) {
        const imdbId = extractImdbId(media && media.imdbId);
        if (imdbId) {
            const byImdb = (detailResults || []).find((item) => {
                const external = item && item.externalIds;
                return extractImdbId(
                    (external && (external.imdbId || external.imdb_id)) || item.imdbId,
                ) === imdbId;
            });
            if (byImdb) return byImdb;
        }

        const exact = (detailResults || []).filter(
            (item) => normalizeTitle(item && item.title) === normalizeTitle(media && media.title),
        );
        return exact.length === 1 ? exact[0] : null;
    }

    function requestSucceeded(payload) {
        if (payload == null) return false;
        if (typeof payload === "boolean") return payload;
        return payload.result === true || payload.isError === false;
    }

    function requestErrorMessage(payload, fallback) {
        if (!payload || typeof payload !== "object") return fallback;
        return compactText(
            payload.errorMessage || payload.message || payload.error || payload.resultMessage,
        ) || fallback;
    }

    return Object.freeze({
        compactText,
        detectPage,
        discoverUrl,
        endpoint,
        exactTitleCandidates,
        extractImdbId,
        extractTmdbMovieId,
        extractYear,
        matchingMovieCandidate,
        matchingTvDetails,
        mediaStatus,
        movieLookupPath,
        movieRequestBody,
        normalizeBaseUrl,
        normalizeTitle,
        parseJsonLdTexts,
        requestErrorMessage,
        requestSucceeded,
        tvRequestBody,
    });
});
