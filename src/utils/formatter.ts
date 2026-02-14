import type { TickTickTask } from "../types/task.types";

const formatDate = (date?: string): string | null => {
  if (!date) {
    return null;
  }

  const parsedDate = new Date(date);

  if (Number.isNaN(parsedDate.getTime())) {
    return date;
  }

  return parsedDate.toLocaleString("ru-RU", {
    year: "numeric",
    month: "2-digit",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const pluralizeTasksRu = (count: number): string => {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) {
    return "таск";
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
    return "таска";
  }
  return "тасков";
};

const groupByProject = (tasks: TickTickTask[]): Map<string, TickTickTask[]> => {
  const groups = new Map<string, TickTickTask[]>();
  for (const task of tasks) {
    const projectName = task.projectName?.trim() || "Без папки";
    const group = groups.get(projectName) ?? [];
    group.push(task);
    groups.set(projectName, group);
  }
  return groups;
};

export const formatTasksByProjectMessages = (tasks: TickTickTask[]): string[] => {
  if (tasks.length === 0) {
    return ["No active tasks 🎉"];
  }

  const grouped = groupByProject(tasks);
  const messages: string[] = [];

  for (const [projectName, projectTasks] of grouped) {
    const lines = projectTasks.map((task) => {
      const created = formatDate(task.createdDate);
      return created
        ? `- ${task.title} (создана: ${created})`
        : `- ${task.title} (создана: неизвестно)`;
    });

    const header = `${projectName}(${projectTasks.length} ${pluralizeTasksRu(projectTasks.length)}):`;
    messages.push([header, "", ...lines].join("\n"));
  }

  return messages;
};

export const formatTasksMessage = (tasks: TickTickTask[]): string => {
  const messages = formatTasksByProjectMessages(tasks);
  return messages.join("\n\n");
};
