-- Adjust Project semantics for knowledge management
ALTER TABLE "Project"
  ALTER COLUMN "weeklyFocus" TYPE BOOLEAN USING (
    CASE
      WHEN "weeklyFocus" IS NULL THEN false
      WHEN lower("weeklyFocus") IN ('true','1','yes','y','да') THEN true
      ELSE false
    END
  ),
  ALTER COLUMN "weeklyFocus" SET DEFAULT false,
  ALTER COLUMN "weeklyFocus" SET NOT NULL;

ALTER TABLE "Project"
  ALTER COLUMN "revenueGoal" TYPE DOUBLE PRECISION USING "revenueGoal"::double precision;

DROP INDEX IF EXISTS "Project_userId_idx";
CREATE INDEX IF NOT EXISTS "Project_userId_weeklyFocus_idx" ON "Project"("userId", "weeklyFocus");
CREATE INDEX IF NOT EXISTS "Project_userId_status_idx" ON "Project"("userId", "status");

DROP INDEX IF EXISTS "ProjectNote_userId_projectId_idx";
CREATE INDEX IF NOT EXISTS "ProjectNote_projectId_createdAt_idx" ON "ProjectNote"("projectId", "createdAt");
