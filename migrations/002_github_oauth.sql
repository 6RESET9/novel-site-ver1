-- Migration 002: GitHub OAuth 支持
-- 执行: wrangler d1 execute novel-db --file migrations/002_github_oauth.sql --remote

-- GitHub 用户ID（唯一标识，永不变）
ALTER TABLE admin_users ADD COLUMN github_id INTEGER DEFAULT NULL;

-- GitHub 用户名（显示用，每次登录更新）
ALTER TABLE admin_users ADD COLUMN github_login TEXT DEFAULT NULL;

-- GitHub 头像URL
ALTER TABLE admin_users ADD COLUMN avatar_url TEXT DEFAULT NULL;
