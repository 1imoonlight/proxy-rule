/**
 * @file        nodeseek_cookie.js
 * @desc        Safari 访问 www.nodeseek.com 时抓取 Cookie、UA 与 refract-key，供 nodeseek_checkin.js 定时签到使用
 *
 * 由插件的 http-request 规则触发，只读请求头，原样放行请求。
 * - Cookie 整条保存、不剔除 cf_clearance：NodeSeek 的 Cloudflare 校验离不开它
 * - UA 必须和 Cookie 一起保存：cf_clearance 绑定 UA，refract-sign 的签名原文也包含 UA
 * - refract-key / refract-version 由站点 Service Worker 附加在请求上，签到脚本用它们自行计算签名
 */

const STORE_COOKIE = "nodeseek_cookie";
const STORE_UA = "nodeseek_ua";
const STORE_KEY = "nodeseek_refract_key";
const STORE_VERSION = "nodeseek_refract_version";

/** 大小写不敏感地读取请求头（HTTP/2 下头名是小写）。 */
function header(name) {
  for (const k in $request.headers) {
    if (k.toLowerCase() === name) return String($request.headers[k] || "").trim();
  }
  return "";
}

/** 值非空且与已存值不同才写入，返回是否写入。 */
function save(value, storeKey) {
  if (!value || value === $persistentStore.read(storeKey)) return false;
  return $persistentStore.write(value, storeKey);
}

const cookie = header("cookie");
const ua = header("user-agent");

if (cookie && ua) {
  const first = !$persistentStore.read(STORE_COOKIE);
  const cookieChanged = save(cookie, STORE_COOKIE);
  const uaChanged = save(ua, STORE_UA);
  // 只在首次抓到时提醒，避免站点轮换 Cookie 时频繁弹通知
  if (first && cookieChanged) $notification.post("NodeSeek 签到", "Cookie 抓取成功", "请确认 Safari 已登录，定时任务将用此登录态签到");
  if (cookieChanged || uaChanged) console.log("NodeSeek Cookie/UA 已更新");
}

// Service Worker 会定期轮换 key，静默跟随即可
save(header("refract-key"), STORE_KEY);
save(header("refract-version"), STORE_VERSION);

$done({});
