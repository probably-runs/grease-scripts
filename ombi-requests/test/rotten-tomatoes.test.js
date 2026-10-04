const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Core = require("../src/core.js");

function fixtureSchema(name) {
    const html = fs.readFileSync(path.join(__dirname, "fixtures", `rotten-tomatoes-${name}.html`), "utf8");
    const jsonLdTexts = [...html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)]
        .map((match) => match[1]);
    assert.ok(jsonLdTexts.length, `${name} fixture must contain source-derived JSON-LD`);
    return Core.parseJsonLdTexts(jsonLdTexts);
}

function input(pathname, overrides = {}) {
    return {
        hostname: "www.rottentomatoes.com",
        pathname,
        pageUrl: `https://www.rottentomatoes.com${pathname}`,
        jsonLd: [],
        ...overrides,
    };
}

test("detects the current Rotten Tomatoes movie fixture by its creation date", () => {
    const media = Core.detectPage(input("/m/shawshank_redemption", {
        jsonLd: fixtureSchema("movie"),
        heading: "Recommended Movies",
        yearText: "2026",
    }));

    assert.deepEqual(media, {
        source: "rottentomatoes",
        mediaType: "movie",
        imdbId: null,
        tmdbId: null,
        title: "The Shawshank Redemption",
        year: 1994,
        pageUrl: "https://www.rottentomatoes.com/m/shawshank_redemption",
    });
});

test("detects the current Rotten Tomatoes series fixture", () => {
    const media = Core.detectPage(input("/tv/breaking_bad", {
        jsonLd: fixtureSchema("series"),
        heading: "Recommended TV",
        yearText: "2013",
    }));

    assert.deepEqual(media, {
        source: "rottentomatoes",
        mediaType: "tv",
        imdbId: null,
        tmdbId: null,
        title: "Breaking Bad",
        year: 2008,
        pageUrl: "https://www.rottentomatoes.com/tv/breaking_bad",
    });
});

test("maps the current Rotten Tomatoes season and episode fixtures to the parent series", () => {
    for (const [name, pathname] of [
        ["season", "/tv/breaking_bad/s05"],
        ["episode", "/tv/breaking_bad/s05/e14"],
    ]) {
        const media = Core.detectPage(input(pathname, {
            jsonLd: fixtureSchema(name),
            heading: "Ozymandias",
            yearText: "Aired Sep 15, 2013",
        }));

        assert.equal(media.source, "rottentomatoes", name);
        assert.equal(media.mediaType, "tv", name);
        assert.equal(media.title, "Breaking Bad", name);
        assert.equal(media.year, 2008, name);
        assert.equal(media.imdbId, null, name);
        assert.equal(media.tmdbId, null, name);
        assert.equal(media.pageUrl, `https://www.rottentomatoes.com${pathname}`, name);
    }
});

test("accepts the canonical movie and TV routes with or without a trailing slash", () => {
    for (const hostname of ["rottentomatoes.com", "www.rottentomatoes.com"]) {
        for (const [pathname, name] of [
            ["/m/shawshank_redemption", "movie"],
            ["/tv/breaking_bad", "series"],
            ["/tv/breaking_bad/s05", "season"],
            ["/tv/breaking_bad/s05/e14", "episode"],
        ]) {
            for (const ending of ["", "/"]) {
                assert.ok(Core.detectPage(input(`${pathname}${ending}`, {
                    hostname,
                    jsonLd: fixtureSchema(name),
                })), `${hostname}${pathname}${ending}`);
            }
        }
    }
});

test("rejects Rotten Tomatoes browse, review, and malformed title routes", () => {
    for (const pathname of [
        "/",
        "/browse/movies_at_home/",
        "/m/",
        "/m/shawshank_redemption/reviews",
        "/tv/",
        "/tv/breaking_bad/reviews",
        "/tv/breaking_bad/e14",
        "/tv/breaking_bad/specials",
        "/tv/breaking_bad/s05/e14/reviews",
        "/tv/breaking_bad/s05/extra",
    ]) {
        assert.equal(Core.detectPage(input(pathname, {
            heading: "Breaking Bad",
            ogTitle: "Breaking Bad | Rotten Tomatoes",
            yearText: "2008",
            jsonLd: fixtureSchema("series"),
        })), null, pathname);
    }
});

test("does not run the Rotten Tomatoes detector on another host", () => {
    for (const hostname of ["example.com", "rottentomatoes.com.example.com", "editorial.rottentomatoes.com"]) {
        assert.equal(Core.detectPage(input("/m/shawshank_redemption", {
            hostname,
            jsonLd: fixtureSchema("movie"),
        })), null, hostname);
    }
});

test("ignores review publication dates when finding a Rotten Tomatoes release year", () => {
    for (const [pathname, type] of [["/m/shawshank_redemption", "Movie"], ["/tv/breaking_bad", "TVSeries"]]) {
        const media = Core.detectPage(input(pathname, {
            jsonLd: [{ "@type": type, name: "A title", dateCreated: "1994-09-01", datePublished: "2026-10-03" }],
            yearText: "2025",
        }));
        assert.equal(media.year, 1994, type);

        const fallback = Core.detectPage(input(pathname, {
            jsonLd: [{ "@type": type, name: "A title", datePublished: "2026-10-03" }],
            yearText: "1994",
        }));
        assert.equal(fallback.year, 1994, type);

        const unknown = Core.detectPage(input(pathname, {
            jsonLd: [{ "@type": type, name: "A title", datePublished: "2026-10-03" }],
        }));
        assert.equal(unknown.year, null, type);
    }
});

