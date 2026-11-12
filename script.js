/* ============ Elements ============ */
const $ = (s) => document.querySelector(s);
const root = document.documentElement;
const lampWrap = $("#lampWrap");
const lamp = $("#lamp");
const pull = $("#pull");
const card = $("#card");
const formView = $("#formView");
const successView = $("#successView");
const authTabs = $("#authTabs");
const tabSignIn = $("#tabSignIn");
const tabRegister = $("#tabRegister");
const cardTitle = $("#cardTitle");
const cardSubtitle = $("#cardSubtitle");
const btnText = $("#btnText");
const submitBtn = $("#submitBtn");
const form = $("#authForm");
const formError = $("#formError");
const username = $("#username");
const password = $("#password");

let lampOn = false;
let activeTab = "signin";
let soundOn = true;
let busy = false;

/* ============ Themes ============ */
const themes = {
  amber: { a: "#ffab3d", b: "#f59e0b", rgb: "255,171,61" },
  cyan:  { a: "#00d0ff", b: "#00a8e0", rgb: "0,208,255" },
  pink:  { a: "#ff3d7f", b: "#ff1f6b", rgb: "255,61,127" },
  green: { a: "#16d47a", b: "#0bb865", rgb: "22,212,122" },
  white: { a: "#e4e8ff", b: "#aab4ff", rgb: "205,214,255" },
};

function setTheme(name) {
  const t = themes[name];
  root.style.setProperty("--lamp-accent", t.a);
  root.style.setProperty("--lamp-secondary", t.b);
  root.style.setProperty("--accent-rgb", t.rgb);
  document.querySelectorAll(".theme-dot").forEach((d) => {
    const on = d.dataset.theme === name;
    d.classList.toggle("active", on);
    d.setAttribute("aria-checked", on);
  });
  if (lampOn) {
    gsap.fromTo(".lit", { opacity: 0.6 }, { opacity: 1, duration: 0.5, ease: "power2.out" });
  }
  tone("theme");
}
document.querySelectorAll(".theme-dot").forEach((d) =>
  d.addEventListener("click", () => setTheme(d.dataset.theme))
);

/* ============ Sound (WebAudio) ============ */
let ctx;
function tone(kind) {
  if (!soundOn) return;
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    const play = (type, f0, f1, dur, vol, delay = 0) => {
      const t = ctx.currentTime + delay;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + dur + 0.02);
    };
    switch (kind) {
      case "on":      play("square", 240, 90, 0.09, 0.05); play("sine", 1100, 1500, 0.25, 0.03, 0.05); break;
      case "off":     play("square", 200, 70, 0.1, 0.05);  play("sine", 500, 200, 0.2, 0.025, 0.04); break;
      case "tab":     play("sine", 620, 820, 0.07, 0.035); break;
      case "theme":   play("triangle", 760, 980, 0.1, 0.03); break;
      case "click":   play("sine", 480, 360, 0.05, 0.03); break;
      case "error":   play("sawtooth", 150, 90, 0.22, 0.04); break;
      case "success": [523, 659, 784].forEach((f, i) => play("sine", f, null, 0.28, 0.04, i * 0.09)); break;
    }
  } catch (e) { /* audio unavailable */ }
}

$("#soundBtn").addEventListener("click", (e) => {
  soundOn = !soundOn;
  e.currentTarget.classList.toggle("muted", !soundOn);
  tone("click");
});

/* ============ Stars ============ */
(function makeStars() {
  const wrap = $("#stars");
  for (let i = 0; i < 55; i++) {
    const s = document.createElement("span");
    s.className = "star";
    const size = Math.random() * 2 + 1;
    s.style.cssText = `left:${Math.random() * 100}%;top:${Math.random() * 100}%;width:${size}px;height:${size}px;`;
    wrap.appendChild(s);
    gsap.to(s, {
      opacity: Math.random() * 0.5 + 0.1,
      y: `+=${Math.random() * 30 - 15}`,
      x: `+=${Math.random() * 30 - 15}`,
      duration: Math.random() * 4 + 3,
      repeat: -1,
      yoyo: true,
      ease: "sine.inOut",
    });
  }
})();

/* ============ Lamp ============ */
gsap.set(".lit", { opacity: 0 });
gsap.set(card, { autoAlpha: 0, y: 30, scale: 0.96, filter: "blur(8px)" });

function toggleLamp() {
  lampOn = !lampOn;
  lampWrap.classList.toggle("on", lampOn);
  lamp.setAttribute("aria-pressed", lampOn);
  lamp.setAttribute("aria-label", lampOn ? "Lamp. Pull the string to turn off" : "Lamp. Pull the string to turn on");
  tone(lampOn ? "on" : "off");

  // string pull
  gsap.timeline()
    .to(pull, { y: 18, duration: 0.12, ease: "power2.in" })
    .to(pull, { y: 0, duration: 0.8, ease: "elastic.out(1, 0.3)" });

  if (lampOn) {
    // flicker on
    gsap.fromTo(".lit", { opacity: 0 }, {
      keyframes: [
        { opacity: 0.9, duration: 0.06 }, { opacity: 0.15, duration: 0.09 },
        { opacity: 1, duration: 0.08 }, { opacity: 0.5, duration: 0.05 },
        { opacity: 1, duration: 0.35 },
      ],
    });
    gsap.to(card, { autoAlpha: 1, y: 0, scale: 1, filter: "blur(0px)", duration: 0.9, ease: "power3.out", delay: 0.3 });
  } else {
    gsap.to(".lit", { opacity: 0, duration: 0.35, ease: "power2.out" });
    gsap.to(card, { autoAlpha: 0, y: 30, scale: 0.96, filter: "blur(8px)", duration: 0.45, ease: "power2.in" });
  }
}

