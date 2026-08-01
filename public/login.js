const form = document.querySelector("#loginForm");
const errorMessage = document.querySelector("#loginError");
const submitButton = document.querySelector("#loginSubmit");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorMessage.textContent = "";
  submitButton.disabled = true;
  submitButton.textContent = "正在登录…";

  try {
    const values = Object.fromEntries(new FormData(form));
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values)
    });
    const result = await response.json();

    if (!response.ok) {
      errorMessage.textContent = result.error || "登录失败，请稍后重试";
      return;
    }

    window.location.replace("/admin");
  } catch (error) {
    console.error(error);
    errorMessage.textContent = "暂时无法连接服务器，请稍后重试";
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "登录";
  }
});
