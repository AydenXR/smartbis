import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import crypto from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.FRONTEND_PORT || 4173);
const METRICS_API_BASE = process.env.METRICS_API_BASE || "";
const BOT_BASE_URL = process.env.BOT_BASE_URL || "http://bot:3000";
const APP_NAME = process.env.APP_NAME || "SmartBis";
const APP_LOGO = process.env.APP_LOGO || "/img/logo.png";

const CONFIG_PATH = path.join(__dirname, "data", "admin_config.json");
if (!fs.existsSync(path.join(__dirname, "data"))) {
  fs.mkdirSync(path.join(__dirname, "data"), { recursive: true });
}

function hashPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

function loadConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  }
  const config = {
    password: hashPassword("admin"),
    is_default: true,
  };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  
  console.log("-----------------------------------------");
  console.log("SISTEMA RESETEADO: PASSWORD POR DEFECTO: admin");
  console.log("-----------------------------------------");
  return config;
}

let adminConfig = loadConfig();

const app = express();

app.use((req, res, next) => {
  console.log(`[FRONTEND-ACCESS] ${req.method} ${req.url}`);
  next();
});

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

// AUTH ENDPOINTS
app.post("/api/auth/login", (req, res) => {
  const { password } = req.body;
  if (hashPassword(password) === adminConfig.password) {
    res.json({ ok: true, is_default: adminConfig.is_default });
  } else {
    res.status(401).json({ error: "Contraseña incorrecta" });
  }
});

app.post("/api/auth/change-password", (req, res) => {
  const { oldPassword, newPassword } = req.body;
  
  // Verify current password if it's not the initial "must change" forced flow
  // (In "must change" flow, the user already logged in with the old password, but for extra safety we check it)
  if (hashPassword(oldPassword) !== adminConfig.password) {
    return res.status(401).json({ error: "La contraseña actual es incorrecta" });
  }

  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ error: "La nueva contraseña es demasiado corta" });
  }

  adminConfig.password = hashPassword(newPassword);
  adminConfig.is_default = false;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(adminConfig, null, 2));
  res.json({ ok: true });
});

app.get("/api/auth/status", (_req, res) => {
  res.json({ is_default: adminConfig.is_default });
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/metrics-config.js", (_req, res) => {
  res.type("application/javascript").send(`window.METRICS_API_BASE=${JSON.stringify(METRICS_API_BASE)};`);
});

app.use("/metrics/api", async (req, res) => {
  try {
    const url = `${BOT_BASE_URL}${req.originalUrl}`;
    const options = {
      method: req.method,
      headers: { "Content-Type": "application/json" },
    };
    if (req.method !== "GET" && req.method !== "HEAD") {
      options.body = JSON.stringify(req.body || {});
    }
    const response = await fetch(url, options);
    const text = await response.text();
    res.status(response.status);
    const contentType = response.headers.get("content-type");
    if (contentType) res.type(contentType);
    res.send(text);
  } catch (e) {
    res.status(502).json({ error: e?.message || "metrics_proxy_error" });
  }
});

app.use("/api/tickets", async (req, res) => {
    console.log(`[TICKETS-PROXY] ${req.method} ${req.url} -> ${BOT_BASE_URL}${req.originalUrl}`);
    try {
      const url = `${BOT_BASE_URL}${req.originalUrl}`;
      const options = {
        method: req.method,
        headers: { "Content-Type": "application/json" },
      };
      if (req.method !== "GET" && req.method !== "HEAD") {
        options.body = JSON.stringify(req.body || {});
      }
      const response = await fetch(url, options);
      console.log(`[TICKETS-PROXY] Result: ${response.status}`);
      const text = await response.text();
      res.status(response.status);
      const contentType = response.headers.get("content-type");
      if (contentType) res.type(contentType);
      res.send(text);
    } catch (e) {
      console.error(`[TICKETS-PROXY] Error:`, e.message);
      res.status(502).json({ error: e?.message || "tickets_proxy_error" });
    }
});

app.use("/api/notebook", async (req, res) => {
    try {
      const url = `${BOT_BASE_URL}${req.originalUrl}`;
      const options = {
        method: req.method,
        headers: { "Content-Type": "application/json" },
      };
      if (req.method !== "GET" && req.method !== "HEAD") {
        options.body = JSON.stringify(req.body || {});
      }
      const response = await fetch(url, options);
      const text = await response.text();
      res.status(response.status);
      const contentType = response.headers.get("content-type");
      if (contentType) res.type(contentType);
      res.send(text);
    } catch (e) {
      res.status(502).json({ error: e?.message || "notebook_proxy_error" });
    }
});

