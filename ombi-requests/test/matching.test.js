const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../src/core.js");

test("matches the movie remake with the page's exact year", () => {
    const original = { id: 1, title: "The Thing", releaseDate: "1951-04-27", mediaType: "movie" };
    const remake = { id: 2, title: "The Thing (1982)", mediaType: "movie" };
    assert.equal(Core.matchingMovieCandidate([original, remake], { title: "The Thing", year: 1982 }), remake);
});

test("does not replace an unmatched movie year with a unique title", () => {
    const original = { id: 1, title: "The Thing", releaseDate: "1951-04-27", mediaType: "movie" };
    assert.equal(Core.matchingMovieCandidate([original], { title: "The Thing", year: 1982 }), null);
    assert.equal(Core.matchingMovieCandidate([
        { id: 2, title: "The Thing", mediaType: "movie" },
    ], { title: "The Thing", year: 1982 }), null);
});

test("rejects multiple movies with the same title and year", () => {
    assert.equal(Core.matchingMovieCandidate([
        { id: 1, title: "The Thing", year: 1982, mediaType: "movie" },
        { id: 2, title: "The Thing (1982)", mediaType: "movie" },
    ], { title: "The Thing", year: 1982 }), null);
});

test("matches a unique movie title without a page year and excludes TV results", () => {
    const movie = { id: 1, title: "The Thing", release_date: "1982-06-25", mediaType: "movie" };
    assert.equal(Core.matchingMovieCandidate([
        movie,
        { id: 2, title: "The Thing", year: 1982, mediaType: "tv" },
    ], { title: "The Thing", year: null }), movie);
    assert.equal(Core.matchingMovieCandidate([movie], { title: "", year: null }), null);
});

test("matches TV remakes by their series premiere year", () => {
    const original = { id: 1, title: "The Office", firstAirDate: "2001-07-09" };
    const remake = { id: 2, title: "The Office", first_air_date: "2005-03-24" };
    assert.equal(Core.matchingTvDetails([original, remake], { title: "The Office", year: 2005 }), remake);
});

test("reads TV years from supported Ombi detail fields", () => {
    for (const field of ["firstAired", "firstAirDate", "first_air_date", "releaseDate", "release_date", "year"]) {
        const details = { id: 1, title: "The Office", [field]: "2005-03-24" };
        assert.equal(Core.matchingTvDetails([details], { title: "The Office", year: 2005 }), details);
    }
    const details = { id: 1, title: "The Office (2005)", firstAirDate: "0001-01-01" };
    assert.equal(Core.matchingTvDetails([details], { title: "The Office", year: 2005 }), details);
});

test("rejects TV year mismatches, missing years, and duplicate title/year matches", () => {
    const original = { id: 1, title: "The Office", firstAirDate: "2001-07-09" };
    assert.equal(Core.matchingTvDetails([original], { title: "The Office", year: 2005 }), null);
    assert.equal(Core.matchingTvDetails([
        { id: 2, title: "The Office" },
    ], { title: "The Office", year: 2005 }), null);
    assert.equal(Core.matchingTvDetails([
        { id: 2, title: "The Office", firstAirDate: "2005-03-24" },
        { id: 3, title: "The Office", year: 2005 },
    ], { title: "The Office", year: 2005 }), null);
});

test("keeps authoritative TV IMDb matching despite title or date differences", () => {
    const details = { id: 1, title: "The Office (US)", externalIds: { imdb_id: "tt0386676" }, year: 2005 };
    assert.equal(Core.matchingTvDetails([
        details,
        { id: 2, title: "The Office", externalIds: { imdbId: "tt0290978" }, year: 2001 },
    ], { title: "The Office", imdbId: "tt0386676", year: 2001 }), details);
});

test("never falls back to a TV title with an explicitly different IMDb ID", () => {
    assert.equal(Core.matchingTvDetails([
        { id: 2, title: "The Office", externalIds: { imdbId: "tt0290978" }, year: 2001 },
    ], { title: "The Office", imdbId: "tt0386676" }), null);
    assert.equal(Core.matchingTvDetails([
        { id: 2, title: "The Office", imdbId: "tt0290978", year: 2001 },
    ], { title: "The Office", imdbId: "tt0386676" }), null);
});

test("allows a unique TV title fallback when no conflicting external ID exists", () => {
    const details = { id: 1, title: "The Office", year: 2005 };
    assert.equal(Core.matchingTvDetails([details], { title: "The Office", imdbId: "tt0386676", year: 2005 }), details);
    assert.equal(Core.matchingTvDetails([details], { title: "The Office" }), details);
    assert.equal(Core.matchingTvDetails([{ id: 2, title: "" }], { title: "" }), null);
});
