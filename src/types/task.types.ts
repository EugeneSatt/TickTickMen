export interface TickTickTask {
  id: string;
  title: string;
  projectId?: string;
  projectName?: string;
  createdDate?: string;
  dueDate?: string;
  priority?: number;
  status?: number;
}

export interface TickTickApiTask {
  id?: string;
  title?: string;
  projectId?: string;
  dueDate?: string;
  priority?: number;
  status?: number;
}
