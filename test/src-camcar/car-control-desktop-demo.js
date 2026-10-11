"use strict";

const API = {
  status: "/status",
  drive: "/car-control",
  camera: "/control",
  xclk: "/xclk",
  reg: "/reg",
  greg: "/greg",
  win: "/win",
};
const controlSession = (() => {
  const bytes = new Uint32Array(2);
  crypto.getRandomValues(bytes);
  return [...bytes]
    .map((value) => value.toString(16).padStart(8, "0"))
    .join("");
})();
let controlSequence = 0;
const $ = (id) => document.getElementById(id);
const typing = (target) =>
  target instanceof HTMLElement &&
  (target.matches("input,select,textarea") || target.isContentEditable);
function request(path, params = {}) {
  const base =
    location.protocol === "file:" ? "http://192.168.4.1" : location.origin;
  const url = new URL(path, base);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  if (location.protocol === "file:") {
    console.info("[preview request]", url.href);
    return Promise.resolve(new Response("{}"));
  }
  return fetch(url, { cache: "no-store" });
}

function animateButton(button) {
  const on = () => button.classList.add("is-pressed"),
    off = () => button.classList.remove("is-pressed");
  button.addEventListener("pointerdown", on);
  ["pointerup", "pointercancel", "pointerleave", "lostpointercapture"].forEach(
    (e) => button.addEventListener(e, off),
  );
  button.addEventListener("keydown", (e) => {
    if (e.key === " " || e.key === "Enter") on();
  });
  button.addEventListener("keyup", off);
  button.addEventListener("blur", off);
}
document.querySelectorAll("button").forEach(animateButton);

// Each action owns a set of input sources. Releasing mouse never cancels a still-held key, and vice versa.
const sources = new Map(),
  driveButtons = new Map(
    [...document.querySelectorAll("[data-drive]")].map((b) => [
      b.dataset.drive,
      b,
    ]),
  );
const driveKeys = {
  KeyW: "forward",
  KeyA: "left",
  KeyS: "backward",
  KeyD: "right",
};
function active() {
  return [...sources].filter(([, s]) => s.size).map(([a]) => a);
}
function setSource(action, source, down) {
  if (!sources.has(action)) sources.set(action, new Set());
  const set = sources.get(action);
  down ? set.add(source) : set.delete(source);
  driveButtons.get(action)?.classList.toggle("is-pressed", set.size > 0);
  const a = active();
  const steer =
    a.includes("left") === a.includes("right")
      ? 0
      : a.includes("left")
        ? -30
        : 30;
  $("steering-output").textContent = `${steer > 0 ? "+" : ""}${steer}°`;
}
driveButtons.forEach((button, action) => {
  button.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    button.setPointerCapture?.(e.pointerId);
    setSource(action, `pointer:${e.pointerId}`, true);
  });
  const up = (e) => setSource(action, `pointer:${e.pointerId}`, false);
  ["pointerup", "pointercancel", "lostpointercapture"].forEach((n) =>
    button.addEventListener(n, up),
  );
});
document.addEventListener("keydown", (e) => {
  const a = driveKeys[e.code];
  if (a && !typing(e.target)) {
    e.preventDefault();
    if (!e.repeat) setSource(a, `key:${e.code}`, true);
  }
});
document.addEventListener("keyup", (e) => {
  const a = driveKeys[e.code];
  if (a) {
    e.preventDefault();
    setSource(a, `key:${e.code}`, false);
  }
});
function currentCarState() {
  const actions = active();
  const forward = actions.includes("forward");
  const backward = actions.includes("backward");
  const left = actions.includes("left");
  const right = actions.includes("right");
  return {
    drive: forward === backward ? "stop" : (forward > backward ? "forward" : "backward"),
    steer: left === right ? "center" : (left > right ? "left" : "right"),
    speed: Number($("speed-range").value),
  };
}
function sendCarState(emergency = false) {
  controlSequence = (controlSequence + 1) >>> 0;
  return request(API.drive, {
    ...currentCarState(),
    session: controlSession,
    seq: controlSequence,
    emergency: Number(emergency),
  }).catch(markOffline);
}
setInterval(() => {
  if (active().length) sendCarState();
}, 20);
function releaseDrive(send = true) {
  const moving = active().length > 0;
  sources.clear();
  driveButtons.forEach((b) => b.classList.remove("is-pressed"));
  $("steering-output").textContent = "0°";
  if (send && moving) sendCarState();
}
addEventListener("blur", () => releaseDrive());
document.addEventListener("visibilitychange", () => {
  if (document.hidden) releaseDrive();
});

const stop = $("emergency-stop");
function emergencyStop() {
  releaseDrive(false);
  stop.classList.add("is-pressed");
  sendCarState(true);
  setTimeout(() => stop.classList.remove("is-pressed"), 180);
}
stop.addEventListener("click", emergencyStop);
document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && !typing(e.target)) {
    e.preventDefault();
    if (!e.repeat) emergencyStop();
  }
});

