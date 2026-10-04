import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryUrlInput = process.env.OMBI_REQUEST_REPOSITORY_URL?.trim();
const repositoryDirectoryInput = process.env.OMBI_REQUEST_REPOSITORY_DIRECTORY?.trim();
let repositoryMetadata = "";
if (repositoryUrlInput) {
    let repositoryUrl;
    try {
        repositoryUrl = new URL(repositoryUrlInput);
    } catch {
        throw new Error("OMBI_REQUEST_REPOSITORY_URL must be a full HTTP(S) URL.");
    }
    if (!/^https?:$/.test(repositoryUrl.protocol) || repositoryUrl.username || repositoryUrl.password) {
        throw new Error("OMBI_REQUEST_REPOSITORY_URL must be a public HTTP(S) URL without credentials.");
    }
    repositoryUrl.hash = "";
    const publicRepositoryUrl = repositoryUrl.toString().replace(/\/$/, "");
    let homepageUrl = publicRepositoryUrl;
    if (repositoryDirectoryInput) {
        const directorySegments = repositoryDirectoryInput.split("/");
        if (directorySegments.some((segment) => !segment || segment === "." || segment === ".." || segment.includes("\\"))) {
            throw new Error("OMBI_REQUEST_REPOSITORY_DIRECTORY must be a safe repository-relative path.");
        }
        const repositoryDirectory = directorySegments.map(encodeURIComponent).join("/");
        homepageUrl = `${publicRepositoryUrl}/tree/main/${repositoryDirectory}`;
    }
    repositoryMetadata = `// @homepageURL  ${homepageUrl}\n// @supportURL   ${publicRepositoryUrl}/issues\n`;
} else if (repositoryDirectoryInput) {
    throw new Error("OMBI_REQUEST_REPOSITORY_DIRECTORY requires OMBI_REQUEST_REPOSITORY_URL.");
}
const [core, body, packageText] = await Promise.all([
    fs.readFile(path.join(root, "src", "core.js"), "utf8"),
    fs.readFile(path.join(root, "src", "userscript-body.js"), "utf8"),
    fs.readFile(path.join(root, "package.json"), "utf8"),
]);
const { version } = JSON.parse(packageText);

// Each installed identity needs its own update artifact to retain its manager-owned settings.
function metadata(namespace) {
    return `// ==UserScript==
// @name         Ombi Request for IMDb & Letterboxd
// @namespace    ${namespace}
// @version      ${version}
// @description  Request movies and TV shows in Ombi from IMDb, Letterboxd, or Rotten Tomatoes.
// @author       probably-runs
${repositoryMetadata}// @match        https://www.imdb.com/title/*
// @match        https://imdb.com/title/*
// @match        https://m.imdb.com/title/*
// @match        https://letterboxd.com/*
// @match        https://www.letterboxd.com/*
// @match        https://letterboxd.com/*/film/*
// @match        https://www.letterboxd.com/*/film/*
// @match        https://www.rottentomatoes.com/m/*
// @match        https://rottentomatoes.com/m/*
// @match        https://www.rottentomatoes.com/tv/*
// @match        https://rottentomatoes.com/tv/*
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.registerMenuCommand
// @grant        GM.xmlHttpRequest
// @connect      *
// @run-at       document-idle
// ==/UserScript==`;
}

const dist = path.join(root, "dist");
await fs.mkdir(dist, { recursive: true });
for (const [filename, namespace] of [
    ["ombi-request.user.js", "io.github.probably-runs.ombi-request"],
    ["ombi-request-legacy.user.js", "https://ombi.io/"],
]) {
    const output = `${metadata(namespace)}\n\n${core.trim()}\n\n${body.trim()}\n`;
    await fs.writeFile(path.join(dist, filename), output, "utf8");
    console.log(`Built ${path.join(dist, filename)}`);
}
