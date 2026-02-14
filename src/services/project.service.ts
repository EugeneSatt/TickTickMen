import {
  ProjectStatus,
  type Prisma,
  type Project,
  type ProjectNote,
  type User,
} from "@prisma/client";
import { prisma } from "../db/prisma";
import { ensureUserByTelegramId } from "./user.service";

const NOTE_LIMIT = 1000;

const clampNote = (text: string): string => text.trim().slice(0, NOTE_LIMIT);

export const upsertUserByTelegramId = async (tgUserId: string): Promise<User> => {
  return ensureUserByTelegramId(tgUserId);
};

export interface CreateProjectDto {
  name: string;
  status?: ProjectStatus;
  vision?: string | null;
  metric?: string | null;
  horizonMonths?: number | null;
  revenueGoal?: number | null;
  riskLevel?: number | null;
  energyScore?: number | null;
}

export interface ProjectResolveResult {
  project: Project | null;
  ambiguous: Array<Pick<Project, "id" | "name" | "status">>;
}

const normalizeOptionalText = (value?: string | null): string | null => {
  if (!value) {
    return null;
  }
  const cleaned = value.trim();
  return cleaned.length ? cleaned : null;
};

export const createProject = async (userId: string, dto: CreateProjectDto): Promise<Project> => {
  return prisma.project.create({
    data: {
      userId,
      name: dto.name.trim(),
      status: dto.status ?? ProjectStatus.IDEA,
      vision: normalizeOptionalText(dto.vision),
      metric: normalizeOptionalText(dto.metric),
      horizonMonths: dto.horizonMonths ?? null,
      revenueGoal: dto.revenueGoal ?? null,
      riskLevel: dto.riskLevel ?? null,
      energyScore: dto.energyScore ?? null,
    },
  });
};

const findAmbiguousProjects = async (userId: string, input: string) => {
  const normalized = input.trim();
  return prisma.project.findMany({
    where: {
      userId,
      name: {
        contains: normalized,
        mode: "insensitive",
      },
    },
    orderBy: [{ weeklyFocus: "desc" }, { updatedAt: "desc" }],
    take: 10,
    select: {
      id: true,
      name: true,
      status: true,
    },
  });
};

export const getProjectByNameOrId = async (
  userId: string,
  input: string
): Promise<ProjectResolveResult> => {
  const raw = input.trim();
  if (!raw) {
    return { project: null, ambiguous: [] };
  }

  const byId = await prisma.project.findFirst({
    where: {
      userId,
      id: raw,
    },
  });
  if (byId) {
    return { project: byId, ambiguous: [] };
  }

  const exactByName = await prisma.project.findMany({
    where: {
      userId,
      name: {
        equals: raw,
        mode: "insensitive",
      },
    },
    take: 2,
  });

  if (exactByName.length === 1) {
    return { project: exactByName[0], ambiguous: [] };
  }

  if (exactByName.length > 1) {
    const ambiguous = exactByName.map((p) => ({ id: p.id, name: p.name, status: p.status }));
    return { project: null, ambiguous };
  }

  const ambiguous = await findAmbiguousProjects(userId, raw);
  return { project: null, ambiguous };
};

export const listProjects = async (userId: string) => {
  return prisma.project.findMany({
    where: { userId },
    orderBy: [{ weeklyFocus: "desc" }, { updatedAt: "desc" }],
  });
};

export const updateProject = async (
  userId: string,
  projectId: string,
  patch: Prisma.ProjectUpdateInput
): Promise<Project> => {
  const updated = await prisma.project.updateMany({
    where: { id: projectId, userId },
    data: patch,
  });
  if (updated.count === 0) {
    throw new Error("Project not found");
  }
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    throw new Error("Project not found");
  }
  return project;
};

export const setWeeklyFocus = async (userId: string, projectId: string): Promise<void> => {
  await prisma.$transaction([
    prisma.project.updateMany({
      where: { userId },
      data: { weeklyFocus: false },
    }),
    prisma.project.updateMany({
      where: { id: projectId, userId },
      data: { weeklyFocus: true },
    }),
  ]);
};

export const addProjectNote = async (
  userId: string,
  projectId: string,
  text: string,
  kind?: string
): Promise<ProjectNote> => {
  return prisma.projectNote.create({
    data: {
      userId,
      projectId,
      text: clampNote(text),
      kind: kind?.trim() || null,
    },
  });
};

export interface WeeklyProjectReviewAnswers {
  progressed: "да" | "нет";
  riskText: string;
  moneyTask: string;
  energyScore: number;
  riskLevel?: number | null;
}

export const weeklyProjectReview = async (
  userId: string,
  projectId: string,
  answers: WeeklyProjectReviewAnswers
): Promise<Project> => {
  const target = await prisma.project.findFirst({
    where: { id: projectId, userId },
    select: { id: true },
  });
  if (!target) {
    throw new Error("Project not found");
  }

  const reviewText = [
    `Продвижение: ${answers.progressed}`,
    `Риск: ${answers.riskText}`,
    `Money-задача: ${answers.moneyTask}`,
    `Мотивация: ${answers.energyScore}/5`,
    answers.riskLevel ? `Оценка риска: ${answers.riskLevel}/5` : null,
  ]
    .filter(Boolean)
    .join(" | ");

  await prisma.project.updateMany({
    where: { id: projectId, userId },
    data: {
      energyScore: answers.energyScore,
      riskLevel: answers.riskLevel ?? undefined,
      updatedAt: new Date(),
    },
  });
  const updated = await prisma.project.findUnique({ where: { id: projectId } });
  if (!updated) {
    throw new Error("Project not found");
  }

  await addProjectNote(userId, projectId, reviewText, "REVIEW");
  return updated;
};

export const getProjectWithRecentNotes = async (userId: string, projectId: string) => {
  return prisma.project.findFirst({
    where: { id: projectId, userId },
    include: {
      notes: {
        orderBy: { createdAt: "desc" },
        take: 5,
      },
    },
  });
};

export const linkTaskToProject = async (
  userId: string,
  taskIdOrTitle: string,
  projectId: string
): Promise<number> => {
  const raw = taskIdOrTitle.trim();
  const byId = await prisma.task.updateMany({
    where: {
      userId,
      id: raw,
    },
    data: {
      projectId,
    },
  });

  if (byId.count > 0) {
    return byId.count;
  }

  const byTitle = await prisma.task.updateMany({
    where: {
      userId,
      title: {
        contains: raw,
        mode: "insensitive",
      },
    },
    data: {
      projectId,
    },
  });

  return byTitle.count;
};
