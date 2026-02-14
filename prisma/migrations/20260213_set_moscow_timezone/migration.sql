-- Set default timezone to Europe/Moscow and normalize existing users
ALTER TABLE "User"
  ALTER COLUMN "timezone" SET DEFAULT 'Europe/Moscow';

UPDATE "User"
SET "timezone" = 'Europe/Moscow'
WHERE "timezone" IS NULL OR "timezone" <> 'Europe/Moscow';
