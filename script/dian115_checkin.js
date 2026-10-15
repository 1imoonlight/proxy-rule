/**
 * @file        dian115_checkin.js
 * @desc        MADOW（m.dian115.com）每日普通签到
 *
 * Cookie 与 UA 由 dian115_cookie.js 在 Safari 访问站点时自动抓取。
 * 站点要求每个 API 请求带浏览器绑定的 ECDSA P-256 签名（X-Portal-Browser-*），
 * Loon 的 JSContext 没有 WebCrypto，所以 SHA-256 / HMAC / P-256 都在本文件内纯 JS 实现。
 */

const HOST = "https://m.dian115.com";
const API = HOST + "/api/portal";
const SIGNIN_MODE = "normal";
const STORE_COOKIE = "dian115_cookie";
const STORE_UA = "dian115_ua";
const STORE_KEY = "dian115_ec_key";
const TITLE = "MADOW 签到";
const DEFAULT_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
// Cloudflare 的短期/指纹 Cookie 与出口 IP、时效绑定，持久化后反而会带上过期值
const CF_COOKIES = /^(__cf_bm|cf_clearance|_cfuvid|__cflb)$/;

/* ------------------------------ 字节工具 ------------------------------ */

/** 字符串转 UTF-8 字节数组。 */
function utf8(str) {
  return Uint8Array.from(unescape(encodeURIComponent(str)), (c) => c.charCodeAt(0));
}

