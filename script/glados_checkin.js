/**
 * @file        glados_checkin.js
 * @desc        GLaDOS 每日签到
 *
 * Cookie 与 UA 由 glados_cookie.js 在 Safari 访问 glados.cloud 时自动抓取。
 * GLaDOS 会校验签到请求的浏览器是否与登录设备一致（code 4 / device-mismatch），
 * 所以必须带抓取时的 UA，不能写死。
 */

const HOST = "https://glados.cloud";
const STORE_COOKIE = "glados_cookie";
const STORE_UA = "glados_ua";
const TITLE = "GLaDOS 签到";

/**
 * 调用 /api 下的接口。
 * @returns Promise<{ error, status, json, raw }>，网络错误不抛异常，由调用方按 error 判断。
 */
function request(ctx, method, path, payload) {
  const headers = {
    "User-Agent": ctx.ua,
    Cookie: ctx.cookie,
    Accept: "application/json, text/plain, */*",
    Origin: HOST,
    Referer: HOST + "/console/checkin",
  };
  const opts = { url: HOST + "/api" + path, headers, timeout: 15000, "auto-cookie": false };
  if (payload !== undefined) {
    headers["Content-Type"] = "application/json;charset=UTF-8";
    opts.body = JSON.stringify(payload);
  }
  return new Promise((resolve) => {
    $httpClient[method](opts, (error, response, data) => {
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
  if (res.json) return `HTTP ${res.status} code=${res.json.code} ${res.json.message || ""}`.trim();
  if (/cloudflare/i.test(res.raw)) return `HTTP ${res.status}，被 Cloudflare 拦截`;
  return `HTTP ${res.status} ${res.raw.slice(0, 120)}`;
}

/** 设备信息可能是字符串或对象，统一转成可读文本。 */
function deviceText(device) {
  return typeof device === "string" ? device : JSON.stringify(device);
}

/** 签到后查询剩余天数；失败时返回 null，不影响签到通知。 */
async function leftDays(ctx) {
  const res = await request(ctx, "get", "/user/status");
  const data = res.json && res.json.code === 0 && res.json.data;
  return data && data.leftDays !== undefined ? Math.floor(Number(data.leftDays)) : null;
}

/** 入口：读取 Cookie/UA → 签到 → 按结果通知。 */
async function main() {
  const ctx = { cookie: $persistentStore.read(STORE_COOKIE), ua: $persistentStore.read(STORE_UA) };
  if (!ctx.cookie || !ctx.ua) {
    $notification.post(TITLE, "未找到 Cookie", "先在 Safari 登录 glados.cloud 并打开控制台，插件会自动抓取");
    return;
  }
  const res = await request(ctx, "post", "/user/checkin", { token: "glados.cloud" });
  console.log(`checkin → ${describe(res)}`);
  const d = res.json;
  if (!d) {
    $notification.post(TITLE, "签到失败", describe(res));
  } else if (d.code === 4 && d.reason === "device-mismatch") {
    const devices = `登录设备：${deviceText(d.loginDevice)}；当前：${deviceText(d.currentDevice)}`;
    $notification.post(TITLE, "设备不匹配，需重新登录", `在 Safari 退出并重新登录 glados.cloud。${devices}`);
  } else if (d.code === -2 || res.status === 401) {
    $notification.post(TITLE, "登录已失效", "在 Safari 重新登录 glados.cloud，插件会自动更新 Cookie");
  } else {
    const balance = d.list && d.list.length > 0 ? `积分 ${Math.round(Number(d.list[0].balance))}` : "";
    const streak = d.streak != null ? `连签 ${d.streak} 天` : "";
    const days = await leftDays(ctx);
    const detail = [d.message, balance, streak, days !== null && `剩余 ${days} 天`].filter(Boolean).join(" · ");
    $notification.post(TITLE, d.code === 0 ? "签到成功" : "签到未成功", detail);
  }
}

main()
  .catch((e) => {
    console.log("签到异常：" + (e && e.stack ? e.stack : e));
    $notification.post(TITLE, "签到异常", String((e && e.message) || e));
  })
  .finally(() => $done());
