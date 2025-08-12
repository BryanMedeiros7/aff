const express = require("express");
const cors = require("cors");
const youtube = require("youtube-search-api");
const path = require("path");
const { spawn, execFileSync } = require("child_process");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static(__dirname + "/public"));
app.use("/static", express.static(__dirname + "/public"));

function getYtDlpPath() {
  if (process.platform !== "win32") return "yt-dlp";
  return path.join(__dirname, "yt-dlp", "yt-dlp.exe");
}

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

app.get("/random-video", async (req, res) => {
  try {
    const searchTerms = ["natiruts", "trap", "j.eskine", "platero beats", "braba da nbr", "menos é mais"];
    const randomQuery = searchTerms[Math.floor(Math.random() * searchTerms.length)];
    const results = await youtube.GetListByKeyword(randomQuery, false, 10);

    if (results.items.length > 0) {
      const randomVideo = results.items[Math.floor(Math.random() * results.items.length)];
      res.json({
        title: randomVideo.title,
        artist: randomVideo.channelTitle || "Desconhecido",
        videoId: randomVideo.id,
        thumbnail: randomVideo.thumbnail.thumbnails[0].url,
      });
    } else {
      res.status(404).json({ error: "Nenhum vídeo encontrado" });
    }
  } catch (error) {
    res.status(500).json({ error: "Erro interno ao buscar vídeo" });
  }
});

app.get("/download-mp3", (req, res) => {
  const videoId = req.query.videoId;
  if (!videoId) return res.status(400).json({ error: "ID do vídeo não fornecido." });

  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const ytDlpPath = getYtDlpPath();

  let title = videoId;
  try {
    const infoJson = execFileSync(ytDlpPath, ["-J", url]).toString();
    const info = JSON.parse(infoJson);
    title = info.title.replace(/[\\/:*?"<>|]/g, "");
  } catch (err) {
    console.error("Erro ao extrair título:", err);
  }

  res.setHeader("Content-Type", "audio/mpeg");
  res.setHeader("Content-Disposition", `attachment; filename="${title}.mp3"`);

  const ytDlpProcess = spawn(ytDlpPath, [
    "-f", "bestaudio",
    "--extract-audio",
    "--audio-format", "mp3",
    "-o", "-",
    url
  ]);

  ytDlpProcess.stderr.on("data", (data) => {
    const match = data.toString().match(/\[download\]\s+(\d+\.\d+)%/);
    if (match) sendProgress(parseFloat(match[1]));
  });

  ytDlpProcess.stdout.pipe(res);

  ytDlpProcess.on("close", (code) => {
    sendDone();
    if (code !== 0 && !res.headersSent) res.status(500).end("Erro ao baixar áudio.");
  });
});

const clients = new Set();
app.get("/download-progress", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  clients.add(res);
  req.on("close", () => clients.delete(res));
});

function sendProgress(progress) {
  for (const client of clients) client.write(`event: progress\ndata: ${progress}\n\n`);
}
function sendDone() {
  for (const client of clients) {
    client.write(`event: done\ndata: 100\n\n`);
    client.end();
  }
}

app.get("/video-info", (req, res) => {
  const videoId = req.query.videoId;
  if (!videoId || typeof videoId !== "string" || videoId.length !== 11)
    return res.status(400).json({ error: "ID do vídeo inválido." });

  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const ytDlpPath = getYtDlpPath();

  try {
    const infoJson = execFileSync(ytDlpPath, ["-J", url], { maxBuffer: 20 * 1024 * 1024 }).toString();
    const info = JSON.parse(infoJson);
    const durationSec = parseInt(info.duration) || 0;
    const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
    let thumbnail = "";
    if (typeof info.thumbnail === "string") thumbnail = info.thumbnail;
    else if (Array.isArray(info.thumbnails) && info.thumbnails.length)
      thumbnail = info.thumbnails[info.thumbnails.length - 1].url || "";

    res.json({
      title: info.title || info.fulltitle || `Vídeo ${videoId}`,
      artist: info.artist || info.uploader || "Desconhecido",
      duration: durationSec,
      duration_formatted: fmt(durationSec),
      thumbnail,
      videoId: info.id || videoId
    });
  } catch (err) {
    console.error("Erro ao obter info:", err.message);
    res.json({
      title: "Título não identificado",
      artist: "Artista desconhecido",
      duration: 0,
      duration_formatted: "00:00",
      thumbnail: "",
      videoId
    });
  }
});

app.get("/videos", async (req, res) => {
  const { genre, style, key } = req.query;
  const searchQuery = `${genre || ""} ${style || ""} ${key || ""}`.trim();
  try {
    const results = await youtube.GetListByKeyword(searchQuery, false, 10);
    const videos = results.items.map(item => ({
      title: item.title,
      artist: item.channelTitle || "Desconhecido",
      videoId: item.id,
      thumbnail: item.thumbnail?.thumbnails[0]?.url || ""
    }));
    res.json(videos);
  } catch (error) {
    res.status(500).json({ error: "Erro ao buscar vídeos filtrados" });
  }
});

app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
