/**
 * @file        nodeseek_checkin.js
 * @desc        NodeSeek 每日签到（随机鸡腿）
 *
 * Cookie、UA、refract-key 由 nodeseek_cookie.js 在 Safari 访问 www.nodeseek.com 时自动抓取。
 * 站点 Service Worker（sw.js 0.3.34）给每个请求加 refract-* 签名头，服务端校验不过即拒绝：
 *   refract-sign = SHA1([method, url, UA, body, refract-key].join("\n\n"))，小写 hex
 * key 过期时服务端在响应头 refract-key-update 下发新 key，换 key 重签重发即可，与 sw.js 行为一致。
 */

const HOST = "https://www.nodeseek.com";
// random=true 为"试试手气"随机鸡腿，false 为固定鸡腿
const ATTEND_URL = HOST + "/api/attendance?random=true";
const STORE_COOKIE = "nodeseek_cookie";
const STORE_UA = "nodeseek_ua";
const STORE_KEY = "nodeseek_refract_key";
const STORE_VERSION = "nodeseek_refract_version";
// sw.js 0.3.34 内置的初始 key：没抓到 key 时用它起步，服务端会通过 refract-key-update 下发新 key
const INITIAL_KEY = "CHICZkKViFoZmVbIH1Y6";
const DEFAULT_VERSION = "0.3.34";
// 与 sw.js 协商逻辑的重试上限一致
const MAX_KEY_RETRY = 5;
const TITLE = "NodeSeek 签到";

/** 纯 JS SHA-1，输入按 UTF-8 编码，返回小写 hex（Loon 脚本环境没有 crypto.subtle）。 */
function sha1Hex(str) {
  const bytes = unescape(encodeURIComponent(str));
  const len = bytes.length;
  const words = [];
  for (let i = 0; i < len; i++) words[i >> 2] |= bytes.charCodeAt(i) << (24 - (i % 4) * 8);
  words[len >> 2] |= 0x80 << (24 - (len % 4) * 8);
  words[(((len + 8) >> 6) + 1) * 16 - 1] = len * 8;

  const h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  const w = new Array(80);
  for (let i = 0; i < words.length; i += 16) {
    let [a, b, c, d, e] = h;
    for (let t = 0; t < 80; t++) {
      if (t < 16) {
        w[t] = words[i + t] | 0;
      } else {
        const x = w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16];
        w[t] = (x << 1) | (x >>> 31);
      }
      let f, k;
      if (t < 20) [f, k] = [(b & c) | (~b & d), 0x5a827999];
      else if (t < 40) [f, k] = [b ^ c ^ d, 0x6ed9eba1];
      else if (t < 60) [f, k] = [(b & c) | (b & d) | (c & d), 0x8f1bbcdc];
      else [f, k] = [b ^ c ^ d, 0xca62c1d6];
      const tmp = (((a << 5) | (a >>> 27)) + f + e + k + w[t]) | 0;
      [e, d, c, b, a] = [d, c, (b << 30) | (b >>> 2), a, tmp];
    }
    [a, b, c, d, e].forEach((v, j) => (h[j] = (h[j] + v) | 0));
  }
  return h.map((v) => (v >>> 0).toString(16).padStart(8, "0")).join("");
}

/** 大小写不敏感地读取 signedPost 结果里的响应头。 */
function responseHeader(res, name) {
  for (const k in res.headers || {}) {
    if (k.toLowerCase() === name) return String(res.headers[k] || "");
  }
  return "";
}

/**
 * 用 ctx 中的 key 签名并 POST 一次。
 * @param ctx { cookie, ua, key, version }，签名与请求头都取自这里
 * @param url 完整请求地址，原样参与签名
 * @returns Promise<{ error, status, headers, json, raw }>，网络错误不抛异常，由调用方按 error 判断。
 */
