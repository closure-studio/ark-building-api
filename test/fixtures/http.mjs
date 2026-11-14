import { request } from 'node:http';

// 临时端口可能落入 fetch 的浏览器禁用端口表，测试统一使用原生 HTTP。
export function send(port, body = '{}', { path = '/api/v1/arrange', method = 'POST', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method,
      headers: { 'content-type': 'application/json', ...headers } }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('error', reject);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(text) }); }
        catch (error) { reject(error); }
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}
