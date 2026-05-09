const http = require("http");
const fs = require("fs");
const path = require("path");
const { renderAdmin, renderAdminLogin, renderHome, renderResult } = require("./views/pages");
const { createAdminAuth } = require("./lib/admin-auth");
const { createVisitStore } = require("./lib/visit-store");
const { createConsentRoutes } = require("./routes/consent");

const PORT = process.env.PORT || 5600;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const VISITS_FILE = path.join(ROOT, "data", "visits.json");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin1234";
const ADMIN_COOKIE = "admin_session";

const visitStore = createVisitStore(VISITS_FILE);
const adminAuth = createAdminAuth({
  password: ADMIN_PASSWORD,
  cookieName: ADMIN_COOKIE
});
const consentRoutes = createConsentRoutes({ send, visitStore });

function send(res, status, body, contentType = "text/html; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 20_000) {
        req.destroy();
        reject(new Error("body too large"));
      }
    });
    req.on("end", () => resolve(new URLSearchParams(body)));
    req.on("error", reject);
  });
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const filePath = path.normalize(path.join(PUBLIC_DIR, url.pathname.slice(1)));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    send(res, 403, "Forbidden", "text/plain; charset=utf-8");
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    send(res, 404, "Not found", "text/plain; charset=utf-8");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = ext === ".css" ? "text/css; charset=utf-8" : "text/html; charset=utf-8";
  send(res, 200, fs.readFileSync(filePath), contentType);
}

async function handleAdminLogin(req, res) {
  const body = await parseBody(req);

  if (!adminAuth.isPasswordMatch(body.get("password") || "")) {
    send(res, 401, renderAdminLogin("비밀번호가 틀렸습니다."));
    return;
  }

  res.writeHead(303, {
    Location: "/admin",
    "Set-Cookie": adminAuth.loginCookie()
  });
  res.end();
}

function handleAdminClear(req, res) {
  if (!adminAuth.isAdmin(req)) {
    send(res, 403, "Forbidden", "text/plain; charset=utf-8");
    return;
  }

  visitStore.clearVisits();
  res.writeHead(303, { Location: "/admin" });
  res.end();
}

function handleAdminLogout(res) {
  res.writeHead(303, {
    Location: "/admin",
    "Set-Cookie": adminAuth.logoutCookie()
  });
  res.end();
}

function handleResult(req, res, url) {
  const record = visitStore.readVisits().find((visit) => visit.id === url.searchParams.get("id"));

  if (!record) {
    send(res, 404, "Record not found", "text/plain; charset=utf-8");
    return;
  }

  send(res, 200, renderResult(record));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/") {
    send(res, 200, renderHome());
    return;
  }

  if (await consentRoutes.handle(req, res, url)) {
    return;
  }

  if (req.method === "GET" && url.pathname === "/result") {
    handleResult(req, res, url);
    return;
  }

  if (req.method === "GET" && url.pathname === "/admin") {
    send(res, 200, adminAuth.isAdmin(req) ? renderAdmin(visitStore.readVisits()) : renderAdminLogin());
    return;
  }

  if (req.method === "POST" && url.pathname === "/admin-login") {
    await handleAdminLogin(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/admin-clear") {
    handleAdminClear(req, res);
    return;
  }

  if (req.method === "GET" && url.pathname === "/admin-logout") {
    handleAdminLogout(res);
    return;
  }

  if (req.method === "GET") {
    serveStatic(req, res);
    return;
  }

  send(res, 405, "Method not allowed", "text/plain; charset=utf-8");
});

server.listen(PORT, () => {
  console.log(`Consent IP site running at http://127.0.0.1:${PORT}`);
});
