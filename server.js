// LOCAL dev server only — Vercel serves index.html + api/ directly in prod.
// Serves the static files and routes POST /api/study to the serverless handler.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import handler from "./api/study.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

const server = http.createServer(async (req, res) => {
  if (req.url === "/api/study" && req.method === "POST") {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", async () => {
      req.body = raw ? JSON.parse(raw) : {};
      res.status = (c) => { res.statusCode = c; return res; };
      res.json = (o) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(o)); };
      await handler(req, res);
    });
    return;
  }
  const file = req.url === "/" ? "index.html" : req.url.slice(1).split("?")[0];
  try {
    const buf = await readFile(path.join(ROOT, "public", file));
    res.setHeader("content-type", TYPES[path.extname(file)] || "application/octet-stream");
    res.end(buf);
  } catch {
    res.statusCode = 404; res.end("not found");
  }
});
server.listen(3000, () => console.log("StudyBuddy dev on http://localhost:3000"));
