-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('IDEA', 'ACTIVE', 'PRE_LAUNCH', 'PAUSED', 'DONE');

-- CreateEnum
CREATE TYPE "TaskSource" AS ENUM ('TICKTICK', 'TELEGRAM', 'MANUAL', 'REMINDERS');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'DONE', 'DELETED');

-- CreateEnum
CREATE TYPE "TaskCategory" AS ENUM ('GROWTH', 'MONEY', 'SYSTEM', 'LIFE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "MoodLevel" AS ENUM ('M2', 'M1', 'Z0', 'P1', 'P2');

-- CreateEnum
CREATE TYPE "ReasonCode" AS ENUM ('NO_CLARITY', 'BIG_TASK', 'FEAR_CONSEQUENCES', 'SLEEP', 'FATIGUE', 'SOCIAL_ANXIETY', 'CONTEXT_SWITCH', 'OVERLOAD', 'OTHER');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "tgUserId" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Amsterdam',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ProjectStatus" NOT NULL DEFAULT 'IDEA',
    "vision" TEXT,
    "metric" TEXT,
    "horizonMonths" INTEGER,
    "revenueGoal" INTEGER,
    "riskLevel" INTEGER,
    "energyScore" INTEGER,
    "weeklyFocus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectNote" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "kind" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "externalId" TEXT,
    "source" "TaskSource" NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "projectName" TEXT,
    "tags" TEXT[],
    "category" "TaskCategory" NOT NULL DEFAULT 'UNKNOWN',
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "projectId" TEXT,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fromStatus" "TaskStatus",
    "toStatus" "TaskStatus",
    "fromDueAt" TIMESTAMP(3),
    "toDueAt" TIMESTAMP(3),
    "meta" JSONB,

    CONSTRAINT "TaskEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyCheckIn" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "isMorning" BOOLEAN NOT NULL,
    "energy" INTEGER NOT NULL,
    "focus" INTEGER NOT NULL,
    "mood" "MoodLevel" NOT NULL,
    "reasonCode" "ReasonCode",
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyCheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyFeatures" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "tasksAdded" INTEGER NOT NULL DEFAULT 0,
    "tasksDone" INTEGER NOT NULL DEFAULT 0,
    "tasksOpen" INTEGER NOT NULL DEFAULT 0,
    "overdueOpen" INTEGER NOT NULL DEFAULT 0,
    "doneGrowth" INTEGER NOT NULL DEFAULT 0,
    "doneMoney" INTEGER NOT NULL DEFAULT 0,
    "doneSystem" INTEGER NOT NULL DEFAULT 0,
    "doneLife" INTEGER NOT NULL DEFAULT 0,
    "shareGrowth" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "shareMoney" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "shareSystem" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "shareLife" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "closureRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgTaskAgeDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgDoneTimeDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "morningEnergy" INTEGER,
    "morningFocus" INTEGER,
    "morningMoodInt" INTEGER,
    "eveningEnergy" INTEGER,
    "eveningMoodInt" INTEGER,
    "burnoutFlag" BOOLEAN NOT NULL DEFAULT false,
    "frictionFlag" BOOLEAN NOT NULL DEFAULT false,
    "notes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyFeatures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Summary" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Summary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_tgUserId_key" ON "User"("tgUserId");

-- CreateIndex
CREATE INDEX "Project_userId_idx" ON "Project"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_userId_name_key" ON "Project"("userId", "name");

-- CreateIndex
CREATE INDEX "ProjectNote_userId_projectId_idx" ON "ProjectNote"("userId", "projectId");

-- CreateIndex
CREATE INDEX "Task_userId_status_idx" ON "Task"("userId", "status");

-- CreateIndex
CREATE INDEX "Task_projectId_idx" ON "Task"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Task_userId_source_externalId_key" ON "Task"("userId", "source", "externalId");

-- CreateIndex
CREATE INDEX "TaskEvent_userId_at_idx" ON "TaskEvent"("userId", "at");

-- CreateIndex
CREATE INDEX "TaskEvent_taskId_at_idx" ON "TaskEvent"("taskId", "at");

-- CreateIndex
CREATE INDEX "DailyCheckIn_userId_day_idx" ON "DailyCheckIn"("userId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "DailyCheckIn_userId_day_isMorning_key" ON "DailyCheckIn"("userId", "day", "isMorning");

-- CreateIndex
CREATE INDEX "DailyFeatures_userId_day_idx" ON "DailyFeatures"("userId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "DailyFeatures_userId_day_key" ON "DailyFeatures"("userId", "day");

-- CreateIndex
CREATE INDEX "Summary_userId_period_day_idx" ON "Summary"("userId", "period", "day");

-- CreateIndex
CREATE UNIQUE INDEX "UserRule_key_key" ON "UserRule"("key");

-- CreateIndex
CREATE INDEX "UserRule_userId_isActive_idx" ON "UserRule"("userId", "isActive");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectNote" ADD CONSTRAINT "ProjectNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectNote" ADD CONSTRAINT "ProjectNote_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskEvent" ADD CONSTRAINT "TaskEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskEvent" ADD CONSTRAINT "TaskEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyCheckIn" ADD CONSTRAINT "DailyCheckIn_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyFeatures" ADD CONSTRAINT "DailyFeatures_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Summary" ADD CONSTRAINT "Summary_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRule" ADD CONSTRAINT "UserRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
