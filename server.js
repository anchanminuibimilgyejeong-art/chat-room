const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { renderConsent } = require("./views/consent");

const PORT = process.env.PORT || 5600;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const VISITS_FILE = path.join(DATA_DIR, "visits.json");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin1234";
const ADMIN_COOKIE = "admin_session";

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(VISITS_FILE)) fs.writeFileSync(VISITS_FILE, "[]\n");
}

function readVisits() {
  ensureDataFile();
  try {
    return JSON.parse(fs.readFileSync(VISITS_FILE, "utf8"));
  } catch {
    return [];
  }
}

function writeVisits(visits) {
  ensureDataFile();
  fs.writeFileSync(VISITS_FILE, JSON.stringify(visits, null, 2) + "\n");
}

function htmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([key, value]) => key && value)
      .map(([key, value]) => [key, decodeURIComponent(value)])
  );
}

function adminToken() {
  return crypto.createHash("sha256").update(`admin:${ADMIN_PASSWORD}`).digest("hex");
}

function isAdmin(req) {
  return parseCookies(req)[ADMIN_COOKIE] === adminToken();
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

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  const rawIp = Array.isArray(forwarded) ? forwarded[0] : forwarded || req.socket.remoteAddress || "";
  const firstIp = rawIp.split(",")[0].trim();
  return firstIp.replace(/^::ffff:/, "") || "unknown";
}

function isPublicIp(ip) {
  if (!ip || ip === "unknown") return false;
  if (ip === "::1" || ip === "127.0.0.1") return false;
  if (/^10\./.test(ip)) return false;
  if (/^192\.168\./.test(ip)) return false;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return false;
  return true;
}

async function lookupIp(ip) {
  if (!isPublicIp(ip)) {
    return {
      source: "local",
      city: "로컬 테스트",
      region: "",
      country: "",
      postal: "",
      latitude: "",
      longitude: "",
      org: "",
      note: "로컬/사설 IP라서 실제 주소 추정이 불가능합니다. 배포된 사이트에서 접속하면 공인 IP 기준으로 조회됩니다."
    };
  }

  const lookups = await Promise.allSettled([
    lookupIpapi(ip),
    lookupIpwho(ip),
    lookupIpApi(ip)
  ]);
  const candidates = lookups
    .filter((result) => result.status === "fulfilled" && result.value.city)
    .map((result) => result.value);

  if (!candidates.length) throw new Error("all IP lookup providers failed");
  return chooseBestGeo(candidates);
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "consent-ip-location-demo/1.0" }
    });
    if (!response.ok) throw new Error(`${url} ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function lookupIpapi(ip) {
  const data = await fetchJson(`https://ipapi.co/${encodeURIComponent(ip)}/json/`);
  return {
    source: "ipapi.co",
    city: data.city || "",
    region: data.region || "",
    country: data.country_name || "",
    postal: data.postal || "",
    latitude: data.latitude || "",
    longitude: data.longitude || "",
    org: data.org || ""
  };
}

async function lookupIpwho(ip) {
  const data = await fetchJson(`https://ipwho.is/${encodeURIComponent(ip)}`);
  if (data.success === false) throw new Error(data.message || "ipwho.is failed");
  return {
    source: "ipwho.is",
    city: data.city || "",
    region: data.region || "",
    country: data.country || "",
    postal: data.postal || "",
    latitude: data.latitude || "",
    longitude: data.longitude || "",
    org: data.connection?.org || data.connection?.isp || ""
  };
}

