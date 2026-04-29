# 后端API逻辑审查报告

**审查日期**: 2026-03-22  
**审查范围**: `functions/` 目录下所有文件  
**审查重点**: 安全问题、逻辑Bug、API设计问题、性能问题

---

## 问题汇总

| 严重程度 | 数量 |
|---------|------|
| 🔴 严重 | 3 |
| 🟡 中等 | 12 |
| 🟢 轻微 | 8 |

---

## 🔴 严重问题

### 1. SQL注入风险 - 动态ORDER BY子句

**文件**: [`functions/api/annotations.js`](../functions/api/annotations.js:129)

**位置**: 第129行

**问题描述**: `orderBy` 变量直接拼接到SQL语句中，虽然来源是内部变量，但这种模式存在安全隐患。

```javascript
const orderBy = sort === 'hot' ? 'like_count DESC, a.created_at DESC' : 'a.created_at DESC';
// ...
ORDER BY ${orderBy}
```

**风险**: 如果未来代码修改导致 `sort` 参数来源变化，可能引入SQL注入。

**修复建议**: 使用白名单验证排序字段：
```javascript
const VALID_SORT = {
  'hot': 'like_count DESC, a.created_at DESC',
  'latest': 'a.created_at DESC'
};
const orderBy = VALID_SORT[sort] || 'a.created_at DESC';
```

---

### 2. SQL注入风险 - 动态SET子句

**文件**: [`functions/api/admin/users.js`](../functions/api/admin/users.js:133)

**位置**: 第126-134行

**问题描述**: 动态构建UPDATE语句时，字段名直接拼接到SQL中。

```javascript
const sets = [];
if (hasRole) { sets.push('role = ?'); binds.push(body.role); }
if (hasPwdLock) { sets.push('password_locked = ?'); binds.push(body.password_locked === 1 ? 1 : 0); }
sets.push("updated_at = datetime('now')");
binds.push(body.id);

await env.DB.prepare(`UPDATE admin_users SET ${sets.join(', ')} WHERE id = ?`)
  .bind(...binds).run();
```

**风险**: 虽然当前字段名是硬编码的，但这种模式容易被复制到其他地方导致漏洞。

**修复建议**: 确保所有动态字段名都来自预定义白名单，或使用静态SQL分支。

---

### 3. SQL注入风险 - 动态WHERE子句

**文件**: [`functions/api/admin/annotations.js`](../functions/api/admin/annotations.js:67)

**位置**: 第42-101行

**问题描述**: 多处动态构建SQL语句，`where` 数组直接拼接到SQL中。

```javascript
const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';
// ...
const listSql = `... ${whereClause} ORDER BY ${orderBy} ...`;
```

**风险**: 如果 `where` 数组中混入未过滤的用户输入，可能导致SQL注入。

**修复建议**: 确保所有添加到 `where` 数组的条件都经过严格验证，使用参数化查询。

---

## 🟡 中等问题

### 4. 潜在的竞态条件 - 批注点赞

**文件**: [`functions/api/annotations/[id]/like.js`](../functions/api/annotations/[id]/like.js:40-52)

**位置**: 第40-52行

**问题描述**: 点赞/取消点赞操作没有使用事务，存在竞态条件。

```javascript
if (existing) {
  // 取消点赞
  await env.DB.prepare('DELETE FROM annotation_likes ...').run();
  return Response.json({ liked: false });
} else {
  // 点赞
  await env.DB.prepare('INSERT INTO annotation_likes ...').run();
  return Response.json({ liked: true });
}
```

**风险**: 并发请求可能导致重复点赞或数据不一致。

**修复建议**: 使用 `INSERT OR IGNORE` 配合 `DELETE` 的原子操作，或使用事务。

---

### 5. 缺少输入验证 - 搜索功能

**文件**: [`functions/api/search.js`](../functions/api/search.js:38-39)

**位置**: 第38-39行

**问题描述**: 搜索查询仅做了长度限制，未对特殊字符进行转义。

```javascript
const query = q.slice(0, 50);
const like = `%${query}%`;
```

**风险**: LIKE查询中的 `%` 和 `_` 是通配符，用户可利用它们绕过搜索限制或进行DoS攻击。

