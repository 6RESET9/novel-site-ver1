// 公开API：从R2读取字体文件返回
import { validateId } from '../_utils.js';

export async function onRequestGet(context) {
  const { env, params } = context;
  const name = params.name;

  // 安全校验：只允许字母数字下划线横杠点号，防路径穿越
  if (!name || !/^[\w\-\.]+\.woff2$/i.test(name)) {
    return new Response('Invalid font name', { status: 400 });
  }

  const obj = await env.R2.get(`fonts/${name}`);
  if (!obj) return new Response('Font not found', { status: 404 });

  return new Response(obj.body, {
    headers: {
      'Content-Type': 'font/woff2',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