function signedPost(ctx, url) {
  const body = "";
  const headers = {
    "User-Agent": ctx.ua,
    Cookie: ctx.cookie,
    Accept: "*/*",
    "Accept-Language": "zh-CN,zh-Hans;q=0.9",
    "Content-Type": "text/plain;charset=UTF-8",
    Origin: HOST,
    // 请求由 Service Worker 重建发出，浏览器里的 Referer 就是 sw.js 地址
    Referer: `${HOST}/sw.js?v=${ctx.version}`,
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
    "refract-sign": sha1Hex(["POST", url, ctx.ua, body, ctx.key].join("\n\n")),
    "refract-version": ctx.version,
    "refract-key": ctx.key,
  };
  // Loon 默认走 HTTP/1.1，浏览器 UA 配 h1 容易被 Cloudflare 判为脚本
  // 单次 10s：最坏 5 次换 key 重试仍在插件 cron 的 60s 超时内
  const opts = { url, headers, body, timeout: 10000, alpn: "h2", "auto-cookie": false, "auto-redirect": false };
  return new Promise((resolve) => {
    $httpClient.post(opts, (error, response, data) => {
      let json = null;
      try {
        json = JSON.parse(data);
      } catch (e) {
        json = null;
      }
      resolve({
        error,
        status: response ? response.status : 0,
        headers: response ? response.headers : {},
        json,
        raw: String(data || ""),
      });
    });
  });
}

/** 按 sw.js 的协商逻辑发送：响应带 refract-key-update 就保存新 key 并重签重发。 */
async function negotiate(ctx, url) {
  let res;
  for (let i = 0; i < MAX_KEY_RETRY; i++) {
    res = await signedPost(ctx, url);
    const newKey = res.error ? "" : responseHeader(res, "refract-key-update");
    if (!newKey) return res;
    console.log("refract-key 已过期，换新 key 重发");
    ctx.key = newKey;
    $persistentStore.write(newKey, STORE_KEY);
  }
  return res;
}

/** 非 JSON 的 HTML 响应视为 Cloudflare 拦截页（含 challenge 与 1020 等 error 页）。 */
function isBlockedPage(res) {
  return !res.error && !res.json && /<html|just a moment|cloudflare/i.test(res.raw);
}

/** 把失败响应压成一行可读描述。 */
function describe(res) {
  if (res.error) return "网络错误：" + res.error;
  // 只有重试用尽时最后一次响应才仍带 refract-key-update
  if (responseHeader(res, "refract-key-update")) return `连续 ${MAX_KEY_RETRY} 次被要求更换 refract-key，签名协商失败`;
  if (res.json) return `HTTP ${res.status} ${res.json.message || JSON.stringify(res.json).slice(0, 120)}`;
  if (isBlockedPage(res)) return `HTTP ${res.status}，被 Cloudflare 拦截`;
  return `HTTP ${res.status} ${res.raw.slice(0, 120) || "（无响应体）"}`;
}

/** 入口：读取登录态 → 签名签到 → 按结果通知。 */
async function main() {
  const ctx = {
    cookie: $persistentStore.read(STORE_COOKIE),
    ua: $persistentStore.read(STORE_UA),
    key: $persistentStore.read(STORE_KEY) || INITIAL_KEY,
    version: $persistentStore.read(STORE_VERSION) || DEFAULT_VERSION,
  };
  if (!ctx.cookie || !ctx.ua) {
    $notification.post(TITLE, "未找到 Cookie", "先在 Safari 登录 www.nodeseek.com 并打开任意页面，插件会自动抓取");
    return;
  }
  const res = await negotiate(ctx, ATTEND_URL);
  const desc = describe(res);
  console.log(`attendance → ${desc}`);
  const d = res.json;
  const msg = d && d.message ? String(d.message) : "";
  if (!d) {
    const hint = isBlockedPage(res) ? "。在 Safari 重新打开 www.nodeseek.com 刷新 Cookie" : "";
    $notification.post(TITLE, "签到失败", desc + hint);
  } else if (d.success) {
    $notification.post(TITLE, "签到成功", msg);
  } else if (msg.includes("已完成签到")) {
    $notification.post(TITLE, "今日已签到", msg);
  } else if (d.status === 404 || res.status === 401) {
    $notification.post(TITLE, "登录已失效", "在 Safari 重新登录 www.nodeseek.com，插件会自动更新 Cookie");
  } else {
    $notification.post(TITLE, "签到未成功", desc);
  }
}

main()
  .catch((e) => {
    console.log("签到异常：" + (e && e.stack ? e.stack : e));
    $notification.post(TITLE, "签到异常", String((e && e.message) || e));
  })
  .finally(() => $done());
