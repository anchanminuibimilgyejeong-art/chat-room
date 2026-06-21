const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 5600);
const DATA_DIR = path.join(__dirname, "data");
const LOG_FILE = path.join(DATA_DIR, "visits.json");
const PREVIEW_IMAGE = path.join(__dirname, "assets", "bhc-coupon.jfif");
const IP_INFO_CACHE = new Map();
const IP_INFO_CACHE_MS = 6 * 60 * 60 * 1000;

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

function normalizeIp(ip) {
  return String(ip || "").replace(/^::ffff:/, "");
}

function headerValue(value) {
  return Array.isArray(value) ? value.join(", ") : value || "-";
}

function isPublicIp(ip) {
  const value = normalizeIp(ip);
  return value
    && value !== "::1"
    && value !== "localhost"
    && !value.startsWith("127.")
    && !value.startsWith("10.")
    && !value.startsWith("192.168.")
    && !value.startsWith("172.16.");
}

async function getIpInfo(ip) {
  const normalizedIp = normalizeIp(ip);

  if (!isPublicIp(normalizedIp)) {
    return { status: "로컬/사설 IP" };
  }

  const cached = IP_INFO_CACHE.get(normalizedIp);
  if (cached && Date.now() - cached.savedAt < IP_INFO_CACHE_MS) {
    return cached.data;
  }

  try {
    const response = await fetch(`https://ipwho.is/${encodeURIComponent(normalizedIp)}`, {
      signal: AbortSignal.timeout(5000)
    });
    const data = await response.json();

    if (!response.ok || data.success === false) {
      throw new Error("GeoIP lookup failed");
    }

    const info = {
      status: "조회 완료",
      location: [data.city, data.region, data.country].filter(Boolean).join(", "),
      continent: [data.continent, data.continent_code].filter(Boolean).join(" / "),
      continentCode: data.continent_code || "",
      country: [data.country, data.country_code].filter(Boolean).join(" / "),
      countryCode: data.country_code || "",
      region: [data.region, data.region_code].filter(Boolean).join(" / "),
      regionCode: data.region_code || "",
      postcode: data.postal || "",
      coordinates: [data.latitude, data.longitude].filter((value) => value !== undefined && value !== null).join(", "),
      capital: data.capital || "",
      callingCode: data.calling_code || "",
      borders: data.borders || "",
      flag: data.flag?.emoji || "",
      isEu: data.is_eu,
      timezone: data.timezone?.id || "",
      timezoneAbbr: data.timezone?.abbr || "",
      timezoneUtc: data.timezone?.utc || "",
      timezoneOffset: data.timezone?.offset,
      daylightSaving: data.timezone?.is_dst,
      isp: data.connection?.isp || "",
      org: data.connection?.org || "",
      asn: data.connection?.asn ? `AS${data.connection.asn}` : "",
      domain: data.connection?.domain || "",
      networkType: data.type || "",
      proxy: data.security?.proxy,
      vpn: data.security?.vpn,
      tor: data.security?.tor,
      raw: data
    };

    IP_INFO_CACHE.set(normalizedIp, { data: info, savedAt: Date.now() });
    return info;
  } catch (error) {
    return { status: "조회 실패" };
  }
}