**修复建议**: 转义LIKE通配符：
```javascript
const escaped = query.replace(/[%_]/g, '\\$&');
const like = `%${escaped}%`;
```

---

### 6. 内存泄漏风险 - 速率限制Map

**文件**: [`functions/api/search.js`](../functions/api/search.js:3-28)

**位置**: 第3-28行

**问题描述**: 使用模块级Map存储速率限制数据，虽然有清理逻辑，但清理触发条件是Map大小超过1000。

```javascript
const searchRateMap = new Map();
// ...
if (searchRateMap.size > 1000) {
  for (const [k, v] of searchRateMap) {
    if (now - v.start > SEARCH_RATE_WINDOW) searchRateMap.delete(k);
  }
}
```

**风险**: 在高并发场景下，Map可能在清理前增长到很大，且每个Cloudflare Worker isolate独立维护此Map。

**修复建议**: 使用更积极的清理策略，或考虑使用Durable Objects。

---

### 7. 敏感信息泄露 - 错误消息

**文件**: [`functions/api/admin/chapters/[id].js`](../functions/api/admin/chapters/[id].js:68-69)

**位置**: 第68-69行

**问题描述**: 错误消息暴露了内部实现细节。

```javascript
// DB失败，R2已写入新内容但version未更新，下次编辑会覆盖，无需回滚R2
return Response.json({ error: 'Failed to update metadata' }, { status: 500 });
```

**风险**: 虽然消息本身不敏感，但注释中说明了内部状态，可能帮助攻击者理解系统架构。

**修复建议**: 使用通用错误消息，详细错误仅记录到日志。

---

### 8. 缺少速率限制 - 批注创建

**文件**: [`functions/api/annotations.js`](../functions/api/annotations.js:73-80)

**位置**: 第73-80行

**问题描述**: 批注创建有每分钟10条的限制，但没有IP维度的限制。

```javascript
const recentCount = await env.DB.prepare(
  'SELECT COUNT(*) as cnt FROM annotations WHERE user_id = ? AND created_at > ?'
).bind(auth.userId, oneMinAgo).first();
if (recentCount && recentCount.cnt >= 10) {
  return Response.json({ error: '操作过于频繁，请稍后再试' }, { status: 429 });
}
```

**风险**: 攻击者可以创建多个账号绕过用户级别的限制。

**修复建议**: 增加IP维度的速率限制。

---

### 9. 不完整的权限检查 - 举报处理

**文件**: [`functions/api/admin/reports/[id].js`](../functions/api/admin/reports/[id].js:82-87)

**位置**: 第82-87行

**问题描述**: 书籍所有者可以处理自己书籍的举报，但没有检查该所有者是否为demo用户。

```javascript
const isBookOwner = report.book_owner === auth.userId;
const canHandle = auth.role === 'super_admin' || auth.role === 'admin' || isBookOwner;
if (!canHandle) {
  return Response.json({ error: '无权处理此举报' }, { status: 403 });
}
```

**风险**: demo用户如果是书籍所有者，可以处理自己书籍的举报，可能与其权限级别不符。

**修复建议**: 明确demo用户是否可以处理举报，如不允许应增加角色检查。

---

### 10. 缺少事务 - 章节删除

**文件**: [`functions/api/admin/chapters/[id].js`](../functions/api/admin/chapters/[id].js:106-112)

**位置**: 第106-112行

**问题描述**: 章节删除操作分多个独立SQL执行，未使用事务。

```javascript
await env.DB.prepare('DELETE FROM chapter_stats WHERE chapter_id = ?').bind(params.id).run().catch(() => {});
await env.DB.prepare('DELETE FROM votes WHERE annotation_id IN (SELECT id FROM annotations WHERE chapter_id = ?)').bind(params.id).run().catch(() => {});
// ... 更多删除操作
await env.DB.prepare('DELETE FROM chapters WHERE id = ?').bind(params.id).run();
await env.R2.delete(chapter.content_key).catch(() => {});
```

**风险**: 如果中途失败，可能导致数据不一致。

**修复建议**: 使用 `env.DB.batch()` 将删除操作包装为原子事务。

---

### 11. 状态码使用不一致

**文件**: [`functions/api/auth.js`](../functions/api/auth.js:24-28)

