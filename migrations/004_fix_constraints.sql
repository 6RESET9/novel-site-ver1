-- Migration 004: 修复数据库约束问题
-- 执行: wrangler d1 execute novel-db --file migrations/004_fix_constraints.sql --remote
-- 
-- 修复内容:
-- 1. chapters 表外键添加 ON DELETE CASCADE（需重建表）
-- 2. admin_users.github_id 添加唯一约束
-- 3. admin_sessions.user_id 添加索引
-- 4. admin_users.github_id 添加索引

-- ========== 1. chapters 表外键级联删除 ==========
-- SQLite 不支持直接修改外键约束，需要重建表

-- 创建临时表保存数据
CREATE TABLE IF NOT EXISTS chapters_backup AS SELECT * FROM chapters;

-- 删除原表（会自动删除相关索引）
DROP TABLE IF EXISTS chapters;

-- 重新创建 chapters 表，添加 ON DELETE CASCADE
CREATE TABLE chapters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  word_count INTEGER DEFAULT 0,
  content_key TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  version INTEGER DEFAULT 0,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);

-- 恢复数据
INSERT INTO chapters (id, book_id, title, sort_order, word_count, content_key, created_at, updated_at, version)
SELECT id, book_id, title, sort_order, word_count, content_key, created_at, updated_at, version
FROM chapters_backup;

-- 删除备份表
DROP TABLE chapters_backup;

-- 重建索引
CREATE INDEX IF NOT EXISTS idx_chapters_book_id ON chapters(book_id);
CREATE INDEX IF NOT EXISTS idx_chapters_sort_order ON chapters(book_id, sort_order);

-- ========== 2. admin_users.github_id 唯一约束 ==========
-- 使用部分索引（WHERE github_id IS NOT NULL）允许多个 NULL 值
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_users_github_id_unique 
ON admin_users(github_id) WHERE github_id IS NOT NULL;

-- ========== 3. 添加缺失的索引 ==========

-- admin_sessions.user_id 索引（加速按用户查询会话）
CREATE INDEX IF NOT EXISTS idx_admin_sessions_user_id 
ON admin_sessions(user_id);

-- admin_users.github_id 索引（加速 GitHub OAuth 登录查询）
CREATE INDEX IF NOT EXISTS idx_admin_users_github_id 
ON admin_users(github_id);

-- ========== 4. 重建 chapter_stats 外键（如果需要）==========
-- chapter_stats 表的外键已经正确设置了 ON DELETE CASCADE
-- 无需修改