test("uses a parent's premiere date rather than the season or episode release date", () => {
    for (const [pathname, type] of [["/tv/the_office/s02", "TVSeason"], ["/tv/the_office/s02/e01", "TVEpisode"]]) {
        const media = Core.detectPage(input(pathname, {
            jsonLd: [{
                "@type": type,
                name: "Season 2 premiere",
                dateCreated: "2006-01-01",
                datePublished: "2026-10-03",
                partOfSeries: {
                    "@type": "TVSeries",
                    name: "The Office",
                    startDate: "2005-03-24",
                    url: "https://www.rottentomatoes.com/tv/the_office",
                },
            }],
            yearText: "2006",
        }));
        assert.equal(media.title, "The Office", type);
        assert.equal(media.year, 2005, type);
    }
});

test("requires parent series metadata on a season or episode page", () => {
    for (const [pathname, type] of [["/tv/breaking_bad/s05", "TVSeason"], ["/tv/breaking_bad/s05/e14", "TVEpisode"]]) {
        for (const partOfSeries of [undefined, { url: "https://www.rottentomatoes.com/tv/breaking_bad" }, { name: "   " }]) {
            assert.equal(Core.detectPage(input(pathname, {
                jsonLd: [{ "@type": type, name: "Ozymandias", dateCreated: "2013-09-15", partOfSeries }],
                heading: "Breaking Bad – Season 5, Episode 14",
                ogTitle: "Breaking Bad: Season 5, Episode 14 | Rotten Tomatoes",
                yearText: "2013",
            })), null, `${type} with ${JSON.stringify(partOfSeries)}`);
        }
    }
});

test("does not use nested-page headings or Open Graph text as a parent series", () => {
    for (const pathname of ["/tv/breaking_bad/s05", "/tv/breaking_bad/s05/e14"]) {
        assert.equal(Core.detectPage(input(pathname, {
            heading: "Season 5 – Breaking Bad",
            ogTitle: "Breaking Bad: Season 5 | Rotten Tomatoes",
            yearText: "2012",
        })), null, pathname);
    }
});

test("can identify a season or episode parent from an explicit TVSeries schema", () => {
    for (const pathname of ["/tv/breaking_bad/s05", "/tv/breaking_bad/s05/e14"]) {
        const media = Core.detectPage(input(pathname, {
            jsonLd: [{ "@type": "TVSeries", name: "Breaking Bad", dateCreated: "2008-01-20" }],
            heading: "Ozymandias",
            yearText: "2013",
        }));
        assert.equal(media.title, "Breaking Bad", pathname);
        assert.equal(media.year, 2008, pathname);
    }
});

test("resolves a nested page's parent series reference in a JSON-LD graph", () => {
    const parentId = "https://www.rottentomatoes.com/tv/breaking_bad#series";
    for (const reference of [{ "@id": parentId }, parentId]) {
        const jsonLd = Core.parseJsonLdTexts([JSON.stringify({
            "@context": "https://schema.org",
            "@graph": [
                { "@type": "Organization", name: "Rotten Tomatoes" },
                {
                    "@type": "TVEpisode",
                    name: "Ozymandias",
                    dateCreated: "2013-09-15",
                    sameAs: "https://www.imdb.com/title/tt2301451/",
                    partOfSeries: reference,
                },
                {
                    "@id": parentId,
                    "@type": "TVSeries",
                    name: "Breaking Bad",
                    startDate: "2008-01-20",
                    sameAs: "https://www.imdb.com/title/tt0903747/",
                },
            ],
        })]);
        const media = Core.detectPage(input("/tv/breaking_bad/s05/e14", { jsonLd, yearText: "2013" }));
        assert.equal(media.title, "Breaking Bad");
        assert.equal(media.year, 2008);
        assert.equal(media.imdbId, "tt0903747");
    }
});

test("leaves the parent year unknown when only season or episode dates are exposed", () => {
    const media = Core.detectPage(input("/tv/breaking_bad/s05/e14", {
        jsonLd: [{
            "@type": "TVEpisode",
            name: "Ozymandias",
            dateCreated: "2013-09-15",
            partOfSeries: { "@type": "TVSeries", name: "Breaking Bad" },
        }],
        yearText: "Aired Sep 15, 2013",
    }));
    assert.equal(media.title, "Breaking Bad");
    assert.equal(media.year, null);
});