async function getIpInfoMap(logs) {
  const uniqueIps = [...new Set(logs.map((log) => normalizeIp(log.ip)))].slice(-50);
  const results = await Promise.all(uniqueIps.map(async (ip) => [ip, await getIpInfo(ip)]));
  return new Map(results);
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
    id: crypto.randomUUID(),
    time: new Date().toISOString(),
    ip: getVisitorIp(req),
    userAgent: req.headers["user-agent"] || "",
    path: req.url || "/",
    consent: "기록 없음",
    host: headerValue(req.headers.host),
    forwardedFor: headerValue(req.headers["x-forwarded-for"]),
    forwardedProto: headerValue(req.headers["x-forwarded-proto"]),
    realIp: headerValue(req.headers["x-real-ip"]),
    acceptLanguage: headerValue(req.headers["accept-language"]),
    accept: headerValue(req.headers.accept),
    referer: headerValue(req.headers.referer),
    connectionIp: req.socket.remoteAddress || "-",
    httpVersion: req.httpVersion || "-"
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

function adminPage(logs, ipInfoMap) {
  const entries = logs.slice().reverse().map((log, index) => renderVisit(log, ipInfoMap.get(normalizeIp(log.ip)), index === 0)).join("");

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
    .log-list {
      display: grid;
      gap: 12px;
    }
    .log-card {
      border: 1px solid #d8ddd4;
      border-radius: 8px;
      background: white;
      box-shadow: 0 10px 32px rgba(32, 45, 38, 0.08);
    }
    summary {
      padding: 15px 16px;
      color: #167a67;
      cursor: pointer;
      font-weight: 750;
      line-height: 1.5;
    }
    pre {
      overflow: auto;
      margin: 0;
      padding: 0 16px 16px;
      color: #304039;
      font: 13px/1.58 Consolas, monospace;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .notice {
      margin: 0 0 18px;
      color: #63716a;
      font-size: 14px;
      line-height: 1.55;
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
    <p class="notice">IP 위치 정보는 대략적인 값입니다. 관리자 페이지를 열 때 IP가 공개 GeoIP 조회 서비스로 전송됩니다.</p>
    <section class="log-list">${logs.length ? entries : `<div class="empty">아직 접속 기록이 없습니다.</div>`}</section>
  </main>
</body>
</html>`;
}

function renderVisit(log, info, open) {
  const ip = normalizeIp(log.ip);
  const summary = [
    new Date(log.time).toLocaleString("ko-KR"),
    ip,
    info?.location,
    info?.postcode,
    info?.isp
  ].filter(Boolean).join(" | ");

  const lines = [
    ["ID", log.id || "이전 기록에는 ID 없음"],
    ["시간", log.time],
    ["동의", log.consent || "기록 없음"],
    ["IP", ip],
    ["위치 출처", info?.status === "조회 완료" ? "ipwho.is (공개 GeoIP)" : info?.status || "조회 안 됨"],
    ["대륙", info?.continent],
    ["국가", info?.country],
    ["지역", info?.region],
    ["도시", info?.location],
    ["우편번호", info?.postcode],
    ["위도/경도 (대략)", info?.coordinates],
    ["시간대", [info?.timezone, info?.timezoneAbbr, info?.timezoneUtc].filter(Boolean).join(" / ")],
    ["서머타임", info?.daylightSaving === undefined ? "-" : info.daylightSaving ? "예" : "아니오"],
    ["대륙 코드", info?.continentCode],
    ["국가 코드", info?.countryCode],
    ["지역 코드", info?.regionCode],
    ["국가 전화번호", info?.callingCode && `+${info.callingCode}`],
    ["수도", info?.capital],
    ["기관/ISP", info?.isp],
    ["조직", info?.org],
    ["ASN", info?.asn],
    ["도메인", info?.domain],
    ["IP 유형", info?.networkType],
    ["프록시/VPN/Tor", formatSecurity(info)],
    ["위치 메모", "IP 기반 위치는 실제 집 주소가 아니라 네트워크 등록 위치에 가까운 대략값입니다."],
    ["요청 URL", log.path],
    ["Host", log.host],
    ["Forwarded-For", log.forwardedFor],
    ["Forwarded-Proto", log.forwardedProto],
    ["Real-IP", log.realIp],
    ["Accept-Language", log.acceptLanguage],
    ["Accept", log.accept],
    ["Referer", log.referer],
    ["Connection IP", log.connectionIp],
    ["HTTP Version", log.httpVersion],
    ["User-Agent", log.userAgent],
    ["GeoIP 원본 응답", info?.raw ? JSON.stringify(info.raw, null, 2) : "-"]
  ].map(([label, value]) => `${label}: ${value || "-"}`).join("\n");

  return `<details class="log-card"${open ? " open" : ""}><summary>${escapeHtml(summary)}</summary><pre>${escapeHtml(lines)}</pre></details>`;
}

function formatLocation(info) {
  if (!info || info.status !== "조회 완료") return info?.status || "--";
  return [
    info.flag && `${info.flag} ${info.location}`,
    info.continent,
    info.timezone,
    info.timezoneAbbr && `${info.timezoneAbbr} (${info.timezoneUtc || "UTC"})`,
    info.postcode && `우편번호 ${info.postcode}`
  ]
    .filter(Boolean)
    .join("\n");
}

function formatCoordinates(info) {
  if (!info || info.status !== "조회 완료") return "--";
  return [
    info.coordinates && `좌표(대략): ${info.coordinates}`,
    info.country,
    info.region,
    info.capital && `수도: ${info.capital}`,
    info.callingCode && `국가번호: +${info.callingCode}`,
    info.borders && `국경: ${info.borders}`,
    info.isEu !== undefined && `EU: ${info.isEu ? "예" : "아니오"}`,
    info.daylightSaving !== undefined && `서머타임: ${info.daylightSaving ? "예" : "아니오"}`
  ].filter(Boolean).join("\n");
}

function formatNetwork(info) {
  if (!info || info.status !== "조회 완료") return "--";
  return [info.isp, info.org, info.asn, info.domain, info.networkType]
    .filter(Boolean)
    .join("\n");
}

function formatSecurity(info) {
  if (!info || info.status !== "조회 완료") return "--";
  if (info.proxy === undefined && info.vpn === undefined && info.tor === undefined) {
    return "이 GeoIP 서비스에서는 제공하지 않음";
  }
  return [
    `프록시: ${info.proxy ? "예" : "아니오"}`,
    `VPN: ${info.vpn ? "예" : "아니오"}`,
    `Tor: ${info.tor ? "예" : "아니오"}`
  ].join("\n");
}

function renderFullInfo(info) {
  if (!info || info.status !== "조회 완료") return "--";
  return `<details><summary>전체 데이터 보기</summary><pre>${escapeHtml(JSON.stringify(info.raw, null, 2))}</pre></details>`;
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
      const logs = await readLogs();
      send(res, 200, adminPage(logs, await getIpInfoMap(logs)));
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
