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

module.exports = { getClientIp, lookupIp };
