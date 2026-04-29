// POST /api/admin/books — 创建新书籍
import { checkAdmin, parseJsonBody, requireMinRole } from '../_utils.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  const auth = await checkAdmin(request, env);
  if (!auth.ok) {
    const status = auth.reason === 'locked' ? 429 : 401;
    const msg = auth.reason === 'locked' ? 'Too many failed attempts, try again later' : 'Unauthorized';
    return Response.json({ error: msg }, { status });
  }

  // demo 用户配额：最多 10 本书
  if (!requireMinRole(auth, 'admin')) {
    const { count } = await env.DB.prepare(
      'SELECT COUNT(*) as count FROM books WHERE created_by = ?'
    ).bind(auth.userId).first();
    if (count >= 10) return Response.json({ error: '演示账号最多创建 10 本书' }, { status: 403 });
  }

  const body = await parseJsonBody(request);
  if (!body) return Response.json({ error: 'Invalid JSON' }, { status: 400 });

  const { title, description, author, original_title, ridi_rating } = body;
  const rawTitle = typeof title === 'string' ? title.trim() : '';
  const rawOriginalTitle = typeof original_title === 'string' ? original_title.trim() : '';
  const normalizedTitle = rawTitle.slice(0, 200);
  const normalizedOriginalTitle = rawOriginalTitle.slice(0, 200);

  // 原文名和译名至少填一个
  const hasTitle = normalizedTitle.length > 0;
  const hasOriginal = normalizedOriginalTitle.length > 0;
  if (!hasTitle && !hasOriginal) {
    return Response.json({ error: '译名和原文名至少填写一个' }, { status: 400 });
  }
  if (rawTitle.length > 200) {
    return Response.json({ error: 'Title too long (max 200)' }, { status: 400 });
  }
  if (rawOriginalTitle.length > 200) {
    return Response.json({ error: 'Original title too long (max 200)' }, { status: 400 });
  }

  // ridi评分校验：0-5，支持小数
  let ratingValue = null;
  if (ridi_rating !== undefined && ridi_rating !== null && ridi_rating !== '') {
    const parsed = parseFloat(ridi_rating);
    if (isNaN(parsed) || parsed < 0 || parsed > 5) {
      return Response.json({ error: 'ridi评分范围为 0-5' }, { status: 400 });
    }
    ratingValue = Math.round(parsed * 10) / 10; // 保留一位小数
  }

  const result = await env.DB.prepare(`
    INSERT INTO books (title, original_title, description, author, ridi_rating, created_by) VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    normalizedTitle,
    normalizedOriginalTitle,
    (typeof description === 'string' ? description : '').trim().slice(0, 2000),
    (typeof author === 'string' ? author : '').trim().slice(0, 100),
    ratingValue,
    auth.userId
  ).run();

  // demo配额二次检查（防TOCTOU竞态绕过）
  if (!requireMinRole(auth, 'admin')) {
    const { count } = await env.DB.prepare(
      'SELECT COUNT(*) as count FROM books WHERE created_by = ?'
    ).bind(auth.userId).first();
    if (count > 10) {
      await env.DB.prepare('DELETE FROM books WHERE id = ?').bind(result.meta.last_row_id).run().catch(() => {});
      return Response.json({ error: '演示账号最多创建 10 本书' }, { status: 403 });
    }
  }

  return Response.json({
    success: true,
    book: {
      id: result.meta.last_row_id,
      title: normalizedTitle,
      original_title: normalizedOriginalTitle,
      ridi_rating: ratingValue
    }
  }, { status: 201 });
}
