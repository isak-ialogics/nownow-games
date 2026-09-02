import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, relative, resolve } from "node:path";

const root = resolve(process.argv[2] ?? "dist");
const port = Number(process.env.PORT ?? 4173);
const contentTypes = Object.freeze({
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
});

createServer(async (request, response) => {
  try {
    const url = new URL(
      request.url,
      `http://${request.headers.host ?? "localhost"}`,
    );
    const pathname = decodeURIComponent(url.pathname);
    let file = resolve(root, `.${pathname}`);

    if (relative(root, file).startsWith("..")) {
      response.writeHead(403).end("Forbidden");
      return;
    }

    const metadata = await stat(file);
    if (metadata.isDirectory()) file = resolve(file, "index.html");
    await stat(file);

    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": contentTypes[extname(file)] ?? "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
    });
    if (request.method === "HEAD") response.end();
    else createReadStream(file).pipe(response);
  } catch {
    response
      .writeHead(404, { "Content-Type": "text/plain; charset=utf-8" })
      .end("Not found");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`Serving ${root} at http://127.0.0.1:${port}`);
});