async function lookupIpApi(ip) {
  const fields = "status,message,country,regionName,city,zip,lat,lon,isp,org";
  const data = await fetchJson(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=${fields}`);
  if (data.status === "fail") throw new Error(data.message || "ip-api failed");
  return {
    source: "ip-api.com",
    city: data.city || "",
    region: data.regionName || "",
    country: data.country || "",
    postal: data.zip || "",
    latitude: data.lat || "",
    longitude: data.lon || "",
    org: data.org || data.isp || ""
  };
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function agreementScore(candidate, allCandidates) {
  return allCandidates.reduce((score, other) => {
    if (normalize(candidate.city) && normalize(candidate.city) === normalize(other.city)) score += 3;
    if (normalize(candidate.region) && normalize(candidate.region) === normalize(other.region)) score += 2;
    if (normalize(candidate.country) && normalize(candidate.country) === normalize(other.country)) score += 1;
    return score;
  }, 0);
}

function chooseBestGeo(candidates) {
  const ranked = candidates
    .map((candidate) => ({ ...candidate, score: agreementScore(candidate, candidates) }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const agreedCities = new Set(ranked.map((item) => normalize(item.city)).filter(Boolean));
  const confidence = ranked.length >= 2 && agreedCities.size === 1 ? "높음" : ranked.length >= 2 ? "보통" : "낮음";
  const proxyWarning = ranked.some((item) => hasProxySignal(item));

  return {
    ...best,
    source: ranked.map((item) => item.source).join(", "),
    confidence: proxyWarning ? "낮음" : confidence,
    providers: ranked,
    note: proxyWarning
      ? "프록시/VPN/브라우저 프리페치로 보이는 IP입니다. 이 경우 실제 접속자의 위치가 아니라 중계 서버 위치가 표시될 수 있습니다."
      : `IP 기반 위치는 실제 집 주소가 아니라 네트워크 등록 위치입니다. 여러 조회 결과 기준 신뢰도: ${confidence}`
  };
}

function hasProxySignal(candidate) {
  const text = normalize(`${candidate.org} ${candidate.source}`);
  return ["proxy", "vpn", "relay", "prefetch", "cloudflare", "google chrome"].some((word) => text.includes(word));
}

function send(res, status, body, contentType = "text/html; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const fileName = url.pathname.slice(1);
  const filePath = path.normalize(path.join(PUBLIC_DIR, fileName));

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

function renderResult(record) {
  const address = [record.geo.city, record.geo.region, record.geo.country].filter(Boolean).join(", ") || "주소 정보 없음";
  const providerRows = (record.geo.providers || [])
    .map((provider) => {
      const providerAddress = [provider.city, provider.region, provider.country].filter(Boolean).join(", ") || "-";
      return `<tr><td>${htmlEscape(provider.source)}</td><td>${htmlEscape(providerAddress)}</td><td>${htmlEscape(provider.postal || "-")}</td><td>${htmlEscape(provider.latitude || "-")}, ${htmlEscape(provider.longitude || "-")}</td></tr>`;
    })
    .join("");
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>IP 확인 결과</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <main class="shell">
    <section class="panel result">
      <p class="eyebrow">동의 완료</p>
      <h1>확인된 IP</h1>
      <div class="ip">${htmlEscape(record.ip)}</div>
      <dl>
        <div><dt>추정 위치</dt><dd>${htmlEscape(address)}</dd></div>
        <div><dt>우편번호</dt><dd>${htmlEscape(record.geo.postal || "-")}</dd></div>
        <div><dt>좌표</dt><dd>${htmlEscape(record.geo.latitude || "-")}, ${htmlEscape(record.geo.longitude || "-")}</dd></div>
        <div><dt>통신사/기관</dt><dd>${htmlEscape(record.geo.org || "-")}</dd></div>
        <div><dt>신뢰도</dt><dd>${htmlEscape(record.geo.confidence || "-")}</dd></div>
      </dl>
      <p class="note">${htmlEscape(record.geo.note)}</p>
      ${providerRows ? `<div class="providerBox">
        <h2>조회한 위치 후보</h2>
        <table>
          <thead><tr><th>출처</th><th>위치</th><th>우편번호</th><th>좌표</th></tr></thead>
          <tbody>${providerRows}</tbody>
        </table>
      </div>` : ""}
    </section>
  </main>
</body>
</html>`;
}

function renderAdminLogin(error = "") {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>관리자 로그인</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <main class="shell">
    <section class="panel">
      <p class="eyebrow">관리자</p>
      <h1>비밀번호 입력</h1>
      <form method="post" action="/admin-login">
        <label class="field">
          <span>관리자 비밀번호</span>
          <input name="password" type="password" autocomplete="current-password" required autofocus>
        </label>
        ${error ? `<p class="errorText">${htmlEscape(error)}</p>` : ""}
        <button class="button" type="submit">들어가기</button>
      </form>
    </section>
  </main>
</body>
</html>`;
}

function renderAdmin() {
  const rows = readVisits().slice().reverse();
  const body = rows.map((visit) => {
    const address = [visit.geo?.city, visit.geo?.region, visit.geo?.country].filter(Boolean).join(", ");
    const coords = [visit.geo?.latitude, visit.geo?.longitude].filter(Boolean).join(", ");
    return `<tr>
      <td>${htmlEscape(visit.createdAt)}</td>
      <td>${htmlEscape(visit.ip)}</td>
      <td>
        <div>${htmlEscape(address || "-")}</div>
        <div class="mutedNumber">${htmlEscape(coords || "-")}</div>
      </td>
      <td>${htmlEscape(visit.geo?.confidence || "-")}</td>
      <td>${htmlEscape(visit.geo?.postal || "-")}</td>
      <td>${htmlEscape(visit.userAgent)}</td>
    </tr>`;
  }).join("");

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>동의 기록</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <main class="admin">
    <header>
      <div>
        <p class="eyebrow">관리자</p>
        <h1>동의한 접속 기록</h1>
      </div>
      <div class="adminActions">
        <form method="post" action="/admin-clear" onsubmit="return confirm('기록을 전부 삭제할까요?');">
          <button class="button danger" type="submit">기록 삭제</button>
        </form>
        <a class="button secondary" href="/admin-logout">로그아웃</a>
      </div>
    </header>
    <div class="tableWrap">
      <table>
        <thead>
          <tr><th>시간</th><th>IP</th><th>추정 위치</th><th>신뢰도</th><th>우편번호</th><th>User-Agent</th></tr>
        </thead>
        <tbody>${body || `<tr><td colspan="6">아직 동의한 기록이 없습니다.</td></tr>`}</tbody>
      </table>
    </div>
  </main>
</body>
</html>`;
}

async function handleCollect(req, res) {
  const ip = getClientIp(req);
  let geo;
  try {
    geo = await lookupIp(ip);
  } catch (error) {
    geo = {
      source: "error",
      city: "",
      region: "",
      country: "",
      postal: "",
      latitude: "",
      longitude: "",
      org: "",
      note: `IP 위치 조회 실패: ${error.message}`
    };
  }

  const record = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    consent: true,
    ip,
    geo,
    userAgent: req.headers["user-agent"] || ""
  };

  const visits = readVisits();
  visits.push(record);
  writeVisits(visits);

  res.writeHead(303, { Location: `/result?id=${encodeURIComponent(record.id)}` });
  res.end();
}

