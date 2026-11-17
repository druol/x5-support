export type Role = "user" | "admin";
export type Topic = "access" | "service" | "other";
export type Status = "new" | "in_progress" | "done";
export const topics: Record<Topic, string> = {
  access: "Проблема с доступом", service: "Ошибка в работе сервиса", other: "Другое",
};
export const statuses: Record<Status, string> = { new: "Новое", in_progress: "В работе", done: "Выполнено" };
export const authors: Record<Role, string> = { user: "Пользователь", admin: "Администратор" };
export interface Ticket {
  id: number; topic: Topic; title: string; description: string; status: Status;
  created_at: string; updated_at: string;
}
export interface HistoryEntry {
  id: number; kind: "created" | "comment" | "status"; actor: Role;
  from_status: Status | ""; to_status: Status | ""; comment: string; created_at: string;
}
export interface TicketDetail extends Ticket { history: HistoryEntry[] }
export interface Notification {
  id: number; event_id: number; ticket_id: number; message: string; occurred_at: string; read_at: string | null;
}
export interface Inbox { items: Notification[]; unread: number }
export function formatTime(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
export function nextAction(role: Role, status: Status) {
  if (role === "admin" && status === "new") return { status: "in_progress", label: "Принять в работу", field: "Комментарий (необязательно)", required: false } as const;
  if (role === "admin" && status === "in_progress") return { status: "done", label: "Завершить заявку", field: "Результат работы", required: true } as const;
  if (role === "user" && status === "done") return { status: "in_progress", label: "Вернуть в работу", field: "Причина возврата", required: true } as const;
  return null;
}