test("uses root movie or series hero text when JSON-LD is absent", () => {
    for (const [pathname, mediaType, heading, yearText, year] of [
        ["/m/shawshank_redemption", "movie", "  The Shawshank Redemption  ", "R 1994 2h 22m", 1994],
        ["/tv/breaking_bad", "tv", "  Breaking Bad  ", "TV-14 2008 - 2013 5 Seasons", 2008],
    ]) {
        const media = Core.detectPage(input(pathname, { heading, yearText }));
        assert.equal(media.title, heading.trim(), pathname);
        assert.equal(media.mediaType, mediaType, pathname);
        assert.equal(media.year, year, pathname);
    }
});

test("removes the Rotten Tomatoes brand from a root Open Graph title fallback", () => {
    for (const [pathname, title] of [["/m/shawshank_redemption", "The Shawshank Redemption"], ["/tv/breaking_bad", "Breaking Bad"]]) {
        const media = Core.detectPage(input(pathname, {
            ogTitle: `${title} | Rotten Tomatoes`,
            yearText: "1994",
        }));
        assert.equal(media.title, title, pathname);
    }
});

test("only considers schemas whose type fits the movie or series route", () => {
    for (const [pathname, invalidType] of [["/m/shawshank_redemption", "TVSeries"], ["/tv/breaking_bad", "Movie"]]) {
        assert.equal(Core.detectPage(input(pathname, {
            jsonLd: [{ "@type": invalidType, name: "A recommendation", dateCreated: "2025-01-01" }],
        })), null, pathname);
    }

    const movie = Core.detectPage(input("/m/shawshank_redemption", {
        jsonLd: [{ "@type": "TVSeries", name: "A recommendation" }, ...fixtureSchema("movie")],
    }));
    assert.equal(movie.title, "The Shawshank Redemption");
    assert.equal(movie.mediaType, "movie");

    const series = Core.detectPage(input("/tv/breaking_bad", {
        jsonLd: [{ "@type": "Movie", name: "A recommendation" }, ...fixtureSchema("series")],
    }));
    assert.equal(series.title, "Breaking Bad");
    assert.equal(series.mediaType, "tv");
});

test("accepts an explicit TVMiniSeries schema on a series route", () => {
    const media = Core.detectPage(input("/tv/chernobyl", {
        jsonLd: [{ "@type": "TVMiniSeries", name: "Chernobyl", dateCreated: "2019-05-06" }],
    }));
    assert.equal(media.mediaType, "tv");
    assert.equal(media.title, "Chernobyl");
    assert.equal(media.year, 2019);
});

test("ignores arbitrary recommendation links and unrelated data attributes", () => {
    const media = Core.detectPage(input("/m/shawshank_redemption", {
        jsonLd: fixtureSchema("movie"),
        externalUrls: ["https://www.imdb.com/title/tt0137523/", "https://www.themoviedb.org/movie/550/"],
        tmdbDataId: "550",
    }));
    assert.equal(media.imdbId, null);
    assert.equal(media.tmdbId, null);
});

test("uses optional exact movie identifiers only from the title schema", () => {
    const media = Core.detectPage(input("/m/shawshank_redemption", {
        jsonLd: [{
            "@type": "Movie",
            name: "The Shawshank Redemption",
            dateCreated: "1994-09-01",
            sameAs: ["https://www.imdb.com/title/tt0111161/", "https://www.themoviedb.org/movie/278/"],
        }],
        externalUrls: ["https://www.imdb.com/title/tt0137523/", "https://www.themoviedb.org/movie/550/"],
    }));
    assert.equal(media.imdbId, "tt0111161");
    assert.equal(media.tmdbId, 278);
});

test("reads schema URL and @id identifiers without consulting generic links", () => {
    for (const field of ["url", "@id"]) {
        const media = Core.detectPage(input("/m/shawshank_redemption", {
            jsonLd: [{ "@type": "Movie", name: "The Shawshank Redemption", [field]: "https://www.imdb.com/title/tt0111161/" }],
            externalUrls: ["https://www.imdb.com/title/tt0137523/"],
        }));
        assert.equal(media.imdbId, "tt0111161", field);
    }
});

test("uses a nested page's parent IMDb ID instead of the episode's ID", () => {
    const media = Core.detectPage(input("/tv/breaking_bad/s05/e14", {
        jsonLd: [{
            "@type": "TVEpisode",
            name: "Ozymandias",
            sameAs: "https://www.imdb.com/title/tt2301451/",
            partOfSeries: {
                "@type": "TVSeries",
                name: "Breaking Bad",
                startDate: "2008-01-20",
                sameAs: "https://www.imdb.com/title/tt0903747/",
            },
        }],
        externalUrls: ["https://www.imdb.com/title/tt0386676/"],
    }));
    assert.equal(media.imdbId, "tt0903747");
    assert.equal(media.title, "Breaking Bad");
});

test("does not carry an episode IMDb ID onto a parent without an exact identifier", () => {
    const media = Core.detectPage(input("/tv/breaking_bad/s05/e14", {
        jsonLd: [{
            "@type": "TVEpisode",
            name: "Ozymandias",
            sameAs: "https://www.imdb.com/title/tt2301451/",
            partOfSeries: { "@type": "TVSeries", name: "Breaking Bad", startDate: "2008-01-20" },
        }],
    }));
    assert.equal(media.imdbId, null);
    assert.equal(media.tmdbId, null);
});
