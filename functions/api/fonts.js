// 公开API：获取可用自定义字体列表
export async function onRequestGet(context) {
  const { env } = context;
  try {
    const row = await env.DB.prepare("SELECT value FROM site_settings WHERE key = 'custom_fonts'").first();
    const fonts = row ? JSON.parse(row.value) : [];
    return Response.json({ fonts });
  } catch {
    return Response.json({ fonts: [] });
  }
}