/** 拼接多个字节数组（Uint8Array 或普通数组）。 */
function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** 字节数组转无填充 base64url，与前端 ln() 的输出一致。 */
function base64url(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
    out += B64URL[(n >> 18) & 63] + B64URL[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += B64URL[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += B64URL[n & 63];
  }
  return out;
}

/** 大端字节数组转 BigInt。 */
function bytesToBig(bytes) {
  let hex = "0x0";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return BigInt(hex);
}

/** BigInt 转 32 字节大端数组。 */
function bigToBytes(x) {
  const hex = x.toString(16).padStart(64, "0");
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

/** 生成随机字节；优先 crypto.getRandomValues，不可用时退化为 Math.random 经 SHA-256 混合。 */
function randomBytes(len) {
  if (typeof crypto !== "undefined" && crypto && typeof crypto.getRandomValues === "function") {
    return crypto.getRandomValues(new Uint8Array(len));
  }
  const out = [];
  let seed = utf8(`${Date.now()}|${Math.random()}|${Math.random()}`);
  while (out.length < len) {
    seed = sha256(concat(seed, utf8(`${Math.random()}|${out.length}`)));
    out.push(...seed);
  }
  return Uint8Array.from(out.slice(0, len));
}

/* --------------------------- SHA-256 / HMAC --------------------------- */

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

/** 32 位循环右移。 */
function rotr(x, n) {
  return (x >>> n) | (x << (32 - n));
}

/** 计算 SHA-256 摘要，返回 32 字节 Uint8Array。 */
function sha256(bytes) {
  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const len = bytes.length;
  const buf = new Uint8Array(((len + 9 + 63) >> 6) << 6);
  buf.set(bytes);
  buf[len] = 0x80;
  const bitLen = len * 8;
  const hi = Math.floor(bitLen / 0x100000000);
  const end = buf.length;
  [hi >>> 24, hi >>> 16, hi >>> 8, hi, bitLen >>> 24, bitLen >>> 16, bitLen >>> 8, bitLen].forEach((b, i) => {
    buf[end - 8 + i] = b & 0xff;
  });
  const W = new Uint32Array(64);
  for (let off = 0; off < end; off += 64) {
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4;
      W[i] = (buf[j] << 24) | (buf[j + 1] << 16) | (buf[j + 2] << 8) | buf[j + 3];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = W[i - 16] + s0 + W[i - 7] + s1;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + SHA256_K[i] + W[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      [h, g, f, e, d, c, b, a] = [g, f, e, (d + t1) >>> 0, c, b, a, (t1 + t2) >>> 0];
    }
    [a, b, c, d, e, f, g, h].forEach((v, i) => {
      H[i] = (H[i] + v) >>> 0;
    });
  }
  const out = new Uint8Array(32);
  H.forEach((v, i) => {
    out[i * 4] = v >>> 24;
    out[i * 4 + 1] = v >>> 16;
    out[i * 4 + 2] = v >>> 8;
    out[i * 4 + 3] = v;
  });
  return out;
}

/** 计算 HMAC-SHA256。 */
function hmacSha256(key, msg) {
  let k = key.length > 64 ? sha256(key) : key;
  k = concat(k, new Uint8Array(64 - k.length));
  const ipad = k.map((b) => b ^ 0x36);
  const opad = k.map((b) => b ^ 0x5c);
  return sha256(concat(opad, sha256(concat(ipad, msg))));
}

/* ----------------------------- P-256 ECDSA ----------------------------- */

const P = BigInt("0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff");
const N = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");
const GX = BigInt("0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296");
const GY = BigInt("0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5");
const INFINITY = [0n, 1n, 0n];

/** 取非负模。 */
function mod(a, m) {
  const r = a % m;
  return r >= 0n ? r : r + m;
}

/** 扩展欧几里得求模逆。 */
function invert(a, m) {
  let [r0, r1, x0, x1] = [m, mod(a, m), 0n, 1n];
  while (r1 !== 0n) {
    const q = r0 / r1;
    [r0, r1] = [r1, r0 - q * r1];
    [x0, x1] = [x1, x0 - q * x1];
  }
  return mod(x0, m);
}

/** Jacobian 坐标倍点（a = -3）。 */
function pointDouble([X, Y, Z]) {
  if (Z === 0n || Y === 0n) return INFINITY;
  const delta = mod(Z * Z, P);
  const gamma = mod(Y * Y, P);
  const beta = mod(X * gamma, P);
  const alpha = mod(3n * (X - delta) * (X + delta), P);
  const X3 = mod(alpha * alpha - 8n * beta, P);
  const Z3 = mod((Y + Z) * (Y + Z) - gamma - delta, P);
  const Y3 = mod(alpha * (4n * beta - X3) - 8n * gamma * gamma, P);
  return [X3, Y3, Z3];
}

/** Jacobian 坐标点加。 */
function pointAdd(p1, p2) {
  if (p1[2] === 0n) return p2;
  if (p2[2] === 0n) return p1;
  const [X1, Y1, Z1] = p1;
  const [X2, Y2, Z2] = p2;
  const Z1Z1 = mod(Z1 * Z1, P);
  const Z2Z2 = mod(Z2 * Z2, P);
  const U1 = mod(X1 * Z2Z2, P);
  const U2 = mod(X2 * Z1Z1, P);
  const S1 = mod(Y1 * Z2 * Z2Z2, P);
  const S2 = mod(Y2 * Z1 * Z1Z1, P);
  if (U1 === U2) return S1 === S2 ? pointDouble(p1) : INFINITY;
  const H = mod(U2 - U1, P);
  const R = mod(S2 - S1, P);
  const HH = mod(H * H, P);
  const HHH = mod(H * HH, P);
  const V = mod(U1 * HH, P);
  const X3 = mod(R * R - HHH - 2n * V, P);
  const Y3 = mod(R * (V - X3) - S1 * HHH, P);
  return [X3, Y3, mod(H * Z1 * Z2, P)];
}

/** 计算 k·G，返回仿射坐标 [x, y]。 */
function multiplyG(k) {
  let R = INFINITY;
  const G = [GX, GY, 1n];
  for (let i = 255; i >= 0; i--) {
    R = pointDouble(R);
    if ((k >> BigInt(i)) & 1n) R = pointAdd(R, G);
  }
  const zi = invert(R[2], P);
  const zi2 = mod(zi * zi, P);
  return [mod(R[0] * zi2, P), mod(R[1] * zi2 * zi, P)];
}

/**
 * ECDSA P-256 / SHA-256 签名，k 按 RFC 6979 确定性生成。
 * 返回 64 字节 r||s（与 WebCrypto 的 IEEE P1363 格式一致，不是 DER）。
 */
function ecdsaSign(d, msg) {
  const e = mod(bytesToBig(sha256(msg)), N);
  const x = bigToBytes(d);
  const h1 = bigToBytes(e);
  let V = new Uint8Array(32).fill(1);
  let K = new Uint8Array(32);
  K = hmacSha256(K, concat(V, [0], x, h1));
  V = hmacSha256(K, V);
  K = hmacSha256(K, concat(V, [1], x, h1));
  V = hmacSha256(K, V);
  for (;;) {
    V = hmacSha256(K, V);
    const k = bytesToBig(V);
    if (k > 0n && k < N) {
      const r = mod(multiplyG(k)[0], N);
      const s = mod(invert(k, N) * (e + r * d), N);
      if (r !== 0n && s !== 0n) return concat(bigToBytes(r), bigToBytes(s));
    }
    K = hmacSha256(K, concat(V, [0]));
    V = hmacSha256(K, V);
  }
}

/** 读取持久化的签名密钥，不存在则生成并保存；返回 { d, x, y }（x/y 为 JWK base64url）。 */
function loadOrCreateKey() {
  try {
    const saved = JSON.parse($persistentStore.read(STORE_KEY) || "null");
    if (saved && saved.d && saved.x && saved.y) return { d: BigInt("0x" + saved.d), x: saved.x, y: saved.y };
  } catch (e) {
    console.log("签名密钥损坏，重新生成：" + e);
  }
  let d;
  do {
    d = bytesToBig(randomBytes(32));
  } while (d === 0n || d >= N);
  const [px, py] = multiplyG(d);
  const key = { d, x: base64url(bigToBytes(px)), y: base64url(bigToBytes(py)) };
  $persistentStore.write(JSON.stringify({ d: d.toString(16), x: key.x, y: key.y }), STORE_KEY);
  return key;
}

/* ------------------------------- Cookie ------------------------------- */

/** "a=1; b=2" 解析为有序对象。 */
function parseCookies(str) {
  const jar = {};
  String(str || "")
    .split(";")
    .forEach((part) => {
      const i = part.indexOf("=");
      if (i > 0) jar[part.slice(0, i).trim()] = part.slice(i + 1).trim();
    });
  return jar;
}

/** 序列化 Cookie；dropCloudflare 为 true 时剔除 Cloudflare Cookie（用于持久化）。 */
function serializeCookies(jar, dropCloudflare) {
  return Object.keys(jar)
    .filter((k) => !(dropCloudflare && CF_COOKIES.test(k)))
    .map((k) => `${k}=${jar[k]}`)
    .join("; ");
}

/** 把响应的 Set-Cookie 合并进 jar；兼容数组与逗号拼接两种形态（Expires 里的逗号不切分）。 */
function mergeSetCookie(jar, headers) {
  for (const name in headers || {}) {
    if (name.toLowerCase() !== "set-cookie") continue;
    const raw = headers[name];
    const items = Array.isArray(raw) ? raw : String(raw).split(/,(?=\s*[^;,=\s]+=)/);
    for (const item of items) {
      const pair = item.split(";")[0];
      const i = pair.indexOf("=");
      if (i <= 0) continue;
      const k = pair.slice(0, i).trim();
      const v = pair.slice(i + 1).trim();
      if (v === "" || /;\s*max-age=0\b/i.test(item)) delete jar[k];
      else jar[k] = v;
    }
  }
}

/* -------------------------------- HTTP -------------------------------- */

/** 构造模拟 Safari XHR 的请求头；缺 Sec-Fetch-* 时 Cloudflare 会直接 403。 */
function baseHeaders(ctx, method) {
  const headers = {
    "User-Agent": ctx.ua,
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh-Hans;q=0.9",
    "X-Requested-With": "XMLHttpRequest",
    Referer: HOST + "/me/signin",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
    Cookie: serializeCookies(ctx.jar, false),
  };
  if (method === "POST") {
    headers["Content-Type"] = "application/json";
    headers.Origin = HOST;
  }
  if (ctx.proof) headers["X-Portal-Browser-Proof"] = ctx.proof;
  return headers;
}

/** 生成请求签名头，签名串格式与前端 ba() 一致。 */
function signHeaders(ctx, method, path) {
  const ts = String(Math.round(Date.now() + ctx.clockOffset));
  const nonce = base64url(randomBytes(24));
  const msg = `portal-browser-request/v1\n${method}\n${path}\n${ts}\n${nonce}`;
  return {
    "X-Portal-Browser-TS": ts,
    "X-Portal-Browser-Nonce": nonce,
    "X-Portal-Browser-Sig": base64url(ecdsaSign(ctx.key.d, utf8(msg))),
  };
}

/**
 * 调用 /api/portal 下的接口。
 * @returns Promise<{ error, status, json, raw }>，网络错误不抛异常，由调用方按 error 判断。
 */
function request(ctx, method, path, payload, signed) {
  const headers = baseHeaders(ctx, method);
  if (signed && ctx.signing) Object.assign(headers, signHeaders(ctx, method, "/api/portal" + path));
  const opts = { url: API + path, headers, timeout: 15000, "auto-cookie": false };
  if (payload !== undefined) opts.body = JSON.stringify(payload);
  return new Promise((resolve) => {
    $httpClient[method.toLowerCase()](opts, (error, response, data) => {
      if (response) mergeSetCookie(ctx.jar, response.headers);
      let json = null;
      try {
        json = JSON.parse(data);
      } catch (e) {
        json = null;
      }
      resolve({ error, status: response ? response.status : 0, json, raw: String(data || "") });
    });
  });
}

/** 把失败响应压成一行可读描述。 */
function describe(res) {
  if (res.error) return "网络错误：" + res.error;
  if (res.json) return `HTTP ${res.status} ${res.json.code || ""} ${res.json.msg || ""}`.trim();
  if (/cloudflare/i.test(res.raw)) return `HTTP ${res.status}，被 Cloudflare 拦截`;
  return `HTTP ${res.status} ${res.raw.slice(0, 120)}`;
}

/* ------------------------------- 签到流程 ------------------------------- */

/** 走一遍 browser-challenge → browser-session，注册本脚本的公钥并校准服务器时钟。 */
async function establishBrowserSession(ctx) {
  ctx.proof = null;
  const challenge = await request(ctx, "GET", "/auth/browser-challenge");
  const c = challenge.json || {};
  if (c.enabled !== false && c.proof) ctx.proof = String(c.proof);
  const jwk = { kty: "EC", crv: "P-256", x: ctx.key.x, y: ctx.key.y };
  const session = await request(ctx, "POST", "/auth/browser-session", { public_jwk: jwk });
  const s = session.json || {};
  if (s.enabled === false) {
    ctx.signing = false;
    return;
  }
  if (session.status !== 200 || (s.code && s.code !== "ok")) {
    throw new Error("注册浏览器会话失败：" + describe(session));
  }
  const serverMs = Number(s.server_time_ms);
  ctx.clockOffset = Number.isFinite(serverMs) ? serverMs - Date.now() : 0;
  ctx.signing = true;
}

/** 发起签到；遇到 browser_proof_* 时与前端一样重建会话后重试一次。 */
async function signin(ctx) {
  const res = await request(ctx, "POST", "/signin", { mode: SIGNIN_MODE }, true);
  const code = res.json && res.json.code;
  if (code !== "browser_proof_required" && code !== "browser_proof_invalid") return res;
  await establishBrowserSession(ctx);
  return request(ctx, "POST", "/signin", { mode: SIGNIN_MODE }, true);
}

/** 按签到结果发通知；成功时把服务端可能刷新过的 Cookie 写回持久化存储。 */
function report(ctx, res) {
  const d = res.json || {};
  const code = d.code || "";
  if (res.status === 200 && (code === "" || code === "ok")) {
    $persistentStore.write(serializeCookies(ctx.jar, true), STORE_COOKIE);
    const award = Number(d.award);
    const gain = !Number.isFinite(award) ? "签到成功" : award > 0 ? `+${award} 积分` : award === 0 ? "本次空签" : `${award} 积分`;
    const detail = [d.new_balance !== undefined && `余额 ${d.new_balance}`, d.streak && `连签 ${d.streak} 天`];
    $notification.post(TITLE, gain, detail.filter(Boolean).join(" · "));
  } else if (code === "already_signed") {
    $persistentStore.write(serializeCookies(ctx.jar, true), STORE_COOKIE);
    $notification.post(TITLE, "今日已签到", "");
  } else if (res.status === 401 || ["no_token", "invalid_token", "token_revoked", "unauthorized"].includes(code)) {
    $notification.post(TITLE, "登录已失效", "在 Safari 重新打开 m.dian115.com 登录，插件会自动更新 Cookie");
  } else if (code === "browser_proof_required" || code === "browser_proof_invalid") {
    $notification.post(TITLE, "浏览器签名校验未通过", `${code}：登录态可能已绑定到浏览器密钥，网页路线不可用`);
  } else {
    $notification.post(TITLE, "签到失败", describe(res));
  }
  console.log(`signin → ${describe(res)}`);
}

/** 入口：读取 Cookie → 建立浏览器会话 → 签到 → 通知。 */
async function main() {
  const cookie = $persistentStore.read(STORE_COOKIE);
  if (!cookie) {
    $notification.post(TITLE, "未找到 Cookie", "先在 Safari 打开 m.dian115.com 并登录，插件会自动抓取");
    return;
  }
  const ctx = {
    ua: $persistentStore.read(STORE_UA) || DEFAULT_UA,
    jar: parseCookies(cookie),
    key: loadOrCreateKey(),
    proof: null,
    signing: false,
    clockOffset: 0,
  };
  await establishBrowserSession(ctx);
  report(ctx, await signin(ctx));
}

main()
  .catch((e) => {
    console.log("签到异常：" + (e && e.stack ? e.stack : e));
    $notification.post(TITLE, "签到异常", String((e && e.message) || e));
  })
  .finally(() => $done());
