-- Migration 003: 章节乐观锁版本号
-- 执行: wrangler d1 execute novel-db --file migrations/003_chapter_version.sql --remote

-- 章节版本号（乐观锁，防并发编辑覆盖）
ALTER TABLE chapters ADD COLUMN version INTEGER DEFAULT 0;
