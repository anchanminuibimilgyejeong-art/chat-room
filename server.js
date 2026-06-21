const http = require("http");
const https = require("https");
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 5600);
const DATA_DIR = path.join(__dirname, "data");
const LOG_FILE = path.join(DATA_DIR, "visits.json");
const PREVIEW_IMAGE = path.join(__dirname, "assets", "discord-preview.png");
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

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https:") ? https : http;
    const request = client.get(url, {
      headers: {
        accept: "application/json",
        "user-agent": "PrivateVisitLog/1.0"
      }
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }

        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });

    request.setTimeout(7000, () => request.destroy(new Error("GeoIP request timed out")));
    request.on("error", reject);
  });
}

function buildIpInfo(data, source, fields = {}) {
  return {
    status: "조회 완료",
    source,
    location: [fields.city, fields.region, fields.country].filter(Boolean).join(", "),
    continent: [fields.continent, fields.continentCode].filter(Boolean).join(" / "),
    continentCode: fields.continentCode || "",
    country: [fields.country, fields.countryCode].filter(Boolean).join(" / "),
    countryCode: fields.countryCode || "",
    region: [fields.region, fields.regionCode].filter(Boolean).join(" / "),
    regionCode: fields.regionCode || "",
    postcode: fields.postcode || "",
    coordinates: [fields.latitude, fields.longitude].filter((value) => value !== undefined && value !== null).join(", "),
    capital: fields.capital || "",
    callingCode: fields.callingCode || "",
    borders: fields.borders || "",
    flag: fields.flag || "",
    isEu: fields.isEu,
    timezone: fields.timezone || "",
    timezoneAbbr: fields.timezoneAbbr || "",
    timezoneUtc: fields.timezoneUtc || "",
    timezoneOffset: fields.timezoneOffset,
    daylightSaving: fields.daylightSaving,
    isp: fields.isp || "",
    org: fields.org || "",
    asn: fields.asn || "",
    domain: fields.domain || "",
    networkType: fields.networkType || "",
    proxy: fields.proxy,
    vpn: fields.vpn,
    tor: fields.tor,
    mobile: fields.mobile,
    hosting: fields.hosting,
    raw: data
  };
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

  const providers = [
    async () => {
      const data = await requestJson(`https://ipwho.is/${encodeURIComponent(normalizedIp)}`);
      if (data.success === false) throw new Error(data.message || "ipwho.is failed");
      return buildIpInfo(data, "ipwho.is", {
        city: data.city, region: data.region, regionCode: data.region_code,
        country: data.country, countryCode: data.country_code,
        continent: data.continent, continentCode: data.continent_code,
        postcode: data.postal, latitude: data.latitude, longitude: data.longitude,
        capital: data.capital, callingCode: data.calling_code, borders: data.borders,
        flag: data.flag?.emoji, isEu: data.is_eu, timezone: data.timezone?.id,
        timezoneAbbr: data.timezone?.abbr, timezoneUtc: data.timezone?.utc,
        timezoneOffset: data.timezone?.offset, daylightSaving: data.timezone?.is_dst,
        isp: data.connection?.isp, org: data.connection?.org,
        asn: data.connection?.asn && `AS${data.connection.asn}`,
        domain: data.connection?.domain, networkType: data.type,
        proxy: data.security?.proxy, vpn: data.security?.vpn, tor: data.security?.tor
      });
    },
    async () => {
      const data = await requestJson(`https://ipapi.co/${encodeURIComponent(normalizedIp)}/json/`);
      if (data.error) throw new Error(data.reason || "ipapi.co failed");
      return buildIpInfo(data, "ipapi.co", {
        city: data.city, region: data.region, regionCode: data.region_code,
        country: data.country_name, countryCode: data.country_code,
        continentCode: data.continent_code, postcode: data.postal,
        latitude: data.latitude, longitude: data.longitude, capital: data.country_capital,
        callingCode: data.country_calling_code?.replace(/^\+/, ""), isEu: data.in_eu,
        timezone: data.timezone, timezoneUtc: data.utc_offset, isp: data.org,
        asn: data.asn, networkType: data.version
      });
    },
    async () => {
      const data = await requestJson(`http://ip-api.com/json/${encodeURIComponent(normalizedIp)}?fields=status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,asname,mobile,proxy,hosting,query`);
      if (data.status !== "success") throw new Error(data.message || "ip-api.com failed");
      return buildIpInfo(data, "ip-api.com", {
        city: data.city, region: data.regionName, regionCode: data.region,
        country: data.country, countryCode: data.countryCode, postcode: data.zip,
        latitude: data.lat, longitude: data.lon, timezone: data.timezone,
        isp: data.isp, org: data.org, asn: data.as, domain: data.asname,
        proxy: data.proxy, mobile: data.mobile, hosting: data.hosting
      });
    }
  ];

  for (const provider of providers) {
    try {
      const info = await provider();
      IP_INFO_CACHE.set(normalizedIp, { data: info, savedAt: Date.now() });
      return info;
    } catch (error) {
      // Try the next provider when a provider blocks, limits, or times out.
    }
  }

  return { status: "조회 실패" };
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

async function sendPreviewImage(res) {
  const image = await fs.readFile(PREVIEW_IMAGE);
  res.writeHead(200, {
    "content-type": "image/png",
    "cache-control": "public, max-age=86400",
    "x-content-type-options": "nosniff"
  });
  res.end(image);
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
    ["위치 출처", info?.status === "조회 완료" ? `${info.source} (공개 GeoIP)` : info?.status || "조회 안 됨"],
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
    `Tor: ${info.tor ? "예" : "아니오"}`,
    info.mobile !== undefined && `모바일망: ${info.mobile ? "예" : "아니오"}`,
    info.hosting !== undefined && `호스팅/데이터센터: ${info.hosting ? "예" : "아니오"}`
  ].filter(Boolean).join("\n");
}

function renderFullInfo(info) {
  if (!info || info.status !== "조회 완료") return "--";
  return `<details><summary>전체 데이터 보기</summary><pre>${escapeHtml(JSON.stringify(info.raw, null, 2))}</pre></details>`;
}

async function handle(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  try {
    if (url.pathname === "/assets/discord-preview.png") {
      await sendPreviewImage(res);
      return;
    }

    if (url.pathname === "/admin") {
      const logs = await readLogs();
      send(res, 200, adminPage(logs, await getIpInfoMap(logs)));
      return;
    }

    if (url.pathname === "/" || url.pathname === "/discord-preview") {
      await saveVisit(req);
      await sendPreviewImage(res);
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
