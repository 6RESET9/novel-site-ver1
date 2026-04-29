// GET /api/settings — 公开读取站点设置（白名单过滤）
const PUBLIC_KEYS = ['site_name', 'site_desc', 'footer_text', 'custom_fonts'];

export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);

  // GET /api/settings?check=github — 检查 GitHub 登录是否启用（公开）
  if (url.searchParams.get('check') === 'github') {
    const enabled = await env.DB.prepare("SELECT value FROM site_settings WHERE key = 'github_oauth_enabled'").first();
    return Response.json({ githubLoginEnabled: enabled?.value === 'true' });
  }

  const { results } = await env.DB.prepare('SELECT key, value FROM site_settings').all();
  const settings = {};
  for (const row of results) {
    if (PUBLIC_KEYS.includes(row.key)) {
      settings[row.key] = row.value;
    }
  }
  return Response.json({ settings });
}
