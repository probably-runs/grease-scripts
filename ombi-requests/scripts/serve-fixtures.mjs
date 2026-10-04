import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const port = Number(process.env.OMBI_FIXTURE_PORT || 0);
const server = http.createServer(async (request, response) => {
    try {
        const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
        const isFixture = pathname.startsWith("/test/fixtures/") && pathname.endsWith(".html");
        const isScript = pathname === "/dist/ombi-request.user.js";
        const filename = path.resolve(root, `.${pathname}`);
        if ((!isFixture && !isScript) || !filename.startsWith(root)) {
            response.writeHead(404).end();
            return;
        }
        const contents = await fs.readFile(filename);
        response.writeHead(200, {
            "Content-Type": isScript ? "text/javascript; charset=utf-8" : "text/html; charset=utf-8",
            "Cache-Control": "no-store",
        }).end(contents);
    } catch {
        response.writeHead(404).end();
    }
}).listen(port, "127.0.0.1", () => {
    console.log(`Mock Ombi browser fixture: http://127.0.0.1:${server.address().port}/test/fixtures/rotten-tomatoes-request.html`);
});