**位置**: 第24-28行

**问题描述**: 登录失败时，不同原因返回不同的状态码，但错误消息可能暴露系统信息。

```javascript
const status = result.reason === 'locked' ? 429 : 401;
const msg = result.reason === 'locked' ? '登录失败次数过多，请10分钟后再试'
  : result.reason === 'github_only' ? '该账号请使用 GitHub 登录'
  : '用户名或密码错误';
```

**风险**: `github_only` 错误消息暴露了账号存在且使用GitHub登录，可能帮助攻击者枚举用户。

**修复建议**: 对于安全相关的错误，使用更通用的错误消息。

---

### 12. 缺少Content-Type验证 - 封面上传

**文件**: [`functions/api/admin/covers.js`](../functions/api/admin/covers.js:26-37)

**位置**: 第26-37行

**问题描述**: 虽然验证了Content-Type和文件头魔数，但未验证文件的实际内容。

```javascript
const ct = file.type || '';
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
if (!ALLOWED_TYPES.includes(ct)) return Response.json({ error: '仅支持 JPEG、PNG、WebP 格式' }, { status: 400 });

// 验证文件头魔数
const headerBuf = await file.slice(0, 16).arrayBuffer();
// ...
```

**风险**: 攻击者可能构造恶意文件，通过魔数检测但包含恶意内容。

**修复建议**: 考虑使用专门的图片处理库验证和重新编码图片。

---

### 13. OAuth state过期时间不一致

**文件**: [`functions/api/auth.js`](../functions/api/auth.js:152) 和 [`functions/api/auth/github/callback.js`](../functions/api/auth/github/callback.js:47)

**位置**: auth.js:152, callback.js:47

**问题描述**: Cookie的Max-Age是600秒（10分钟），但DB中存储的过期时间也是10分钟，两者应保持同步但代码分散。

```javascript
// auth.js
const cookie = `__Host-github_oauth_state=${state}.${signature}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`;

// callback.js
if (new Date(stateRow.value) < new Date()) {
  return new Response('State expired', { status: 403 });
}
```

**风险**: 如果修改其中一处而忘记另一处，可能导致不一致。

**修复建议**: 将过期时间定义为常量，两处引用同一常量。

---

### 14. 缺少请求体大小限制 - JSON解析

**文件**: [`functions/api/_utils.js`](../functions/api/_utils.js:390-392)

**位置**: 第390-392行

**问题描述**: `parseJsonBody` 函数没有大小限制。

```javascript
export async function parseJsonBody(request) {
  try { return await request.json(); } catch { return null; }
}
```

**风险**: 攻击者可以发送超大JSON请求体，消耗服务器内存。

**修复建议**: 在中间件中已有限制，但应在parseJsonBody中增加二次检查或文档说明。

---

### 15. 批量操作缺少原子性

**文件**: [`functions/api/admin/annotations/batch.js`](../functions/api/admin/annotations/batch.js:63-67)

**位置**: 第63-67行

**问题描述**: 批量更新操作使用单条UPDATE语句，但权限过滤子查询可能影响性能。

```javascript
const result = await env.DB.prepare(`
  UPDATE annotations a
  SET status = ?, updated_at = datetime('now')
  WHERE id IN (${placeholders}) ${permFilter}
`).bind(newStatus, ...ids, ...permBinds).run();
```

**风险**: 复杂的子查询可能影响性能，且难以预测受影响的行数。

**修复建议**: 考虑先查询符合条件的ID，再执行更新。

---

## 🟢 轻微问题

### 16. 重复代码 - 认证检查

**文件**: [`functions/api/admin/books/[id].js`](../functions/api/admin/books/[id].js:6-14), [`functions/api/admin/chapters/[id].js`](../functions/api/admin/chapters/[id].js:7-15)

**位置**: 多个文件

**问题描述**: `authCheck` 函数在多个文件中重复定义。

**修复建议**: 将此函数提取到 `_utils.js` 中复用。

---

### 17. 魔法数字 - 配额限制

**文件**: 多个文件

**问题描述**: 配额限制数字分散在代码中，如10本书、200章、500字批注等。

