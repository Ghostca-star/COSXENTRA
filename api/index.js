const axios = require('axios');
const cheerio = require('cheerio');

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const HEAD = { "user-agent": UA, accept: "text/html,application/xhtml+xml,*/*", "accept-language": "en-US,en;q=0.9" };
const HOST = /(?:^|[/.@])(?:pinterest\.[a-z.]+|pin\.it)(?:[/:]|$)/i;
const PINID = /\/pin\/([A-Za-z0-9_-]{4,})/;

const braceJson = (html, from) => {
  const s = html.indexOf("{", html.indexOf('"', html.indexOf('"', from) + 1));
  let depth = 0, str = false, esc = false;
  for (let k = s; k < html.length; k++) {
    const c = html[k];
    if (str) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') str = false;
      continue;
    }
    if (c === '"') str = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return { json: JSON.parse(html.slice(s, k + 1)), end: k };
  }
  return null;
};

const readPin = (html) => {
  const marker = "__PWS_RELAY_REGISTER_COMPLETED_REQUEST__(";
  let i = 0;
  while ((i = html.indexOf(marker, i)) > -1) {
    const got = braceJson(html, i + marker.length);
    if (!got) break;
    for (const v of Object.values(got.json.data || {})) if (v && v.data && v.data.images_orig) return v.data;
    i = got.end;
  }
  return null;
};

const pickMedia = (pin, $) => {
  const list = Object.values(pin?.videos?.videoList || {});
  const mp4 = [
    ...list.filter((v) => v && /\.mp4(\?|$)/i.test(v.url || "")).map((v) => ({ url: v.url, a: (v.width || 0) * (v.height || 0) })),
    ...(pin?.videos?.videoUrls || []).filter((u) => /\.mp4(\?|$)/i.test(u)).map((u) => ({ url: u, a: Number((u.match(/(\d{3,4})p/) || [])[1]) || 0 })),
  ].sort((a, b) => b.a - a.a);
  const img = pin?.images_orig?.url || pin?.imageLargeUrl || $('meta[property="og:image"]').attr("content");
  const vid = $('meta[property="og:video"]').attr("content");
  if (mp4.length) return { type: "video", url: mp4[0].url };
  if (vid) return { type: "video", url: vid };
  if (/\.gif(\?|$)/i.test(img || "")) return { type: "gif", url: img };
  if (img) return { type: "image", url: img };
  return null;
};

module.exports = async (req, res) => {
  // CORS Setup
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const start = Date.now();
  let link = String(req.query.url || "").trim();
  
  if (!link) {
    return res.status(400).json({ status: false, error: "Parameter 'url' wajib diisi." });
  }

  if (!/^https?:\/\//i.test(link)) link = "https://" + link;
  if (!HOST.test(link)) {
    return res.status(400).json({ status: false, error: "URL Pinterest tidak valid." });
  }

  try {
    let id = (link.match(PINID) || [])[1];
    let html = "";
    
    if (!id) {
      const r = await axios.get(link, { maxRedirects: 6, timeout: 25000, headers: HEAD, validateStatus: () => true });
      link = r.request?.res?.responseUrl || link;
      id = (link.match(PINID) || [])[1];
      html = String(r.data || "");
    }
    
    if (!id) throw new Error("Pin ID tidak ditemukan dari URL.");

    if (!html) {
      const r = await axios.get(`https://www.pinterest.com/pin/${id}/`, { timeout: 25000, headers: HEAD });
      html = String(r.data || "");
    }
    
    const $ = cheerio.load(html);
    const pin = readPin(html);
    const media = pickMedia(pin, $);
    
    if (!media) throw new Error("Media tidak ditemukan (pin privat atau tidak tersedia).");

    const title = String(pin?.title || pin?.gridTitle || pin?.seoTitle || $('meta[property="og:title"]').attr("content") || "").trim();
    
    res.status(200).json({
      status: true,
      time: `${((Date.now() - start) / 1000).toFixed(2)}s`,
      result: {
        id: pin?.entityId || id,
        title: title || "Pinterest Media",
        type: media.type,
        downloadUrl: media.url,
        thumbnail: pin?.images_474x?.url || pin?.images_236x?.url || pin?.images_orig?.url || $('meta[property="og:image"]').attr("content") || null,
      },
    });

  } catch (error) {
    res.status(500).json({ status: false, error: error.message });
  }
};
