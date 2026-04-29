// PUT /api/admin/chapters/:id — 编辑章节
// DELETE /api/admin/chapters/:id — 删除章节
import { checkAdmin, validateId, parseJsonBody, checkBookOwnership } from '../../_utils.js';

const MAX_CONTENT_LENGTH = 500000;

async function authCheck(request, env) {
  const auth = await checkAdmin(request, env);
  if (!auth.ok) {
    const status = auth.reason === 'locked' ? 429 : 401;
    const msg = auth.reason === 'locked' ? 'Too many failed attempts, try again later' : 'Unauthorized';
    return { denied: Response.json({ error: msg }, { status }) };
  }
  return { auth };
}

export async function onRequestPut(context) {
  const { request, env, params } = context;
  const { denied, auth } = await authCheck(request, env);
  if (denied) return denied;
  if (!validateId(params.id)) return Response.json({ error: 'Invalid chapter ID' }, { status: 400 });

  const chapter = await env.DB.prepare('SELECT * FROM chapters WHERE id = ?').bind(params.id).first();
  if (!chapter) return Response.json({ error: 'Chapter not found' }, { status: 404 });

  // demo只能编辑自己书的章节
  if (!await checkBookOwnership(auth, env, chapter.book_id)) {
    return Response.json({ error: '只能编辑自己书籍的章节' }, { status: 403 });
  }

  const body = await parseJsonBody(request);
  if (!body) return Response.json({ error: 'Invalid JSON' }, { status: 400 });

  const { title, content, version } = body;

  // 乐观锁：编辑内容时必须携带version字段
  const currentVersion = chapter.version || 0;
  if (content && version === undefined) {
    return Response.json({ error: '请提供 version 字段以防止并发冲突' }, { status: 400 });
  }
  if (version !== undefined && Number(version) !== currentVersion) {
    return Response.json({ error: '内容已被其他人修改，请刷新后重试' }, { status: 409 });
  }

  if (title && typeof title === 'string' && title.trim().length > 0) {
    if (title.length > 200) return Response.json({ error: 'Title too long' }, { status: 400 });
    await env.DB.prepare("UPDATE chapters SET title = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(title.trim(), params.id).run();
  }

  if (content && typeof content === 'string' && content.trim().length > 0) {
    if (content.length > MAX_CONTENT_LENGTH) {
      return Response.json({ error: `Content too long (max ${MAX_CONTENT_LENGTH} chars)` }, { status: 400 });
    }
    const wordCount = content.trim().length;
    // 先写R2 → 成功后更新D1 version
    const newVersion = (chapter.version || 0) + 1;
    try {
      await env.R2.put(chapter.content_key, content.trim());
    } catch (err) {
      return Response.json({ error: 'Failed to update content' }, { status: 500 });
    }
    try {
      await env.DB.prepare(
        "UPDATE chapters SET word_count = ?, version = ?, updated_at = datetime('now') WHERE id = ?"
      ).bind(wordCount, newVersion, params.id).run();
    } catch (err) {
      // DB失败，R2已写入新内容但version未更新，下次编辑会覆盖，无需回滚R2
      return Response.json({ error: 'Failed to update metadata' }, { status: 500 });
    }
  }

  await env.DB.prepare("UPDATE books SET updated_at = datetime('now') WHERE id = ?")
    .bind(chapter.book_id).run();

  // 检查是否有批注可能失效
  let warning = null;
  if (content) {
    const annoCount = await env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM annotations WHERE chapter_id = ? AND status != 'removed'"
    ).bind(params.id).first();
    if (annoCount && annoCount.cnt > 0) {
      warning = `该章节有 ${annoCount.cnt} 条批注，修改内容可能导致批注定位失效`;
    }
  }

  // 返回新version供前端下次编辑使用
  const newChapter = await env.DB.prepare('SELECT version FROM chapters WHERE id = ?').bind(params.id).first();
  return Response.json({ success: true, version: newChapter?.version || 0, ...(warning ? { warning } : {}) });
}

export async function onRequestDelete(context) {
  const { request, env, params } = context;
  const { denied, auth } = await authCheck(request, env);
  if (denied) return denied;
  if (!validateId(params.id)) return Response.json({ error: 'Invalid chapter ID' }, { status: 400 });

  const chapter = await env.DB.prepare('SELECT * FROM chapters WHERE id = ?').bind(params.id).first();
  if (!chapter) return Response.json({ error: 'Chapter not found' }, { status: 404 });

  // demo只能删除自己书的章节
  if (!await checkBookOwnership(auth, env, chapter.book_id)) {
    return Response.json({ error: '只能删除自己书籍的章节' }, { status: 403 });
  }

  // 使用批量操作确保数据一致性
  // 注意：D1不支持传统事务，但支持batch操作
  try {
    // 先删除关联数据，再删除章节本身
    // 使用batch确保原子性
    const deleteStatements = [
      env.DB.prepare('DELETE FROM chapter_stats WHERE chapter_id = ?').bind(params.id),
      env.DB.prepare('DELETE FROM annotation_likes WHERE annotation_id IN (SELECT id FROM annotations WHERE chapter_id = ?)').bind(params.id),
      env.DB.prepare('DELETE FROM reports WHERE annotation_id IN (SELECT id FROM annotations WHERE chapter_id = ?)').bind(params.id),
      env.DB.prepare('DELETE FROM votes WHERE annotation_id IN (SELECT id FROM annotations WHERE chapter_id = ?)').bind(params.id),
      env.DB.prepare('DELETE FROM annotations WHERE chapter_id = ?').bind(params.id),
      env.DB.prepare('DELETE FROM chapters WHERE id = ?').bind(params.id),
      env.DB.prepare("UPDATE books SET updated_at = datetime('now') WHERE id = ?").bind(chapter.book_id)
    ];
    
    // 执行批量操作
    const batchResult = await env.DB.batch(deleteStatements);
    
    // 检查章节是否成功删除
    const chapterDeleteResult = batchResult[5];
    if (chapterDeleteResult.meta.changes === 0) {
      console.error('Chapter deletion failed: no rows affected');
      return Response.json({ error: '删除章节失败' }, { status: 500 });
    }
    
    // 删除R2中的内容（在数据库操作成功后执行）
    await env.R2.delete(chapter.content_key).catch((e) => {
      console.error('Failed to delete R2 content:', e);
      // R2删除失败不影响整体操作，但记录日志
    });
    
    return Response.json({ success: true });
  } catch (e) {
    console.error('Chapter deletion error:', e);
    return Response.json({ error: '删除章节失败: ' + e.message }, { status: 500 });
  }
}