**示例**:
- [`functions/api/admin/books.js:19`](../functions/api/admin/books.js:19): `if (count >= 10)`
- [`functions/api/admin/chapters.js:51`](../functions/api/admin/chapters.js:51): `if (count >= 200)`
- [`functions/api/annotations.js:52`](../functions/api/annotations.js:52): `if (content.length > 500)`

**修复建议**: 将这些限制定义为常量或从配置中读取。

---

### 18. 错误处理不一致

**文件**: 多个文件

**问题描述**: 有些地方使用 `.catch(() => {})` 忽略错误，有些地方记录日志。

**示例**:
- [`functions/api/admin/chapters/[id].js:106`](../functions/api/admin/chapters/[id].js:106): `.catch(() => {})`
- [`functions/api/annotations.js:101`](../functions/api/annotations.js:101): `console.error('创建批注失败:', e);`

**修复建议**: 统一错误处理策略，至少记录所有被忽略的错误。

---

### 19. 缺少API文档

**文件**: 所有API文件

**问题描述**: API端点缺少统一的文档说明，仅依赖代码注释。

**修复建议**: 考虑添加OpenAPI/Swagger文档。

---

### 20. 响应格式不一致

**文件**: 多个文件

**问题描述**: 成功响应有时返回 `{ success: true }`，有时返回 `{ ok: true }`。

**示例**:
- [`functions/api/annotations/[id].js:31`](../functions/api/annotations/[id].js:31): `return Response.json({ ok: true });`
- [`functions/api/admin/books.js:54`](../functions/api/admin/books.js:54): `return Response.json({ success: true, ... });`

**修复建议**: 统一使用 `success: true` 格式。

---

### 21. 缺少请求ID

**文件**: [`functions/_middleware.js`](../functions/_middleware.js:66-72)

**位置**: 第66-72行

**问题描述**: 错误处理中没有生成请求ID，难以追踪问题。

```javascript
} catch (err) {
  console.error('Internal error:', err);
  return Response.json(
    { error: 'Internal Server Error' },
    { status: 500 }
  );
}
```

**修复建议**: 生成唯一请求ID并包含在错误响应和日志中。

---

### 22. 缺少输入trim - 部分接口

**文件**: [`functions/api/admin/tags.js`](../functions/api/admin/tags.js:51)

**位置**: 第51行

**问题描述**: 更新标签时，name字段做了trim，但color字段没有。

```javascript
if (body.name) { sets.push('name = ?'); vals.push(body.name.trim().slice(0, 50)); }
if (body.color) {
  if (!COLOR_RE.test(body.color)) return Response.json({ error: 'Invalid color format' }, { status: 400 });
  sets.push('color = ?'); vals.push(body.color);
}
```

**修复建议**: 对所有字符串输入统一进行trim处理。

---

### 23. 注释语言不一致

**文件**: 多个文件

**问题描述**: 代码注释混用中英文。

**修复建议**: 统一使用一种语言进行注释。

---

## 安全亮点

项目在安全方面有以下良好实践：

1. **密码存储**: 使用PBKDF2 + 随机盐，迭代次数100000次
2. **Token处理**: Token明文存客户端，DB只存哈希值
3. **CSRF防护**: Admin API写操作要求 `application/json` Content-Type
4. **IP限流**: 登录失败5次锁定10分钟
5. **文件上传验证**: 验证文件头魔数，不仅依赖Content-Type
6. **OAuth安全**: State参数使用HMAC签名，一次性消费
7. **XSS防护**: 设置了完整的CSP头
8. **敏感数据**: IP地址存储前进行哈希处理

---

## 建议优先级

1. **立即修复**: 严重问题 #1-#3 (SQL注入风险)
2. **短期修复**: 中等问题 #4-#6, #8, #10
3. **中期改进**: 中等问题 #7, #9, #11-#15
4. **长期优化**: 轻微问题 #16-#23

---

## 总结

该项目后端API整体安全性较好，采用了多种安全措施。主要问题集中在：

1. **SQL拼接**: 多处使用字符串拼接构建SQL，虽然当前输入来源可信，但模式本身存在风险
2. **事务使用**: 部分操作缺少事务保护，可能导致数据不一致
3. **一致性**: 响应格式、错误处理、代码风格存在不一致

建议优先修复SQL注入风险相关的代码模式，然后逐步改进其他问题。