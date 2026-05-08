const consentButton = document.querySelector("#consentButton");

if (consentButton) {
  consentButton.addEventListener("click", () => {
    window.location.assign("./consent-site.html");
  });
}

const demoForm = document.querySelector(".demo-form");

if (demoForm) {
  demoForm.addEventListener("submit", (event) => {
    event.preventDefault();
    alert("데모라서 개인정보는 저장하지 않습니다.");
  });
}