lamp.addEventListener("click", toggleLamp);
lamp.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleLamp(); }
});

// subtle sway on hover
lamp.addEventListener("mouseenter", () => gsap.to(pull, { y: 5, duration: 0.25, ease: "power2.out" }));
lamp.addEventListener("mouseleave", () => gsap.to(pull, { y: 0, duration: 0.5, ease: "elastic.out(1, 0.4)" }));

/* ============ Tabs ============ */
tabSignIn.addEventListener("click", () => switchTab("signin"));
tabRegister.addEventListener("click", () => switchTab("register"));

function switchTab(tab) {
  if (activeTab === tab || busy) return;
  activeTab = tab;
  authTabs.setAttribute("data-active", tab);

  tabSignIn.classList.toggle("active", tab === "signin");
  tabRegister.classList.toggle("active", tab === "register");

  if (tab === "signin") {
    cardTitle.textContent = "Welcome";
    cardSubtitle.textContent = "Sign in to continue to your account";
    btnText.textContent = "Sign In";
    password.autocomplete = "current-password";
  } else {
    cardTitle.textContent = "Sign Up";
    cardSubtitle.textContent = "Create an account to get started";
    btnText.textContent = "Create Account";
    password.autocomplete = "new-password";
  }
  clearError();
  tone("tab");

  gsap.fromTo(".card-title, .card-subtitle",
    { opacity: 0, y: -4 },
    { opacity: 1, y: 0, duration: 0.3, ease: "power2.out" }
  );
}

/* ============ Password eye ============ */
$("#eyeBtn").addEventListener("click", (e) => {
  const btn = e.currentTarget;
  const show = password.type === "password";
  password.type = show ? "text" : "password";
  btn.classList.toggle("shown", show);
  btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
  tone("click");
});

/* ============ Misc clicks ============ */
document.querySelectorAll(".social button").forEach((b) =>
  b.addEventListener("click", () => {
    tone("click");
    gsap.fromTo(b, { scale: 0.92 }, { scale: 1, duration: 0.5, ease: "elastic.out(1, 0.4)" });
  })
);
$("#remember").addEventListener("change", () => tone("click"));

/* ============ Form ============ */
function showError(msg, fields) {
  formError.textContent = msg;
  formError.classList.add("show");
  fields.forEach((f) => f.classList.add("invalid"));
  tone("error");
  gsap.fromTo(card, { x: 0 }, {
    keyframes: [{ x: -9 }, { x: 9 }, { x: -6 }, { x: 6 }, { x: -3 }, { x: 0 }],
    duration: 0.45, ease: "power2.out",
  });
}
function clearError() {
  formError.classList.remove("show");
  $("#userField").classList.remove("invalid");
  $("#passField").classList.remove("invalid");
}
[username, password].forEach((i) => i.addEventListener("input", clearError));

form.addEventListener("submit", (e) => {
  e.preventDefault();
  if (busy) return;

  const bad = [];
  if (!username.value.trim()) bad.push($("#userField"));
  if (!password.value) bad.push($("#passField"));
  if (bad.length) {
    showError("Please fill in all fields to continue.", bad);
    return;
  }
  if (activeTab === "register" && password.value.length < 8) {
    showError("Password must be at least 8 characters.", [$("#passField")]);
    return;
  }

  busy = true;
  submitBtn.classList.add("loading");
  submitBtn.disabled = true;
  tone("click");

  const endpoint = activeTab === "register" ? "/api/auth/register" : "/api/auth/login";
  fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({
      identifier: username.value.trim(),
      password: password.value
    })
  })
    .then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Authentication failed. Please try again.");
      return data;
    })
    .then(() => {
      showSuccess();
      window.setTimeout(() => window.location.assign("/dashboard"), 850);
    })
    .catch((error) => {
      busy = false;
      submitBtn.classList.remove("loading");
      submitBtn.disabled = false;
      showError(error.message || "Could not connect to the server. Please try again.", []);
    });
});

function showSuccess() {
  const signin = activeTab === "signin";
  $("#successTitle").textContent = signin ? "Signed In Successfully" : "Account Created!";
  $("#successSub").textContent = signin
    ? "Welcome back! Your workspace is ready."
    : "Welcome aboard! Your workspace is ready.";
  tone("success");

  gsap.timeline()
    .to(formView, { autoAlpha: 0, y: -12, duration: 0.35, ease: "power2.in" })
    .set(successView, { autoAlpha: 1 })
    .fromTo(successView, { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: "power3.out" })
    .fromTo("#checkRing", { scale: 0.4 }, { scale: 1, duration: 0.6, ease: "back.out(2.2)" }, "<")
    .to("#checkRing path", { strokeDashoffset: 0, duration: 0.45, ease: "power2.out" }, "<0.15");
}

$("#againBtn").addEventListener("click", () => {
  tone("click");
  gsap.timeline()
    .to(successView, { autoAlpha: 0, y: 10, duration: 0.3, ease: "power2.in" })
    .add(() => {
      form.reset();
      password.type = "password";
      $("#eyeBtn").classList.remove("shown");
      submitBtn.classList.remove("loading");
      submitBtn.disabled = false;
      gsap.set("#checkRing path", { strokeDashoffset: 30 });
      busy = false;
    })
    .fromTo(formView, { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.45, ease: "power3.out" });
});