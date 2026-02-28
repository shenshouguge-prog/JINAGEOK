import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, "ktv.db");
const db = new Database(dbPath);

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
  CREATE TABLE IF NOT EXISTS favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT,
    song_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(phone, song_id)
  );
  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT,
    level TEXT,
    amount REAL,
    method TEXT,
    tx_id_last4 TEXT,
    status TEXT DEFAULT 'pending_audit', -- 'pending_audit', 'verified', 'invalid'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  INSERT OR IGNORE INTO settings (key, value) VALUES ('admin_password', 'admin888');
  INSERT OR REPLACE INTO settings (key, value) VALUES ('wechat_id', '2806600109');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('wechat_qr', '');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('alipay_qr', '');
` + "  DELETE FROM settings WHERE key = 'external_music_dir';" + `
`);

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // Ensure music directory exists
  const musicDir = path.join(__dirname, "music");
  if (!fs.existsSync(musicDir)) {
    fs.mkdirSync(musicDir);
  }

  // Serve music files
  app.use("/music", express.static(musicDir));

  // API Routes
  // Admin Login
  app.post("/api/admin/login", (req, res) => {
    try {
      const { password } = req.body;
      console.log(`[Admin] Login attempt with password: ${password ? '****' : 'empty'}`);
      
      const row = db.prepare("SELECT value FROM settings WHERE key = 'admin_password'").get() as { value: string } | undefined;
      
      if (!row) {
        console.error("[Admin] Critical: admin_password not found in DB, resetting to default.");
        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run('admin_password', 'admin888');
        return res.status(500).json({ success: false, message: "系统配置修复中，请稍后再试" });
      }

      if (password === row.value) {
        console.log("[Admin] Login successful");
        res.json({ success: true });
      } else {
        console.warn("[Admin] Login failed: Incorrect password");
        res.status(401).json({ success: false, message: "密码错误" });
      }
    } catch (error) {
      console.error("[Admin] Login error:", error);
      res.status(500).json({ success: false, message: "服务器内部错误" });
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
    const rows = db.prepare("SELECT * FROM settings WHERE key IN ('wechat_id', 'wechat_qr', 'alipay_qr', 'external_music_dir')").all() as { key: string, value: string }[];
    const settings = rows.reduce((acc: any, row) => {
      acc[row.key] = row.value;
      return acc;
    }, {});
    res.json(settings);
  });

  // Favorites API
  app.get("/api/favorites", (req, res) => {
    const phone = req.query.phone as string;
    if (!phone) return res.json([]);
    
    const favs = db.prepare("SELECT song_id FROM favorites WHERE phone = ? ORDER BY created_at ASC").all(phone) as { song_id: number }[];
    res.json(favs.map(f => f.song_id));
  });

  app.post("/api/favorites/toggle", (req, res) => {
    const { phone, song_id } = req.body;
    if (!phone || !song_id) return res.status(400).json({ message: "Missing data" });

    const existing = db.prepare("SELECT * FROM favorites WHERE phone = ? AND song_id = ?").get(phone, song_id);
    if (existing) {
      db.prepare("DELETE FROM favorites WHERE phone = ? AND song_id = ?").run(phone, song_id);
      res.json({ favorited: false });
    } else {
      db.prepare("INSERT INTO favorites (phone, song_id) VALUES (?, ?)").run(phone, song_id);
      res.json({ favorited: true });
    }
  });

  app.post("/api/settings", (req, res) => {
    const { admin_password, wechat_id, wechat_qr, alipay_qr, external_music_dir } = req.body;
    if (admin_password !== undefined) {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run('admin_password', admin_password);
    }
    if (wechat_id !== undefined) {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run('wechat_id', wechat_id);
    }
    if (wechat_qr !== undefined) {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run('wechat_qr', wechat_qr);
    }
    if (alipay_qr !== undefined) {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run('alipay_qr', alipay_qr);
    }
    if (external_music_dir !== undefined) {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run('external_music_dir', external_music_dir);
    }
    res.json({ status: "ok" });
  });

  // Admin: Delete a song and all its associated files
  app.post("/api/admin/songs/delete", (req, res) => {
    const { title } = req.body;
    const musicDir = path.resolve(__dirname, "music");
    console.log(`[Admin] Deleting song: "${title}" in ${musicDir}`);
    
    if (!title) return res.status(400).json({ message: "Missing song title" });

    let deletedCount = 0;
    try {
      if (!fs.existsSync(musicDir)) {
        return res.status(500).json({ message: "Music directory not found" });
      }
      
      const files = fs.readdirSync(musicDir);
      files.forEach(file => {
        const name = path.parse(file).name;
        if (name === title || 
            name === `${title}_(Instrumental)` || 
            name === `${title}_(Vocals)` || 
            name === `${title}-1` ||
            file === `${title}.lrc` ||
            file === `${title}.jpg` ||
            file === `${title}.png`) {
          const filePath = path.join(musicDir, file);
          try {
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
              deletedCount++;
              console.log(`[Admin] Deleted file: ${file}`);
            }
          } catch (err) {
            console.error(`[Admin] Failed to delete file ${file}:`, err);
          }
        }
      });
      res.json({ success: true, deletedCount });
    } catch (e) {
      console.error("[Admin] Delete song error:", e);
      res.status(500).json({ message: "Failed to delete song: " + e.message });
    }
  });

  // Admin: List all music files
  app.get("/api/admin/files", (req, res) => {
    const musicDir = path.join(__dirname, "music");

    try {
      let files: string[] = [];
      if (fs.existsSync(musicDir)) {
        files = fs.readdirSync(musicDir).map(f => path.join(musicDir, f));
      }
      
      const fileInfos = files.map(fullPath => {
        const stats = fs.statSync(fullPath);
        return {
          name: path.basename(fullPath),
          fullPath: fullPath,
          size: stats.size,
          mtime: stats.mtime
        };
      });
      res.json(fileInfos);
    } catch (e) {
      console.error("Failed to list files:", e);
      res.status(500).json({ message: "Failed to list files" });
    }
  });

  // Admin: Delete files
  app.post("/api/admin/files/delete", (req, res) => {
    const { filenames } = req.body;
    const musicDir = path.resolve(__dirname, "music");
    console.log(`[Admin] Deleting files:`, filenames);
    
    if (!filenames || !Array.isArray(filenames)) return res.status(400).json({ message: "Invalid request" });

    let deletedCount = 0;
    try {
      filenames.forEach(f => {
        const localPath = path.join(musicDir, f);
        try {
          if (fs.existsSync(localPath)) {
            fs.unlinkSync(localPath);
            deletedCount++;
            console.log(`[Admin] Deleted file: ${f}`);
          }
        } catch (err) {
          console.error(`[Admin] Failed to delete file ${f}:`, err);
        }
      });
      res.json({ success: true, deletedCount });
    } catch (e) {
      console.error("[Admin] Delete files error:", e);
      res.status(500).json({ message: "Failed to delete files: " + e.message });
    }
  });

  // Admin: Upload music or singer image file
  app.post("/api/admin/upload-music", (req, res) => {
    const { filename, data } = req.body; // data is base64
    if (!filename || !data) return res.status(400).json({ message: "Missing file data" });

    const isImage = filename.endsWith('.jpg') || filename.endsWith('.png');
    const targetDir = isImage ? path.join(__dirname, "music") : path.join(__dirname, "music"); // Both in music dir for now
    
    const filePath = path.join(targetDir, filename);
    const base64Data = data.split(';base64,').pop();
    if (!base64Data) return res.status(400).json({ message: "Invalid data format" });
    
    try {
      fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
      res.json({ success: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ message: "Upload failed" });
    }
  });

  app.post("/api/member/activate", (req, res) => {
    const { phone, level, method, tx_id_last4 } = req.body; // level: 'monthly', 'yearly'
    if (!phone) return res.status(400).json({ message: "Missing phone" });
    
    let expiryDate: string | null = null;
    let amount = level === 'monthly' ? 10 : 100;
    const now = new Date();

    if (level === 'monthly') {
      now.setMonth(now.getMonth() + 1);
      expiryDate = now.toISOString().split('T')[0];
    } else if (level === 'yearly') {
      now.setFullYear(now.getFullYear() + 1);
      expiryDate = now.toISOString().split('T')[0];
    } else {
      return res.status(400).json({ message: "Invalid level" });
    }

    // Update member
    db.prepare("UPDATE members SET level = ?, expiry_date = ? WHERE phone = ?").run(level, expiryDate, phone);
    
    // Record transaction
    db.prepare("INSERT INTO transactions (phone, level, amount, method, tx_id_last4) VALUES (?, ?, ?, ?, ?)").run(
      phone, level, amount, method, tx_id_last4 || ''
    );
    
    const member = db.prepare("SELECT * FROM members WHERE phone = ?").get(phone);
    res.json({ success: true, member });
  });

  // Admin: Get transactions
  app.get("/api/admin/transactions", (req, res) => {
    const txs = db.prepare("SELECT * FROM transactions ORDER BY created_at DESC LIMIT 100").all();
    res.json(txs);
  });

  // Admin: Update transaction status/member status
  app.post("/api/admin/transactions/audit", (req, res) => {
    const { tx_id, status, phone } = req.body; // status: 'verified', 'invalid'
    
    db.prepare("UPDATE transactions SET status = ? WHERE id = ?").run(status, tx_id);
    
    if (status === 'invalid') {
      // If invalid, reset member to guest
      db.prepare("UPDATE members SET level = 'guest', expiry_date = NULL WHERE phone = ?").run(phone);
    }
    
    res.json({ success: true });
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

    // Scan music directory
    const musicDir = path.join(__dirname, "music");

    let files: string[] = [];
    if (fs.existsSync(musicDir)) {
      files = fs.readdirSync(musicDir);
    }
    
    const musicMap = new Map();
    files.forEach(file => {
      if (file.endsWith('.mp3') || file.endsWith('.m4a') || file.endsWith('.aac')) {
        const ext = path.extname(file);
        const name = path.parse(file).name;
        
        // Identify base name by removing suffixes
        let baseName = name;
        let type: 'instrumental' | 'vocals' | 'other' = 'other';
        
        if (name.endsWith('_(Instrumental)')) {
          baseName = name.slice(0, -15);
          type = 'instrumental';
        } else if (name.endsWith('_(Vocals)')) {
          baseName = name.slice(0, -9);
          type = 'vocals';
        } else if (name.endsWith('-1')) {
          baseName = name.slice(0, -2);
          type = 'instrumental';
        }
        
        if (!musicMap.has(baseName)) {
          musicMap.set(baseName, { title: baseName, ext: ext, hasInstrumental: false, hasVocals: false });
        }
        
        const entry = musicMap.get(baseName);
        if (type === 'instrumental') entry.hasInstrumental = true;
        if (type === 'vocals') entry.hasVocals = true;
      }
    });

    const songs = Array.from(musicMap.values()).map((item, index) => {
      const singerImgJpg = `${item.title}.jpg`;
      const singerImgPng = `${item.title}.png`;
      let singerImg = null;
      
      // Check music dir for image (full title match)
      if (fs.existsSync(path.join(musicDir, singerImgJpg))) {
        singerImg = `/music/${singerImgJpg}`;
      } else if (fs.existsSync(path.join(musicDir, singerImgPng))) {
        singerImg = `/music/${singerImgPng}`;
      }

      // If not found, try matching by artist name (part before ' - ')
      if (!singerImg && item.title.includes(' - ')) {
        const artistName = item.title.split(' - ')[0].trim();
        const artistImgJpg = `${artistName}.jpg`;
        const artistImgPng = `${artistName}.png`;
        if (fs.existsSync(path.join(musicDir, artistImgJpg))) {
          singerImg = `/music/${artistImgJpg}`;
        } else if (fs.existsSync(path.join(musicDir, artistImgPng))) {
          singerImg = `/music/${artistImgPng}`;
        }
      }

      // Construct URLs
      const instrumentalUrl = `/api/stream/${item.title}_(Instrumental)${item.ext}?phone=${phone || ''}`;
      const vocalsUrl = `/api/stream/${item.title}_(Vocals)${item.ext}?phone=${phone || ''}`;
      const legacyUrl = `/api/stream/${item.title}${item.ext}?phone=${phone || ''}`;

      return {
        id: index + 1000,
        title: item.title,
        artist: "本地音频",
        url: item.hasInstrumental ? instrumentalUrl : legacyUrl,
        vocalsUrl: item.hasVocals ? vocalsUrl : null,
        quality: isPremium ? "高音质 (无损/高码率)" : "低音质 (64kbps 压缩)",
        lrcUrl: `/api/lrc/${item.title}.lrc`,
        singerImg: singerImg
      };
    });

    res.json(songs);
  });

  // LRC fetcher
  app.get("/api/lrc/:filename", (req, res) => {
    const { filename } = req.params;
    const musicDir = path.join(__dirname, "music");
    const filePath = path.join(musicDir, filename);

    if (fs.existsSync(filePath)) {
      res.sendFile(filePath);
    } else {
      res.status(404).send("LRC not found");
    }
  });

  // Audio Streaming with Quality Control
  app.get("/api/stream/:filename", (req, res) => {
    const { filename } = req.params;
    const { phone } = req.query;
    const musicDir = path.join(__dirname, "music");

    let filePath = path.join(musicDir, filename);

    // If file doesn't exist, try fallbacks
    if (!fs.existsSync(filePath)) {
      const ext = path.extname(filename);
      const name = path.parse(filename).name;
      
      let fallbackName = '';
      if (name.endsWith('_(Instrumental)')) {
        fallbackName = name.slice(0, -15) + ext;
      } else if (name.endsWith('_(Vocals)')) {
        fallbackName = name.slice(0, -9) + ext;
      } else if (name.endsWith('-1')) {
        fallbackName = name.slice(0, -2) + ext;
      }
      
      if (fallbackName) {
        const fallbackPathLocal = path.join(musicDir, fallbackName);
        if (fs.existsSync(fallbackPathLocal)) {
          filePath = fallbackPathLocal;
        } else {
          return res.status(404).send("File not found");
        }
      } else {
        return res.status(404).send("File not found");
      }
    }

    let isPremium = false;
    if (phone) {
      const member = db.prepare("SELECT * FROM members WHERE phone = ?").get(phone) as any;
      if (member && member.expiry_date && new Date(member.expiry_date) > new Date()) {
        isPremium = true;
      }
    }

    // Note: Real-time transcoding to 64kbps would require ffmpeg installed on the system.
    // In this environment, we simulate the restriction by serving the file normally 
    // but the UI/API logic is prepared for it. 
    // On a real CentOS 7.6 server, you would use fluent-ffmpeg here.
    
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    res.setHeader('X-Audio-Quality', isPremium ? 'high' : 'low');
    const contentType = filename.endsWith('.mp3') ? 'audio/mpeg' : 'audio/mp4';

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;
      const file = fs.createReadStream(filePath, { start, end });
      const head = {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': contentType,
      };
      res.writeHead(206, head);
      file.pipe(res);
    } else {
      const head = {
        'Content-Length': fileSize,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
      };
      res.writeHead(200, head);
      fs.createReadStream(filePath).pipe(res);
    }
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

  app.listen(Number(PORT), "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
