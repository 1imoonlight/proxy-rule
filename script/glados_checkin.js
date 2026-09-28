/**
 * @file        glados_checkin.js
 * @desc        GLaDOS签到
 */

(async () => {
  const url = "https://glados.cloud/api/user/checkin";
  const method = "POST";
  const headers = {
    "Cookie": "koa:sess=eyJ1c2VySWQiOjU4NTE1NSwiX2V4cGlyZSI6MTgwODYyMTAyODIxMywiX21heEFnZSI6MjU5MjAwMDAwMDB9; koa:sess.sig=x-9SEVCe_NfiK_8B5904MJyd7IU; gld:sess=gld_c959dfe438f9f8b9798183cd41b1fd43c1cdeb55e5f7d84c; gld:sess.sig=qCuSfm5uO-ohS_Z2GiO0vynkDKY",
    "Content-Type": "application/json;charset=UTF-8",
    "Accept": "application/json, text/plain, */*",
    "Origin": "https://glados.cloud",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",
  };
  const body = {
    "token": "glados.cloud"
  };

  $httpClient.post(
    {
      url,
      method,
      headers,
      body: JSON.stringify(body),
    },
    (error, response, data) => {
      if (error) {
        console.log("签到请求失败，错误信息：" + error);
      } else {
        console.log("签到完成，返回数据：");
        console.log(data);
      }
      $done();
    }
  );
})();
