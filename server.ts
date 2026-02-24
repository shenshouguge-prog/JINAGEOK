import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database("ktv.db");

// Initialize DB
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
  CREATE TABLE IF NOT EXISTS members (
    phone TEXT PRIMARY KEY,
    level TEXT DEFAULT 'guest', -- 'guest', 'monthly', 'yearly'
    expiry_date TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  INSERT OR IGNORE INTO settings (key, value) VALUES ('cloud_url', 'https://api.ktv-cloud.com/v1');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('admin_password', 'admin888');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('wechat_id', 'KTV_SUPPORT_88');
`);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Routes
  // Admin Login
  app.post("/api/admin/login", (req, res) => {
    const { password } = req.body;
    const adminPass = db.prepare("SELECT value FROM settings WHERE key = 'admin_password'").get() as { value: string };
    if (password === adminPass.value) {
      res.json({ success: true });
    } else {
      res.status(401).json({ success: false, message: "密码错误" });
    }
  });

  // Admin: Get all members
  app.get("/api/admin/members", (req, res) => {
    const members = db.prepare("SELECT * FROM members ORDER BY created_at DESC").all();
    res.json(members);
  });

  // Admin: Update member level
  app.post("/api/admin/members/update", (req, res) => {
    const { phone, level } = req.body; // level: 'guest', 'monthly', 'yearly'
    
    let expiryDate: string | null = null;
    const now = new Date();

    if (level === 'monthly') {
      now.setMonth(now.getMonth() + 1);
      expiryDate = now.toISOString().split('T')[0];
    } else if (level === 'yearly') {
      now.setFullYear(now.getFullYear() + 1);
      expiryDate = now.toISOString().split('T')[0];
    }

    db.prepare("UPDATE members SET level = ?, expiry_date = ? WHERE phone = ?").run(level, expiryDate, phone);
    res.json({ success: true, expiry_date: expiryDate });
  });

  // Member Registration
  app.post("/api/member/register", (req, res) => {
    const { phone } = req.body;
    if (!phone || !/^1[3-9]\d{9}$/.test(phone)) {
      return res.status(400).json({ message: "请输入有效的手机号" });
    }
    
    // Check if exists
    const existing = db.prepare("SELECT * FROM members WHERE phone = ?").get(phone);
    if (!existing) {
      db.prepare("INSERT INTO members (phone) VALUES (?)").run(phone);
    }
    
    const member = db.prepare("SELECT * FROM members WHERE phone = ?").get(phone) as any;
    const wechat = db.prepare("SELECT value FROM settings WHERE key = 'wechat_id'").get() as { value: string };
    
    res.json({ 
      success: true, 
      member,
      wechat_id: wechat.value
    });
  });

  app.get("/api/settings", (req, res) => {
    const rows = db.prepare("SELECT * FROM settings WHERE key IN ('cloud_url', 'wechat_id')").all() as { key: string, value: string }[];
    const settings = rows.reduce((acc: any, row) => {
      acc[row.key] = row.value;
      return acc;
    }, {});
    res.json(settings);
  });

  app.post("/api/settings", (req, res) => {
    const { cloud_url, admin_password, wechat_id } = req.body;
    if (cloud_url !== undefined) {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run('cloud_url', cloud_url);
    }
    if (admin_password !== undefined) {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run('admin_password', admin_password);
    }
    if (wechat_id !== undefined) {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run('wechat_id', wechat_id);
    }
    res.json({ status: "ok" });
  });

  // Song list logic with quality check
  app.get("/api/songs", (req, res) => {
    const phone = req.query.phone as string;
    let isPremium = false;
    
    if (phone) {
      const member = db.prepare("SELECT * FROM members WHERE phone = ?").get(phone) as any;
      if (member && member.expiry_date) {
        const expiry = new Date(member.expiry_date);
        if (expiry > new Date()) {
          isPremium = true;
        }
      }
    }

    const songs = [
      { 
        id: 1, 
        title: "后来", 
        artist: "刘若英", 
        // In a real app, these would be different files or bitrates
        videoUrl: isPremium ? "https://www.w3schools.com/html/mov_bbb.mp4" : "https://www.w3schools.com/html/movie.mp4", 
        quality: isPremium ? "HQ (Lossless)" : "LQ (64kbps)",
        lrcUrl: "/lyrics/houlai.lrc" 
      },
      { 
        id: 2, 
        title: "晴天", 
        artist: "周杰伦", 
        videoUrl: isPremium ? "https://www.w3schools.com/html/movie.mp4" : "https://www.w3schools.com/html/mov_bbb.mp4", 
        quality: isPremium ? "HQ (Lossless)" : "LQ (64kbps)",
        lrcUrl: "/lyrics/qingtian.lrc" 
      }
    ];

    res.json(songs);
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist/index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
