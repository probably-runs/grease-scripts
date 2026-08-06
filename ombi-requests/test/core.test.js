const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../src/core.js");

test("detects an IMDb movie", () => {
    const media = Core.detectPage({
        hostname: "www.imdb.com",
        pathname: "/title/tt0137523/",
        pageUrl: "https://www.imdb.com/title/tt0137523/",
        heading: "Fight Club",
        yearText: "1999",
        jsonLd: [{ "@type": "Movie", name: "Fight Club", datePublished: "1999-10-15" }],
    });

    assert.deepEqual(media, {
        source: "imdb",
        mediaType: "movie",
        imdbId: "tt0137523",
        tmdbId: null,
        title: "Fight Club",
        year: 1999,
        pageUrl: "https://www.imdb.com/title/tt0137523/",
    });
});

test("maps an IMDb episode to its parent series", () => {
    const media = Core.detectPage({
        hostname: "imdb.com",
        pathname: "/title/tt0959621/",
        pageUrl: "https://imdb.com/title/tt0959621/",
        heading: "Pilot",
        jsonLd: [{
            "@type": "TVEpisode",
            name: "Pilot",
            partOfSeries: {
                name: "Breaking Bad",
                url: "https://www.imdb.com/title/tt0903747/",
            },
        }],
    });

    assert.equal(media.mediaType, "tv");
    assert.equal(media.imdbId, "tt0903747");
    assert.equal(media.title, "Breaking Bad");
});

test("maps a current IMDb episode DOM link to its parent series", () => {
    const media = Core.detectPage({
        hostname: "www.imdb.com",
        pathname: "/title/tt0959621/",
        pageUrl: "https://www.imdb.com/title/tt0959621/",
        heading: "Pilot",
        series: { name: "Breaking Bad", url: "/title/tt0903747/?ref_=tt_ov_srs" },
        jsonLd: [{ "@type": "TVEpisode", name: "Pilot", datePublished: "2008-01-20" }],
    });

    assert.equal(media.mediaType, "tv");
    assert.equal(media.imdbId, "tt0903747");
    assert.equal(media.title, "Breaking Bad");
});

test("detects a Letterboxd movie from external links", () => {
    const media = Core.detectPage({
        hostname: "letterboxd.com",
        pathname: "/film/fight-club/",
        pageUrl: "https://letterboxd.com/film/fight-club/",
        heading: "Fight Club",
        yearText: "1999",
        externalUrls: [
            "https://www.imdb.com/title/tt0137523/",
            "https://www.themoviedb.org/movie/550/",
        ],
        jsonLd: [{ "@type": "Movie", name: "Fight Club", dateCreated: "1999" }],
    });

    assert.equal(media.imdbId, "tt0137523");
    assert.equal(media.tmdbId, 550);
    assert.equal(media.mediaType, "movie");
});

test("detects a Letterboxd film from member and film subpages", () => {
    for (const pathname of [
        "/film/fight-club/reviews/",
        "/example-member/film/fight-club/",
    ]) {
        const media = Core.detectPage({
            hostname: "letterboxd.com",
            pathname,
            pageUrl: `https://letterboxd.com${pathname}`,
            heading: "Reviews",
            ogTitle: "Fight Club (1999)",
            tmdbDataId: "550",
            jsonLd: [],
        });

        assert.equal(media.title, "Fight Club");
        assert.equal(media.tmdbId, 550);
        assert.equal(media.year, 1999);
    }
});

test("parses Letterboxd's CDATA-wrapped review metadata", () => {
    const jsonLd = Core.parseJsonLdTexts([`/* <![CDATA[ */
        {"@type":"Review","itemReviewed":{"@type":"Movie","name":"Kill Bill: Vol. 1","sameAs":"https://letterboxd.com/film/kill-bill-vol-1/"}}
        /* ]]> */`]);
    const media = Core.detectPage({
        hostname: "letterboxd.com",
        pathname: "/example-member/film/kill-bill-vol-1/",
        pageUrl: "https://letterboxd.com/example-member/film/kill-bill-vol-1/",
        heading: "Review by example-reviewer",
        ogTitle: "A ★★★★★ review of Kill Bill: Vol. 1 (2003)",
        jsonLd,
    });

    assert.equal(media.title, "Kill Bill: Vol. 1");
    assert.equal(media.year, 2003);
});

test("matches an Ombi movie fallback by title and year", () => {
    const candidate = Core.matchingMovieCandidate([
        { id: "24", title: "Kill Bill: Vol. 1 (2003)", mediaType: "movie" },
        { id: "1502241", title: "Short Cuts : KILL BILL VOL.1 (2025)", mediaType: "movie" },
    ], { title: "Kill Bill: Vol. 1", year: 2003 });

    assert.equal(candidate.id, "24");
});

test("normalizes Ombi base URLs without losing reverse-proxy paths", () => {
    assert.equal(Core.normalizeBaseUrl("https://example.test/ombi///"), "https://example.test/ombi");
    assert.equal(
        Core.endpoint("https://example.test/ombi/", "/api/v1/Status/info"),
        "https://example.test/ombi/api/v1/Status/info",
    );
    assert.throws(() => Core.normalizeBaseUrl("example.test"), /including http/);
});

test("builds Ombi request payloads", () => {
    assert.deepEqual(Core.movieRequestBody({ id: 550 }, 9), {
        theMovieDbId: 550,
        languageCode: "en",
        is4kRequest: false,
        qualityPathOverride: 9,
    });
    assert.deepEqual(Core.tvRequestBody({ id: 1396 }, 4), {
        theMovieDbId: 1396,
        requestAll: true,
        latestSeason: false,
        firstSeason: false,
        seasons: [],
        languageCode: "en",
        qualityPathOverride: 4,
    });
    assert.equal("qualityPathOverride" in Core.movieRequestBody({ id: 550 }), false);
});

test("chooses TV details by IMDb ID", () => {
    const details = Core.matchingTvDetails([
        { id: 1, title: "The Office", externalIds: { imdbId: "tt0386676" } },
        { id: 2, title: "The Office", externalIds: { imdbId: "tt0290978" } },
    ], { title: "The Office", imdbId: "tt0386676" });

    assert.equal(details.id, 1);
});

test("reports Ombi availability and request state", () => {
    assert.equal(Core.mediaStatus({ available: true }), "available");
    assert.equal(Core.mediaStatus({ requested: true }), "requested");
    assert.equal(Core.mediaStatus({ id: 550 }), "requestable");
});
