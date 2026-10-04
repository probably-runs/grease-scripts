const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const originalIdentity = {
    name: "Ombi Request for IMDb & Letterboxd",
    namespace: "https://ombi.io/",
};
const filenames = ["ombi-request.user.js", "ombi-request-legacy.user.js"];

function readBuild(filename, directory = root) {
    const script = fs.readFileSync(path.join(directory, "dist", filename), "utf8").replace(/\r\n/g, "\n");
    const header = script.match(/^\/\/ ==UserScript==\r?\n([\s\S]*?)\/\/ ==\/UserScript==\r?\n/);
    assert.ok(header, `${filename} must start with a complete userscript metadata block`);
    const metadata = new Map();
    for (const [, key, value] of header[1].matchAll(/^\/\/ @(\S+)\s+(.+)$/gm)) {
        const values = metadata.get(key) || [];
        values.push(value.trim());
        metadata.set(key, values);
    }
    return { script, metadata, body: script.slice(header[0].length).trim() };
}

test("legacy build keeps the original installed Greasemonkey name and namespace", () => {
    const legacy = readBuild("ombi-request-legacy.user.js");
    assert.deepEqual(legacy.metadata.get("name"), [originalIdentity.name]);
    assert.deepEqual(legacy.metadata.get("namespace"), [originalIdentity.namespace]);

    const standard = readBuild("ombi-request.user.js");
    assert.deepEqual(standard.metadata.get("name"), [originalIdentity.name]);
    assert.deepEqual(standard.metadata.get("namespace"), ["io.github.probably-runs.ombi-request"]);
});

test("both build versions and publishing authors match the package", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    for (const filename of filenames) {
        const { metadata } = readBuild(filename);
        assert.deepEqual(metadata.get("version"), [pkg.version], filename);
        assert.deepEqual(metadata.get("author"), ["probably-runs"], filename);
    }
});

test("both builds retain the same permissions and IMDb, Letterboxd, and Rotten Tomatoes routes", () => {
    const standard = readBuild("ombi-request.user.js");
    const legacy = readBuild("ombi-request-legacy.user.js");
    const grants = ["GM.getValue", "GM.setValue", "GM.registerMenuCommand", "GM.xmlHttpRequest"];
    const matches = [
        "https://www.imdb.com/title/*",
        "https://imdb.com/title/*",
        "https://m.imdb.com/title/*",
        "https://letterboxd.com/*",
        "https://www.letterboxd.com/*",
        "https://letterboxd.com/*/film/*",
        "https://www.letterboxd.com/*/film/*",
        "https://www.rottentomatoes.com/m/*",
        "https://rottentomatoes.com/m/*",
        "https://www.rottentomatoes.com/tv/*",
        "https://rottentomatoes.com/tv/*",
    ];
    for (const { metadata } of [standard, legacy]) {
        assert.deepEqual(metadata.get("grant"), grants);
        assert.deepEqual(metadata.get("match"), matches);
        assert.deepEqual(metadata.get("connect"), ["*"]);
        assert.deepEqual(metadata.get("run-at"), ["document-idle"]);
    }
    const allowedDifferences = new Set(["namespace", "homepageURL", "supportURL"]);
    for (const [key, values] of standard.metadata) {
        if (!allowedDifferences.has(key)) assert.deepEqual(legacy.metadata.get(key), values, key);
    }
});

test("compatibility build uses the same source and configuration storage key", () => {
    const standard = readBuild("ombi-request.user.js");
    const legacy = readBuild("ombi-request-legacy.user.js");
    const core = fs.readFileSync(path.join(root, "src", "core.js"), "utf8").replace(/\r\n/g, "\n").trim();
    const body = fs.readFileSync(path.join(root, "src", "userscript-body.js"), "utf8").replace(/\r\n/g, "\n").trim();
    const expectedBody = `${core}\n\n${body}`;

    assert.equal(standard.body, expectedBody);
    assert.equal(legacy.body, expectedBody);
    for (const build of [standard, legacy]) {
        assert.equal(build.body.match(/const CONFIG_KEY = "([^"]+)";/)?.[1], "ombi-request-config-v1");
        assert.match(build.body, /GM\.getValue\(CONFIG_KEY, ""\)/);
        assert.match(build.body, /GM\.setValue\(CONFIG_KEY, JSON\.stringify\(config\)\)/);
    }
});

test("building twice produces identical public and compatibility scripts", (t) => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ombi-request-build-"));
    assert.equal(path.dirname(temporaryRoot), path.resolve(os.tmpdir()));
    assert.match(path.basename(temporaryRoot), /^ombi-request-build-.+/);
    t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
    for (const directory of ["scripts", "src"]) {
        fs.mkdirSync(path.join(temporaryRoot, directory));
    }
    for (const filename of ["package.json", "scripts/build.mjs", "src/core.js", "src/userscript-body.js"]) {
        fs.copyFileSync(path.join(root, filename), path.join(temporaryRoot, filename));
    }
    const env = { ...process.env };
    delete env.OMBI_REQUEST_REPOSITORY_URL;
    delete env.OMBI_REQUEST_REPOSITORY_DIRECTORY;
    const build = () => {
        const result = spawnSync(process.execPath, [path.join(temporaryRoot, "scripts", "build.mjs")], {
            cwd: temporaryRoot,
            env,
            encoding: "utf8",
        });
        assert.equal(result.status, 0, result.stderr || result.error?.message);
        return filenames.map((filename) => readBuild(filename, temporaryRoot).script);
    };
    assert.deepEqual(build(), build());
});
