/**
 * @file        glados_checkin.js
 * @desc        GLaDOS签到
 */

(async () => {
  const url = "https://glados.rocks/api/user/checkin";
  const method = "POST";
  const headers = {
    "Authorization": "30341116719929408944031713315076-1080-1920",
    "Cookie": "koa:sess=eyJ1c2VySWQiOjU4NTE1NSwiX2V4cGlyZSI6MTc4MjAzMTEwNTU3MiwiX21heEFnZSI6MjU5MjAwMDAwMDB9; koa:sess.sig=H4FvivKk1MVD5h47CpI2jp_6fgo; __stripe_mid=9e72becb-60f5-4801-a8cb-e5054002bbf0fac4ce",
    "Content-Type": "application/json",
    "Accept": "*/*",
    "Host": "glados.rocks",
    "Connection": "keep-alive",
  };
  const body = {
    "token": "glados.one"
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