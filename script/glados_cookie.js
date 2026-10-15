/**
 * @file        glados_cookie.js
 * @desc        Safari 访问 glados.cloud 时抓取登录 Cookie 与 UA，供 glados_checkin.js 定时签到使用
 *
 * 由插件的 http-request 规则触发，只读请求头，原样放行请求。
 * UA 必须和 Cookie 一起保存：GLaDOS 会校验签到浏览器与登录设备是否一致。
 */

const STORE_COOKIE = "glados_cookie";
const STORE_UA = "glados_ua";
// Cloudflare 的短期/指纹 Cookie 与出口 IP、时效绑定，存下来反而会让定时任务带上过期值
const CF_COOKIES = /^(__cf_bm|cf_clearance|_cfuvid|__cflb)$/;

/** 大小写不敏感地读取请求头（HTTP/2 下头名是小写）。 */
function header(name) {
  for (const k in $request.headers) {
    if (k.toLowerCase() === name) return String($request.headers[k] || "");
  }
  return "";
}

const cookie = header("cookie")
  .split(";")
  .map((s) => s.trim())
  .filter((s) => s.includes("=") && !CF_COOKIES.test(s.slice(0, s.indexOf("=")).trim()))
  .join("; ");
const ua = header("user-agent");

const saved = $persistentStore.read(STORE_COOKIE);
if (cookie && ua && (cookie !== saved || ua !== $persistentStore.read(STORE_UA))) {
  $persistentStore.write(cookie, STORE_COOKIE);
  $persistentStore.write(ua, STORE_UA);
  // 只在首次抓到时提醒，避免站点轮换 Cookie 时频繁弹通知
  if (!saved) $notification.post("GLaDOS 签到", "Cookie 抓取成功", "定时任务将用此登录态签到");
  console.log("GLaDOS Cookie/UA 已更新");
}

$done({});
