const http = require("http");
const fs = require("fs/promises");
const path = require("path");

const PORT = Number(process.env.PORT || 5600);
const DATA_DIR = path.join(__dirname, "data");
const LOG_FILE = path.join(DATA_DIR, "visits.json");
const PREVIEW_IMAGE = path.join(__dirname, "assets", "bhc-coupon.jfif");

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "x-content-type-options": "nosniff",
    ...headers
  });
  res.end(body);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getVisitorIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }

  return req.socket.remoteAddress || "unknown";
}

async function readLogs() {
  try {
    const raw = await fs.readFile(LOG_FILE, "utf8");
    const logs = JSON.parse(raw);
    return Array.isArray(logs) ? logs : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeLogs(logs) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(LOG_FILE, JSON.stringify(logs.slice(-500), null, 2));
}

async function saveVisit(req) {
  const logs = await readLogs();
  logs.push({
    time: new Date().toISOString(),
    ip: getVisitorIp(req),
    userAgent: req.headers["user-agent"] || "",
    path: req.url || "/"
  });
  await writeLogs(logs);
}

function publicPage(imageUrl) {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title></title>
  <meta property="og:type" content="website">
  <meta property="og:image" content="${escapeHtml(imageUrl)}">
</head>
<body></body>
</html>`;
}

function adminPage(logs) {
  const rows = logs.slice().reverse().map((log) => `
    <tr>
      <td>${escapeHtml(new Date(log.time).toLocaleString("ko-KR"))}</td>
      <td>${escapeHtml(log.ip)}</td>
      <td>${escapeHtml(log.path)}</td>
      <td>${escapeHtml(log.userAgent)}</td>
    </tr>
  `).join("");

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>관리자 접속 기록</title>
  <style>
    body {
      margin: 0;
      background: #f6f7f2;
      color: #1e2320;
      font-family: "Segoe UI", system-ui, sans-serif;
    }
    main {
      width: min(1180px, calc(100% - 28px));
      margin: 0 auto;
      padding: 28px 0;
    }
    header {
      display: flex;
      align-items: end;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 18px;
    }
    h1 {
      margin: 0;
      font-size: 30px;
      letter-spacing: 0;
    }
    .count {
      color: #63716a;
      font-weight: 700;
    }
    .table-wrap {
      overflow-x: auto;
      border: 1px solid #d8ddd4;
      border-radius: 8px;
      background: white;
      box-shadow: 0 16px 50px rgba(32, 45, 38, 0.1);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 840px;
    }
    th,
    td {
      padding: 13px 14px;
      border-bottom: 1px solid #e7ebe5;
      text-align: left;
      vertical-align: top;
      font-size: 14px;
      line-height: 1.45;
    }
    th {
      background: #eef3ef;
      font-size: 13px;
      color: #46544e;
    }
    td:nth-child(4) {
      max-width: 520px;
      overflow-wrap: anywhere;
    }
    .empty {
      padding: 24px;
      color: #63716a;
    }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>접속 기록</h1>
      <div class="count">총 ${logs.length}개</div>
    </header>
    <div class="table-wrap">
      ${logs.length ? `<table>
        <thead>
          <tr>
            <th>시간</th>
            <th>IP</th>
            <th>경로</th>
            <th>브라우저</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>` : `<div class="empty">아직 접속 기록이 없습니다.</div>`}
    </div>
  </main>
</body>
</html>`;
}

async function handle(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  try {
    if (url.pathname === "/assets/bhc-coupon.jfif") {
      const image = await fs.readFile(PREVIEW_IMAGE);
      res.writeHead(200, {
        "content-type": "image/jpeg",
        "cache-control": "public, max-age=86400",
        "x-content-type-options": "nosniff"
      });
      res.end(image);
      return;
    }

    if (url.pathname === "/admin") {
      send(res, 200, adminPage(await readLogs()));
      return;
    }

    if (url.pathname === "/") {
      await saveVisit(req);
      const protocol = req.headers["x-forwarded-proto"] || "http";
      const imageUrl = `${protocol}://${req.headers.host}/assets/bhc-coupon.jfif`;
      send(res, 200, publicPage(imageUrl));
      return;
    }

    send(res, 404, "페이지를 찾을 수 없습니다.");
  } catch (error) {
    console.error(error);
    send(res, 500, "서버 오류가 발생했습니다.");
  }
}

http.createServer(handle).listen(PORT, () => {
  console.log(`Server running at http://127.0.0.1:${PORT}`);
  console.log(`Admin page: http://127.0.0.1:${PORT}/admin`);
  console.log("Admin page has no password. Do not publish this version as-is.");
});
