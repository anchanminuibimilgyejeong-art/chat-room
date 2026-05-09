function renderConsent() {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>IP 위치 수집 동의</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <main class="shell">
    <section class="panel">
      <p class="eyebrow">수집 동의</p>
      <h1>IP 기반 위치 정보 수집 동의</h1>
      <p class="copy">
        동의하면 접속 IP, IP 기반 대략적 위치, 브라우저 정보가 저장되고 결과 페이지로 이동합니다.
        브라우저 위치 권한은 요청하지 않습니다.
      </p>
      <form method="post" action="/collect">
        <label class="check">
          <input type="checkbox" required>
          <span>위 내용을 확인했고 IP 기반 위치 정보 수집에 동의합니다.</span>
        </label>
        <button class="button" type="submit">동의하고 확인</button>
      </form>
      <p class="note">IP 위치는 통신사/네트워크 기준의 대략적인 지역이며 실제 집 주소가 아닙니다.</p>
    </section>
  </main>
</body>
</html>`;
}

module.exports = { renderConsent };
