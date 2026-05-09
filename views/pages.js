function htmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderResult() {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title></title>
</head>
<body>
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

function renderHome() {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>IP 확인</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <main class="shell">
    <section class="panel">
      <p class="eyebrow">IP 기반 위치 확인</p>
      <h1>IP 확인 페이지</h1>
      <p class="copy">동의 페이지에서 수집 내용을 확인한 뒤 진행할 수 있습니다.</p>
      <a class="button" href="/consent">동의 페이지로 이동</a>
    </section>
  </main>
</body>
</html>`;
}

function renderAdmin(visits) {
  const rows = visits.slice().reverse();
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

module.exports = {
  renderAdmin,
  renderAdminLogin,
  renderHome,
  renderResult
};