const speed = $("speed-range");
function setSpeed(value, send = true) {
  value = Math.max(+speed.min, Math.min(+speed.max, +value));
  speed.value = value;
  $("speed-value").textContent = `${value}%`;
  $("throttle-output").textContent = `${value}%`;
  if (send) sendCarState();
}
function stepSpeed(step) {
  setSpeed(+speed.value + step);
}
speed.addEventListener("input", () => setSpeed(speed.value, false));
speed.addEventListener("change", () => setSpeed(speed.value));
document
  .querySelectorAll("[data-speed-step]")
  .forEach((b) =>
    b.addEventListener("click", () => stepSpeed(+b.dataset.speedStep)),
  );
document.addEventListener("keydown", (e) => {
  if (typing(e.target) || e.repeat || !(e.code in { KeyJ: 1, KeyK: 1 })) return;
  e.preventDefault();
  const n = e.code === "KeyJ" ? -1 : 1;
  stepSpeed(n);
  document
    .querySelector(`[data-speed-step="${n}"]`)
    ?.classList.add("is-pressed");
});
document.addEventListener("keyup", (e) => {
  if (e.code === "KeyJ" || e.code === "KeyK")
    document
      .querySelector(`[data-speed-step="${e.code === "KeyJ" ? -1 : 1}"]`)
      ?.classList.remove("is-pressed");
});

const menu = $("camera-menu"),
  toggle = $("nav-toggle");
function showMenu(open) {
  menu.classList.toggle("open", open);
  menu.setAttribute("aria-hidden", !open);
  toggle.setAttribute("aria-expanded", open);
}
toggle.addEventListener("click", () =>
  showMenu(!menu.classList.contains("open")),
);
$("menu-close").addEventListener("click", () => showMenu(false));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") showMenu(false);
});
const controlValue = (c) => (c.type === "checkbox" ? +c.checked : c.value);
function syncFlip(id, value) {
  $(id).checked = !!value;
  document
    .querySelector(`[data-camera-toggle="${id}"]`)
    ?.classList.toggle("is-on", !!value);
}
document.querySelectorAll("[data-camera]").forEach((c) => {
  const out = document.querySelector(`output[data-for="${c.id}"]`);
  c.addEventListener("input", () => {
    if (out) out.value = c.value;
  });
  c.addEventListener("change", () => {
    request(API.camera, { var: c.id, val: controlValue(c) }).catch(markOffline);
    if (c.id === "hmirror" || c.id === "vflip") syncFlip(c.id, c.checked);
  });
});
document.querySelectorAll("[data-camera-toggle]").forEach((b) =>
  b.addEventListener("click", () => {
    const id = b.dataset.cameraToggle,
      next = !$(id).checked;
    syncFlip(id, next);
    request(API.camera, { var: id, val: +next }).catch(markOffline);
  }),
);
["hmirror", "vflip"].forEach((id) => syncFlip(id, $(id).checked));
$("set-xclk").addEventListener("click", () =>
  request(API.xclk, { xclk: $("xclk").value }).catch(markOffline),
);
$("set-reg").addEventListener("click", () =>
  request(API.reg, {
    reg: $("reg-addr").value,
    mask: $("reg-mask").value,
    val: $("reg-value").value,
  }).catch(markOffline),
);
$("get-reg").addEventListener("click", async () => {
  try {
    $("get-reg-value").value = await (
      await request(API.greg, {
        reg: $("get-reg-addr").value,
        mask: $("get-reg-mask").value,
      })
    ).text();
  } catch (e) {
    markOffline(e);
  }
});
document.querySelectorAll("[data-register]").forEach((c) =>
  c.addEventListener("change", () =>
    request(API.reg, {
      reg: c.dataset.register,
      offset: c.dataset.offset,
      mask: c.dataset.mask,
      value: controlValue(c),
    }).catch(markOffline),
  ),
);
$("set-resolution").addEventListener("click", () =>
  request(API.win, {
    resolution: $("sensor-resolution").value,
    offset_x: $("offset-x").value,
    offset_y: $("offset-y").value,
    total_x: $("total-x").value,
    total_y: $("total-y").value,
    output_x: $("output-x").value,
    output_y: $("output-y").value,
  }).catch(markOffline),
);

function webState(online, data = {}) {
  const host = location.hostname || "trick3.local";
  $("web-domain").textContent =
    data.domain || (host.endsWith(".local") ? host : "trick3.local");
  $("web-ip").textContent =
    data.ip || (/^\d+\.\d+\.\d+\.\d+$/.test(host) ? host : "192.168.4.1");
  $("web-state").textContent = online ? "ONLINE" : "OFFLINE";
  $("web-state").style.color = online ? "var(--green)" : "var(--danger)";
  $("web-state-dot").className = `state-dot ${online ? "online" : "offline"}`;
}
function markOffline(error) {
  console.warn(error);
  webState(false);
}
async function pollStatus() {
  if (location.protocol === "file:") {
    webState(true);
    return;
  }
  $("web-state-dot").className = "state-dot checking";
  try {
    const response = await fetch(API.status, {
      cache: "no-store",
      signal: AbortSignal.timeout(1600),
    });
    if (!response.ok) throw Error(response.status);
    let data = {};
    try {
      data = await response.json();
    } catch {}
    webState(true, data);
  } catch (e) {
    markOffline(e);
  }
}
pollStatus();
setInterval(pollStatus, 3000);