async function handleAdminLogin(req, res) {
  const body = await parseBody(req);
  const password = body.get("password") || "";

  if (password !== ADMIN_PASSWORD) {
    send(res, 401, renderAdminLogin("비밀번호가 틀렸습니다."));
    return;
  }

  res.writeHead(303, {
    Location: "/admin",
    "Set-Cookie": `${ADMIN_COOKIE}=${encodeURIComponent(adminToken())}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`
  });
  res.end();
}

function handleAdminClear(req, res) {
  if (!isAdmin(req)) {
    send(res, 403, "Forbidden", "text/plain; charset=utf-8");
    return;
  }

  writeVisits([]);
  res.writeHead(303, { Location: "/admin" });
  res.end();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/") {
    send(res, 200, renderConsent());
    return;
  }

  if (req.method === "GET" && url.pathname === "/consent") {
    res.writeHead(303, { Location: "/" });
    res.end();
    return;
  }

  if (req.method === "POST" && url.pathname === "/collect") {
    await handleCollect(req, res);
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
    res.writeHead(303, {
      Location: "/admin",
      "Set-Cookie": `${ADMIN_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
    });
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/result") {
    const record = readVisits().find((visit) => visit.id === url.searchParams.get("id"));
    if (!record) {
      send(res, 404, "Record not found", "text/plain; charset=utf-8");
      return;
    }
    send(res, 200, renderResult(record));
    return;
  }

  if (req.method === "GET" && url.pathname === "/admin") {
    if (!isAdmin(req)) {
      send(res, 200, renderAdminLogin());
      return;
    }
    send(res, 200, renderAdmin());
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