app.use("/api/whatsapp", async (req, res) => {
    try {
      const url = `${BOT_BASE_URL}${req.originalUrl}`;
      const options = {
        method: req.method,
        headers: { "Content-Type": "application/json" },
      };
      if (req.method !== "GET" && req.method !== "HEAD") {
        options.body = JSON.stringify(req.body || {});
      }
      const response = await fetch(url, options);
      const text = await response.text();
      res.status(response.status);
      const contentType = response.headers.get("content-type");
      if (contentType) res.type(contentType);
      res.send(text);
    } catch (e) {
      res.status(502).json({ error: e?.message || "whatsapp_proxy_error" });
    }
});

app.use("/api/calendar", async (req, res) => {
    try {
      const url = `${BOT_BASE_URL}${req.originalUrl}`;
      const options = {
        method: req.method,
        headers: { "Content-Type": "application/json" },
      };
      if (req.method !== "GET" && req.method !== "HEAD") {
        options.body = JSON.stringify(req.body || {});
      }
      const response = await fetch(url, options);
      const text = await response.text();
      res.status(response.status);
      const contentType = response.headers.get("content-type");
      if (contentType) res.type(contentType);
      res.send(text);
    } catch (e) {
      res.status(502).json({ error: e?.message || "calendar_proxy_error" });
    }
});

app.use("/api/appointments", async (req, res) => {
    try {
      const url = `${BOT_BASE_URL}${req.originalUrl}`;
      const options = {
        method: req.method,
        headers: { "Content-Type": "application/json" },
      };
      if (req.method !== "GET" && req.method !== "HEAD") {
        options.body = JSON.stringify(req.body || {});
      }
      const response = await fetch(url, options);
      const text = await response.text();
      res.status(response.status);
      const contentType = response.headers.get("content-type");
      if (contentType) res.type(contentType);
      res.send(text);
    } catch (e) {
      res.status(502).json({ error: e?.message || "appointments_proxy_error" });
    }
});

app.use("/api/events", async (req, res) => {
    try {
      const url = `${BOT_BASE_URL}${req.originalUrl}`;
      const options = {
        method: req.method,
        headers: { "Content-Type": "application/json" },
      };
      if (req.method !== "GET" && req.method !== "HEAD") {
        options.body = JSON.stringify(req.body || {});
      }
      const response = await fetch(url, options);
      const text = await response.text();
      res.status(response.status);
      const contentType = response.headers.get("content-type");
      if (contentType) res.type(contentType);
      res.send(text);
    } catch (e) {
      res.status(502).json({ error: e?.message || "events_proxy_error" });
    }
});

app.use("/api/config", async (req, res) => {
    try {
      const url = `${BOT_BASE_URL}${req.originalUrl}`;
      const response = await fetch(url, { method: req.method });
      const text = await response.text();
      res.status(response.status);
      const contentType = response.headers.get("content-type");
      if (contentType) res.type(contentType);
      res.send(text);
    } catch (e) {
      res.status(502).json({ error: e?.message || "config_proxy_error" });
    }
});

app.get("/api/branding", (req, res) => {
    res.json({ appName: APP_NAME, appLogo: APP_LOGO });
});

app.use("/api/bot", async (req, res) => {
    try {
      const url = `${BOT_BASE_URL}${req.originalUrl}`;
      const options = { method: req.method, headers: { "Content-Type": "application/json" } };
      if (req.method !== "GET" && req.method !== "HEAD") options.body = JSON.stringify(req.body || {});
      const response = await fetch(url, options);
      const text = await response.text();
      res.status(response.status);
      const contentType = response.headers.get("content-type");
      if (contentType) res.type(contentType);
      res.send(text);
    } catch (e) { res.status(502).json({ error: e?.message }); }
});

app.use("/api/users", async (req, res) => {
    try {
      const url = `${BOT_BASE_URL}${req.originalUrl}`;
      const options = { method: req.method, headers: { "Content-Type": "application/json" } };
      if (req.method !== "GET" && req.method !== "HEAD") options.body = JSON.stringify(req.body || {});
      const response = await fetch(url, options);
      const text = await response.text();
      res.status(response.status);
      const contentType = response.headers.get("content-type");
      if (contentType) res.type(contentType);
      res.send(text);
    } catch (e) { res.status(502).json({ error: e?.message }); }
});

app.use("/app/data/temp_media", async (req, res) => {
    try {
      const url = `${BOT_BASE_URL}${req.originalUrl}`;
      const response = await fetch(url);
      if (!response.ok) return res.status(response.status).send('Not Found');
      const buffer = await response.arrayBuffer();
      const contentType = response.headers.get("content-type");
      if (contentType) res.type(contentType);
      res.send(Buffer.from(buffer));
    } catch (e) {
      res.status(502).json({ error: "media_proxy_error" });
    }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`SmartBis Panel (Simple Mode) http://0.0.0.0:${PORT}`);
});
