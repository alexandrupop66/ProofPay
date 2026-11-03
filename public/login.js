const form = document.querySelector("#loginForm");
const password = document.querySelector("#accessPassword");
const message = document.querySelector("#loginMessage");

const current = await fetch("/api/session", { cache: "no-store" }).then((r) => r.json());
if (current.authenticated) window.location.replace("/");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  message.textContent = "";
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: password.value })
    });
    const body = await response.json().catch(() => ({}));
    password.value = "";
    if (!response.ok) throw new Error(body.error || "Sign-in failed.");
    window.location.replace("/");
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
