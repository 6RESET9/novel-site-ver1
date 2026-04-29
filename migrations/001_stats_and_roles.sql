-- Migration 001: 访问统计 + 多管理员角色
-- 执行方式: wrangler d1 execute novel-db --file migrations/001_stats_and_roles.sql --remote

-- ========== 访问统计 ==========

-- 站点日访问统计（PV/UV）
CREATE TABLE IF NOT EXISTS site_visits (
  date TEXT PRIMARY KEY,           -- '2026-02-23'
  pv INTEGER DEFAULT 0,            -- 页面浏览量
  uv INTEGER DEFAULT 0             -- 独立访客数（基于IP哈希去重）
);

-- UV去重辅助表（每天的IP哈希集合，次日可清理）
CREATE TABLE IF NOT EXISTS daily_visitors (
  date TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  PRIMARY KEY (date, ip_hash)
);

-- 书籍日阅读统计
CREATE TABLE IF NOT EXISTS book_stats (
  book_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  views INTEGER DEFAULT 0,
  PRIMARY KEY (book_id, date),
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);

-- 章节累计阅读量（不按天拆分，只记总数）
-- 直接在chapters表加字段更简单，但为了不改现有表结构，单独建表
CREATE TABLE IF NOT EXISTS chapter_stats (
  chapter_id INTEGER PRIMARY KEY,
  views INTEGER DEFAULT 0,
  FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
);

-- 索引：按日期查站点统计
CREATE INDEX IF NOT EXISTS idx_site_visits_date ON site_visits(date);
-- 索引：按书籍查阅读趋势
CREATE INDEX IF NOT EXISTS idx_book_stats_book_date ON book_stats(book_id, date);
-- 索引：清理过期UV数据
CREATE INDEX IF NOT EXISTS idx_daily_visitors_date ON daily_visitors(date);

-- ========== 多管理员角色 ==========

-- 给admin_users表加role字段
-- SQLite不支持IF NOT EXISTS for ALTER TABLE，用try-catch方式
-- 如果字段已存在会报错，忽略即可
ALTER TABLE admin_users ADD COLUMN role TEXT DEFAULT 'editor';

-- 把现有的第一个管理员升级为super_admin
UPDATE admin_users SET role = 'super_admin' WHERE id = (SELECT MIN(id) FROM admin_users);
