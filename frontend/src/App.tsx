import { useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowLeft,
  ArrowUpRight,
  Bell,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Clock3,
  CircleHelp,
  ClipboardList,
  Headphones,
  Inbox as InboxIcon,
  MessageSquare,
  Moon,
  PanelLeft,
  PanelLeftClose,
  Plus,
  SearchX,
  Sun,
  Ticket as TicketIcon,
  X,
} from "lucide-react";

import { Alert } from "@/components/arc/alert/alert";
import { Skeleton } from "@/components/arc/skeleton/skeleton";
import { Badge } from "@/components/arc/badge/badge";
import { Button } from "@/components/arc/button/button";
import { EmptyState } from "@/components/arc/empty-state/empty-state";
import { ExpandingSearch } from "@/components/arc/expanding-search/expanding-search";
import { Input } from "@/components/arc/input/input";
import { SearchField } from "@/components/arc/search-field/search-field";
import { SortableDataTable } from "@/components/arc/sortable-data-table/sortable-data-table";
import type { DataColumn } from "@/components/arc/sortable-data-table/sortable-data-table";
import SegmentedControl from "@/components/arc/segmented-control/segmented-control";
import { Select } from "@/components/ui/select/select";

type Theme = "light" | "dark";

import { request, useResource } from "./api";
import { Link, navigate, usePath, useSearch } from "./navigation";
import { authors, formatTime, nextAction, statuses, topics } from "./tickets";
import type { Inbox, Notification, Role, Status, Ticket, TicketDetail } from "./tickets";
import shell from "./app.module.css";
import styles from "./tickets.module.css";

/* ------------------------------------------------------------------ утилиты */

function useAppliedTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    const current = document.documentElement.dataset.theme;
    return current === "dark" ? "dark" : "light";
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("orbita-theme", theme);
    } catch {
      /* приватный режим: тема останется только в этом сеансе */
    }
  }, [theme]);

  // Простое переключение без view-transition и анимации иконки: убирает артефакты
  // с blur/filter в Safari/Chrome при морфозе солнца и луны.
  function applyTheme(next: Theme) {
    setTheme(next);
  }

  return { theme, applyTheme };
}

const statusOptions = [
  { value: "all", label: "Все" },
  { value: "new", label: "Новые" },
  { value: "in_progress", label: "В работе" },
  { value: "done", label: "Выполнено" },
];

function StatusBadge({ status }: { status: Status }) {
  return (
    <Badge tone={status === "done" ? "success" : status === "in_progress" ? "warning" : "info"} dot pill>
      {statuses[status]}
    </Badge>
  );
}

function Failure({ message, retry }: { message?: string; retry?: () => void }) {
  if (!message) return null;
  return (
    <Alert tone="danger" title={message} role="alert">
      {retry && (
        <Button variant="ghost" size="sm" onClick={retry}>
          Повторить
        </Button>
      )}
    </Alert>
  );
}

function Loading() {
  return (
    <div className={styles.loading} role="status">
      Загружаем заявки…
    </div>
  );
}

/* -------------------------------------------------------------- уведомления */

type NotificationFilter = "all" | "unread" | "comment" | "status";

function eventsLabel(count: number) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} событие`;
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return `${count} события`;
  return `${count} событий`;
}

function groupNotifications(items: Notification[]) {
  const byTicket = new Map<number, Notification[]>();
  for (const item of items) {
    const bucket = byTicket.get(item.ticket_id);
    if (bucket) bucket.push(item);
    else byTicket.set(item.ticket_id, [item]);
  }
  return [...byTicket.entries()]
    .map(([ticket, list]) => ({
      ticket,
      items: list.slice().sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime()),
      latest: Math.max(...list.map(item => new Date(item.occurred_at).getTime())),
    }))
    .sort((a, b) => b.latest - a.latest);
}

function notificationKind(message: string): "comment" | "status" {
  if (message.startsWith("Администратор добавил комментарий")) return "comment";
  return "status";
}

function Notifications() {
  const { data, error, reload } = useResource<Inbox>("/notifications", 2000);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<number | null>(null);
  const [readError, setReadError] = useState("");
  const [filter, setFilter] = useState<NotificationFilter>("all");

  const items = data?.items ?? [];
  const counts = {
    all: items.length,
    unread: items.filter(item => !item.read_at).length,
    comment: items.filter(item => notificationKind(item.message) === "comment").length,
    status: items.filter(item => notificationKind(item.message) === "status").length,
  };
  const visible = items.filter(item => {
    if (filter === "unread") return !item.read_at;
    if (filter === "comment") return notificationKind(item.message) === "comment";
    if (filter === "status") return notificationKind(item.message) === "status";
    return true;
  });
  // Сначала отдельно непрочитанные, затем прочитанные; внутри каждой части — группы по заявке.
  const unreadItems = visible.filter(item => !item.read_at);
  const readItems = visible.filter(item => item.read_at);
  const sections = [
    { key: "unread", title: "Непрочитанные", groups: groupNotifications(unreadItems), count: unreadItems.length },
    { key: "read", title: "Прочитанные", groups: groupNotifications(readItems), count: readItems.length },
  ].filter(section => section.count > 0);

  const read = async (item: Notification) => {
    if (pending !== null) return;
    setPending(item.id);
    setReadError("");
    try {
      await request(`/notifications/${item.id}/read`, {});
      reload();
      setOpen(false);
      navigate(`/user/tickets/${item.ticket_id}`);
    } catch (error) {
      setReadError((error as Error).message);
    } finally {
      setPending(null);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button
          variant="secondary"
          size="sm"
          className={styles.bellButton}
          aria-label={`Уведомления: ${data?.unread ?? 0} непрочитанных`}
        >
          <Bell size={17} />
          <span className={styles.bellCount} aria-live="polite">
            {data?.unread ?? 0}
          </span>
          {error && <span className={styles.offlineDot} title="Обновление уведомлений недоступно" />}
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.inbox}>
          <div className={styles.panelHead}>
            <div>
              <Dialog.Title>Уведомления</Dialog.Title>
              <Dialog.Description>{data?.unread ?? 0} непрочитанных · новые сверху</Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="sm" aria-label="Закрыть уведомления">
                <X size={18} />
              </Button>
            </Dialog.Close>
          </div>
          <div className={styles.inboxFilters} role="tablist" aria-label="Фильтр уведомлений">
            {([
              { value: "all", label: "Все", count: counts.all },
              { value: "unread", label: "Новые", count: counts.unread },
              { value: "status", label: "Статусы", count: counts.status },
              { value: "comment", label: "Комментарии", count: counts.comment },
            ] as const).map(option => (
              <button
                key={option.value}
                type="button"
                role="tab"
                aria-selected={filter === option.value}
                className={`${styles.inboxFilter} ${filter === option.value ? styles.inboxFilterActive : ""}`}
                onClick={() => setFilter(option.value)}
              >
                {option.label}
                <span>{option.count}</span>
              </button>
            ))}
          </div>
          <div className={styles.inboxBody}>
            <Failure
              message={error ? "Уведомления временно недоступны. Мы автоматически повторим загрузку." : readError}
              retry={reload}
            />
            {!data && !error && <p className={styles.muted}>Загружаем уведомления…</p>}
            {data && visible.length === 0 && (
              <EmptyState
                icon={<Bell size={20} />}
                title={filter === "all" ? "Пока без новостей" : "Здесь пусто"}
                description={
                  filter === "all"
                    ? "Здесь появятся ответы администратора и изменения статуса ваших заявок."
                    : filter === "unread"
                      ? "Все уведомления прочитаны."
                      : filter === "comment"
                        ? "Комментариев администратора пока не было."
                        : "Изменений статуса пока не было."
                }
              />
            )}
            {sections.map(section => (
              <section className={styles.inboxSection} key={section.key} aria-label={section.title}>
                <div className={styles.inboxSectionHead}>
                  <span>{section.title}</span>
                  <span>{section.count}</span>
                </div>
                {section.groups.map(group => (
                  <div className={styles.notificationGroup} key={group.ticket}>
                    <div className={styles.groupHead}>
                      <span className={styles.groupTitle}>Заявка №{group.ticket}</span>
                      <span className={styles.groupCount}>{eventsLabel(group.items.length)}</span>
                    </div>
                    <div className={styles.groupItems}>
                      {group.items.map(item => (
                        <button
                          type="button"
                          key={item.id}
                          disabled={pending !== null}
                          className={`${styles.notification} ${!item.read_at ? styles.notificationUnread : ""}`}
                          onClick={() => void read(item)}
                        >
                          <span className={styles.notificationMessage}>{item.message}</span>
                          <span className={styles.notificationMeta}>
                            <span className={styles.notificationKind}>{notificationKind(item.message) === "comment" ? "Комментарий" : "Статус"}</span>
                            <span className={styles.notificationRight}>
                              <time dateTime={item.occurred_at}>{formatTime(item.occurred_at)}</time>
                              {!item.read_at ? <span className={styles.unreadDot} aria-label="Непрочитано" /> : <CheckCheck size={13} aria-label="Прочитано" />}
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </section>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/* ---------------------------------------------------------------- список */

type TicketRow = {
  key: string;
  id: number;
  number: string;
  topic: string;
  title: string;
  statusLabel: string;
  status: Status;
  created: string;
  createdTs: number;
  href: string;
} & Record<string, unknown>;

function ticketColumns(): DataColumn<TicketRow>[] {
  return [
    {
      key: "number",
      label: "№",
      width: 76,
      render: (_, row) => (
        <Link href={row.href} className={styles.muted}>
          №{row.number}
        </Link>
      ),
    },
    { key: "topic", label: "Тема", width: 240, sortable: true },
    {
      key: "title",
      label: "Заголовок",
      sortable: true,
      render: (_, row) => <Link href={row.href}>{row.title}</Link>,
    },
    {
      key: "statusLabel",
      label: "Статус",
      width: 150,
      render: (_, row) => <StatusBadge status={row.status} />,
    },
    {
      key: "createdTs",
      label: "Создана",
      numeric: true,
      width: 190,
      render: (_, row) => <time dateTime={row.created}>{formatTime(row.created)}</time>,
    },
    {
      key: "open",
      label: "",
      width: 54,
      render: (_, row) => (
        <Link href={row.href} aria-label={`Открыть заявку №${row.number}`}>
          <ArrowUpRight size={17} />
        </Link>
      ),
    },
  ];
}

function PageHead({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className={styles.pageHead}>
      <div>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.description}>{description}</p>
      </div>
      {action && <div className={styles.headActions}>{action}</div>}
    </div>
  );
}

function StatStrip({ tickets }: { tickets: Ticket[] }) {
  const stats = [
    { label: "Всего", value: tickets.length, tone: "neutral" as const },
    { label: "Новые", value: tickets.filter(t => t.status === "new").length, tone: "info" as const },
    { label: "В работе", value: tickets.filter(t => t.status === "in_progress").length, tone: "warning" as const },
    { label: "Выполнено", value: tickets.filter(t => t.status === "done").length, tone: "success" as const },
  ];
  return (
    <div className={styles.statStrip} aria-label="Сводка по заявкам">
      {stats.map(stat => (
        <div className={styles.statChip} key={stat.label}>
          <span className={`${styles.statDot} ${styles[`statDot${stat.tone}`]}`} aria-hidden="true" />
          <span className={styles.statLabel}>{stat.label}</span>
          <strong className={styles.statValue}>{stat.value}</strong>
        </div>
      ))}
    </div>
  );
}

/** Админка: плотный ops-интерфейс — таблица, фильтры, сводка. */
function AdminTickets({ tickets, error, reload, initialStatus }: { tickets: Ticket[]; error?: string; reload: () => void; initialStatus: string }) {
  const [statusTab, setStatusTab] = useState(initialStatus);
  const [topic, setTopic] = useState("");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return tickets
      .filter(ticket => statusTab === "all" || ticket.status === statusTab)
      .filter(ticket => !topic || ticket.topic === topic)
      .filter(ticket => !needle || `${ticket.id} ${ticket.title} ${topics[ticket.topic]}`.toLowerCase().includes(needle));
  }, [tickets, statusTab, topic, query]);

  const rows: TicketRow[] = filtered.map(ticket => ({
    key: String(ticket.id),
    id: ticket.id,
    number: String(ticket.id),
    topic: topics[ticket.topic],
    title: ticket.title,
    statusLabel: statuses[ticket.status],
    status: ticket.status,
    created: ticket.created_at,
    createdTs: new Date(ticket.created_at).getTime(),
    href: `/admin/tickets/${ticket.id}`,
  }));

  return (
    <>
      <PageHead
        eyebrow="Администрирование"
        title="Очередь заявок"
        description="Плотный рабочий стол поддержки: фильтры, сортировка и обработка обращений."
        action={
          <Button variant="secondary" size="sm" onClick={reload}>
            Обновить
          </Button>
        }
      />

      <StatStrip tickets={tickets} />

      <section className={styles.panel} aria-label="Очередь обращений">
        <div className={styles.adminToolbar}>
          <SegmentedControl
            className={styles.adminTabs}
            label="Фильтр по статусу"
            options={statusOptions}
            value={statusTab}
            onValueChange={setStatusTab}
          />
          <div className={styles.adminFilters}>
            <Select
              ariaLabel="Тема"
              value={topic}
              onChange={setTopic}
              className={styles.topicSelect}
              options={[{ value: "", label: "Все темы" }, ...Object.entries(topics).map(([key, value]) => ({ value: key, label: value }))]}
            />
            <span className={styles.recordCount}>{filtered.length} заявок</span>
            <div className={styles.searchSlot}>
              <SearchField label="Найти заявку" value={query} onValueChange={setQuery} placeholder="Номер, заголовок" />
            </div>
          </div>
        </div>

        <Failure message={error} retry={reload} />

        {rows.length > 0 ? (
          <div className={styles.tableArea}>
            <SortableDataTable
              rows={rows}
              columns={ticketColumns()}
              rowKey="key"
              caption="Все заявки"
              defaultSort={{ key: "createdTs", direction: "desc" }}
              itemName={{ one: "заявка", other: "заявок" }}
            />
          </div>
        ) : (
          <EmptyState
            icon={<SearchX size={22} />}
            title="Заявок не найдено"
            description="Измените статус, тему или поисковый запрос."
            action={
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setQuery("");
                  setTopic("");
                  setStatusTab("all");
                }}
              >
                Сбросить фильтры
              </Button>
            }
          />
        )}
      </section>
    </>
  );
}

/** Пользователь: карточки обращений, меньше плотности, акцент на создании и статусе. */
function UserTickets({ tickets, error, reload, initialStatus, loading }: { tickets: Ticket[]; error?: string; reload: () => void; initialStatus: string; loading?: boolean }) {
  const [statusTab, setStatusTab] = useState(initialStatus);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return tickets
      .filter(ticket => statusTab === "all" || ticket.status === statusTab)
      .filter(ticket => !needle || `${ticket.id} ${ticket.title} ${topics[ticket.topic]}`.toLowerCase().includes(needle));
  }, [tickets, statusTab, query]);

  return (
    <>
      <PageHead
        eyebrow="Центр поддержки"
        title="Мои заявки"
        description="Создайте обращение и следите за решением. Ответы поддержки приходят в уведомления."
        action={
          <Button onClick={() => navigate("/user/new")}>
            <Plus size={16} />
            Создать заявку
          </Button>
        }
      />

      <div className={styles.userToolbar}>
        <SegmentedControl
          label="Фильтр по статусу"
          options={statusOptions}
          value={statusTab}
          onValueChange={setStatusTab}
        />
        <div className={styles.userSearch}>
          <SearchField label="Найти заявку" value={query} onValueChange={setQuery} placeholder="Номер или заголовок" />
        </div>
      </div>

      <Failure message={error} retry={reload} />

      {loading && tickets.length === 0 ? (
        <div className={styles.cardGrid}>
          <Skeleton lines={4} />
          <Skeleton lines={4} />
          <Skeleton lines={4} />
        </div>
      ) : filtered.length > 0 ? (
        <div className={styles.cardGrid}>
          {filtered.map((ticket, index) => (
            <Link
              key={ticket.id}
              href={`/user/tickets/${ticket.id}`}
              className={styles.ticketCard}
              style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }}
            >
              <div className={styles.ticketCardTop}>
                <span className={styles.ticketCardNum}>№{ticket.id}</span>
                <StatusBadge status={ticket.status} />
              </div>
              <strong className={styles.ticketCardTitle}>{ticket.title}</strong>
              <p className={styles.ticketCardTopic}>{topics[ticket.topic]}</p>
              <div className={styles.ticketCardFoot}>
                <time dateTime={ticket.updated_at}>{formatTime(ticket.updated_at)}</time>
                <span className={styles.ticketCardOpen}>
                  Открыть <ArrowUpRight size={14} />
                </span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={query || statusTab !== "all" ? <SearchX size={22} /> : <TicketIcon size={22} />}
          title={query || statusTab !== "all" ? "Ничего не нашлось" : "Здесь начнётся решение"}
          description={
            query || statusTab !== "all"
              ? "Попробуйте другой номер, заголовок или статус."
              : "Создайте первую заявку. Опишите, что произошло, — поддержка поможет."
          }
          action={
            query || statusTab !== "all" ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setQuery("");
                  setStatusTab("all");
                }}
              >
                Сбросить фильтры
              </Button>
            ) : (
              <Button size="sm" onClick={() => navigate("/user/new")}>
                <Plus size={16} />
                Создать первую заявку
              </Button>
            )
          }
        />
      )}
    </>
  );
}

/* --------------------------------------------------------------- создание */

function CreateTicket() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [topic, setTopic] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title")).trim();
    const description = String(form.get("description")).trim();
    if (!topic || !title || !description) {
      setError("Выберите тему и заполните заголовок с описанием: пробелы не считаются текстом.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const ticket = await request<Ticket>("/user/tickets", { topic, title, description });
      navigate(`/user/tickets/${ticket.id}`);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Link href="/user" className={shell.backLink}>
        <ArrowLeft size={16} />
        Мои заявки
      </Link>
      <PageHead
        eyebrow="Новое обращение"
        title="Чем можем помочь?"
        description="Выберите тему и расскажите о проблеме. Все поля обязательны."
      />
      <div className={styles.detailGrid}>
        <section className={styles.formCard}>
          <h2>Новая заявка</h2>
          <form className={styles.formGrid} onSubmit={event => void submit(event)}>
            <Select
              label="Тема"
              ariaLabel="Тема"
              placeholder="Выберите тему обращения"
              value={topic}
              onChange={setTopic}
              options={Object.entries(topics).map(([key, value]) => ({ value: key, label: value }))}
            />
            <Input label="Заголовок" name="title" placeholder="Коротко опишите проблему" maxLength={200} required />
            <label className={styles.field}>
              Описание
              <textarea
                name="description"
                placeholder="Что произошло? Что вы ожидали? Какие действия уже пробовали?"
                rows={7}
                maxLength={10000}
                required
              />
              <span className={styles.fieldHint}>Чем больше деталей, тем быстрее найдём решение.</span>
            </label>
            <Failure message={error} />
            <div className={styles.formActions}>
              <Button type="submit" loading={busy} disabled={busy}>
                <Plus size={17} />
                Отправить заявку
              </Button>
              <Button type="button" variant="ghost" onClick={() => navigate("/user")}>
                Отмена
              </Button>
            </div>
          </form>
        </section>
        <aside className={styles.tipCard}>
          <CircleHelp size={22} />
          <h2>Детали помогают решить быстрее</h2>
          <p>Укажите название сервиса и шаги, после которых возникла проблема.</p>
          <p>Ответы поддержки и изменения статуса появятся в карточке заявки и в уведомлениях.</p>
        </aside>
      </div>
    </>
  );
}

/* ------------------------------------------------------------ карточка */

function TicketCard({ role, id }: { role: Role; id: string }) {
  const { data: ticket, error, reload } = useResource<TicketDetail>(`/${role}/tickets/${id}`);
  const [busy, setBusy] = useState(false);
  const [mutationError, setMutationError] = useState("");
  const [success, setSuccess] = useState("");

  const mutate = async (event: FormEvent<HTMLFormElement>, target?: Status, required = true) => {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const comment = String(new FormData(form).get("comment") ?? "").trim();
    if (required && !comment) {
      setMutationError("Напишите комментарий: он не может состоять из пробелов.");
      return;
    }
    setBusy(true);
    setMutationError("");
    setSuccess("");
    try {
      await request(`/${role}/tickets/${id}/${target ? "status" : "comments"}`, target ? { status: target, comment } : { comment });
      form.reset();
      reload();
      setSuccess(target ? "Статус заявки обновлён" : "Комментарий добавлен");
    } catch (error) {
      setMutationError((error as Error).message);
      reload();
    } finally {
      setBusy(false);
    }
  };

  const action = ticket ? nextAction(role, ticket.status) : null;

  return (
    <>
      <Link href={`/${role}`} className={shell.backLink}>
        <ArrowLeft size={16} />
        {role === "user" ? "Мои заявки" : "Все заявки"}
      </Link>
      <Failure message={error} retry={reload} />
      {!ticket && !error && <Loading />}
      {ticket && (
        <>
          <PageHead
            eyebrow={`Заявка №${ticket.id} · ${topics[ticket.topic]}`}
            title={ticket.title}
            description={`Создана ${formatTime(ticket.created_at)}`}
            action={<StatusBadge status={ticket.status} />}
          />
          <div className={styles.detailGrid}>
            <div className={styles.stack}>
              <section className={styles.panel}>
                <h2>Описание заявки</h2>
                <p className={styles.bodyText}>{ticket.description}</p>
              </section>

              <section className={styles.panel}>
                <h2>
                  История и комментарии <span className={styles.muted}>{ticket.history.length}</span>
                </h2>
                <ol className={styles.timeline}>
                  {ticket.history.map(entry => (
                    <li key={entry.id} className={styles.timelineItem}>
                      <div className={`${styles.timelineIcon} ${entry.actor === "admin" ? styles.timelineIconAdmin : ""}`}>
                        {entry.kind === "comment" ? (
                          <MessageSquare size={16} />
                        ) : entry.kind === "created" ? (
                          <Plus size={16} />
                        ) : (
                          <Check size={16} />
                        )}
                      </div>
                      <div className={styles.timelineBody}>
                        <div className={styles.entryHead}>
                          <strong>{authors[entry.actor]}</strong>
                          <time dateTime={entry.created_at}>{formatTime(entry.created_at)}</time>
                        </div>
                        <p className={styles.eventLabel}>
                          {entry.kind === "created"
                            ? "Создал заявку"
                            : entry.kind === "comment"
                              ? "Добавил комментарий"
                              : entry.actor === "user"
                                ? "Вернул заявку в работу"
                                : "Изменил статус"}
                          {entry.to_status && <> · {statuses[entry.to_status]}</>}
                        </p>
                        {entry.comment && <p className={styles.comment}>{entry.comment}</p>}
                      </div>
                    </li>
                  ))}
                </ol>
                <form className={styles.commentForm} onSubmit={event => void mutate(event)}>
                  <label className={styles.field}>
                    Ваш комментарий
                    <textarea name="comment" rows={3} maxLength={10000} required placeholder="Дополните обращение или задайте вопрос" />
                  </label>
                  <div>
                    <Button type="submit" variant="secondary" loading={busy} disabled={busy}>
                      <MessageSquare size={16} />
                      Добавить комментарий
                    </Button>
                  </div>
                </form>
              </section>
              <Failure message={mutationError} />
              <p role="status" className={styles.success}>
                {success}
              </p>
            </div>

            <aside className={styles.stack}>
              <section className={styles.panel}>
                <h2>О заявке</h2>
                <dl className={styles.facts}>
                  <div>
                    <dt>Номер</dt>
                    <dd>№{ticket.id}</dd>
                  </div>
                  <div>
                    <dt>Тема</dt>
                    <dd>{topics[ticket.topic]}</dd>
                  </div>
                  <div>
                    <dt>Статус</dt>
                    <dd>
                      <StatusBadge status={ticket.status} />
                    </dd>
                  </div>
                  <div>
                    <dt>Создана</dt>
                    <dd>{formatTime(ticket.created_at)}</dd>
                  </div>
                  <div>
                    <dt>Обновлена</dt>
                    <dd>{formatTime(ticket.updated_at)}</dd>
                  </div>
                </dl>
              </section>

              {action && (
                <section className={`${styles.panel} ${styles.actionCard}`}>
                  <form
                    className={styles.formGrid}
                    key={ticket.status}
                    onSubmit={event => void mutate(event, action.status, action.required)}
                  >
                    <h2>{action.label}</h2>
                    <p className={styles.muted}>
                      {action.status === "done"
                        ? "Опишите результат работы. Пользователь получит уведомление с вашим ответом."
                        : role === "user"
                          ? "Расскажите, что осталось нерешённым. Поддержка продолжит работу над заявкой."
                          : "Пользователь увидит, что его обращением уже занимаются."}
                    </p>
                    <label className={styles.field}>
                      {action.field}
                      <textarea name="comment" rows={4} maxLength={10000} required={action.required} />
                    </label>
                    <div>
                      <Button type="submit" loading={busy} disabled={busy}>
                        {action.label}
                        <ChevronRight size={16} />
                      </Button>
                    </div>
                  </form>
                </section>
              )}

              {!action && (
                <div className={styles.tipCard}>
                  <Headphones size={22} />
                  <h2>{ticket.status === "done" ? "Работа завершена" : "Поддержка на связи"}</h2>
                  <p>
                    {ticket.status === "done"
                      ? "Результат сохранён в истории. Если вопрос остался, пользователь сможет вернуть заявку в работу."
                      : "Ответ администратора появится здесь автоматически. Дополнительные сведения можно оставить в комментарии."}
                  </p>
                </div>
              )}
            </aside>
          </div>
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------------- app */

export default function App() {
  const path = usePath();
  const search = useSearch();
  const role: Role = path.startsWith("/admin") ? "admin" : "user";
  const match = path.match(/^\/(user|admin)\/tickets\/(\d+)\/?$/);
  const isCreate = path === "/user/new";
  const { theme, applyTheme } = useAppliedTheme();

  const [collapsed, setCollapsed] = useState(false);
  const [recentOpen, setRecentOpen] = useState(true);

  const { data: listData, error: listError, reload: reloadList } = useResource<{ items: Ticket[] }>(`/${role}/tickets`, 4000);
  const tickets = useMemo(() => listData?.items ?? [], [listData]);
  const [debugBusy, setDebugBusy] = useState<"notifications" | "tickets" | "seed" | null>(null);

  const seedDemo = async () => {
    if (!window.confirm("Добавить набор демо-заявок в разных статусах?")) return;
    setDebugBusy("seed");
    const seeds = [
      { topic: "access", title: "Не приходит письмо для сброса пароля", description: "Пытаюсь восстановить доступ к личному кабинету, письмо не приходит уже 20 минут. Проверял папку «Спам»." },
      { topic: "service", title: "Ошибка 500 при выгрузке отчёта", description: "При экспорте отчёта за октябрь появляется ошибка 500. Повторяется на двух разных браузерах." },
      { topic: "other", title: "Неверные данные в профиле", description: "В профиле указан старый номер телефона, изменить через интерфейс не получается." },
      { topic: "access", title: "Доступ к разделу «Аналитика»", description: "После смены роли пропал доступ к разделу аналитики. Нужен доступ для еженедельного отчёта." },
      { topic: "service", title: "Медленно открывается список заявок", description: "Список загружается более 10 секунд, особенно если выбрать фильтр «Все темы»." },
      { topic: "other", title: "Предложение по улучшению интерфейса", description: "Хотелось бы видеть сохранённые фильтры в списке заявок, чтобы не настраивать их каждый раз." },
    ];
    try {
      const created: Ticket[] = [];
      for (const seed of seeds) {
        created.push(await request<Ticket>("/user/tickets", seed));
      }
      const [first, second, third, fourth, fifth] = created;
      if (second) {
        await request(`/admin/tickets/${second.id}/status`, { status: "in_progress", comment: "" });
      }
      if (third) {
        await request(`/admin/tickets/${third.id}/status`, { status: "in_progress", comment: "" });
        await request(`/admin/tickets/${third.id}/comments`, { comment: "Проверяю по логам, воспроизвёл на тестовых данных." });
        await request(`/admin/tickets/${third.id}/status`, { status: "done", comment: "Исправили экспорт, отчёт выгружается корректно." });
      }
      if (fourth) {
        await request(`/admin/tickets/${fourth.id}/status`, { status: "in_progress", comment: "" });
        await request(`/admin/tickets/${fourth.id}/status`, { status: "done", comment: "Доступ выдан, проверьте раздел аналитики." });
        await request(`/user/tickets/${fourth.id}/status`, { status: "in_progress", comment: "Раздел открылся, но данных за октябрь нет. Возвращаю в работу." });
      }
      if (fifth && first) {
        await request(`/admin/tickets/${fifth.id}/status`, { status: "in_progress", comment: "" });
        await request(`/admin/tickets/${fifth.id}/comments`, { comment: "Проверяем производительность фильтра, нужен профиль запроса." });
      }
      reloadList();
      window.location.reload();
    } catch (error) {
      window.alert((error as Error).message);
    } finally {
      setDebugBusy(null);
    }
  };

  const resetData = async (kind: "notifications" | "tickets") => {
    const title = kind === "tickets" ? "Удалить ВСЕ заявки вместе с историей и уведомлениями?" : "Удалить все уведомления?";
    if (!window.confirm(title)) return;
    setDebugBusy(kind);
    try {
      await request(`/debug/${kind}`, {});
      reloadList();
      window.location.reload();
    } catch (error) {
      window.alert((error as Error).message);
    } finally {
      setDebugBusy(null);
    }
  };

  const searchItems = useMemo(
    () =>
      tickets.map(ticket => ({
        id: `ticket:${ticket.id}`,
        title: `№${ticket.id} · ${ticket.title}`,
        meta: topics[ticket.topic],
        group: "Заявки",
      })),
    [tickets],
  );

  const activeId = isCreate ? "new" : role;
  const statusParam = new URLSearchParams(search).get("status") ?? "all";
  const initialStatus = ["all", "new", "in_progress", "done"].includes(statusParam) ? statusParam : "all";
  const counts = {
    total: tickets.length,
    new: tickets.filter(ticket => ticket.status === "new").length,
    in_progress: tickets.filter(ticket => ticket.status === "in_progress").length,
    done: tickets.filter(ticket => ticket.status === "done").length,
  };

  return (
    <div className={`${shell.shell} ${collapsed ? styles.shellCollapsed : ""}`}>
      <aside className={`${shell.sidebar} ${collapsed ? styles.sidebarCollapsed : ""}`}>
        <div className={styles.sidebarTop}>
          <Link className={shell.brand} href={`/${role}`} aria-label="X5, поддержка">
            <span className={`${shell.brandMark} ${styles.brandX5}`} aria-hidden="true">
              X5
            </span>
            <span className={`${shell.brandName} ${styles.brandText}`}>Поддержка</span>
          </Link>
          <button
            type="button"
            className={styles.collapseButton}
            onClick={() => setCollapsed(value => !value)}
            aria-label={collapsed ? "Развернуть меню" : "Свернуть меню"}
            title={collapsed ? "Развернуть меню" : "Свернуть меню"}
          >
            {collapsed ? <PanelLeft size={17} /> : <PanelLeftClose size={17} />}
          </button>
        </div>

        <nav className={shell.nav} aria-label="Основная навигация">
          <p className={`${shell.navGroupLabel} ${styles.navGroupText}`}>Работа</p>
          {role === "user" ? (
            <>
              <Link
                href="/user"
                className={`${shell.navItem} ${styles.navLink} ${activeId === "user" ? shell.navItemActive : ""}`}
                aria-current={activeId === "user" ? "page" : undefined}
              >
                <ClipboardList width={17} height={17} strokeWidth={1.75} aria-hidden="true" />
                <span className={styles.navText}>Мои заявки</span>
              </Link>
              <Link
                href="/user/new"
                className={`${shell.navItem} ${styles.navLink} ${activeId === "new" ? shell.navItemActive : ""}`}
                aria-current={activeId === "new" ? "page" : undefined}
              >
                <Plus width={17} height={17} strokeWidth={1.75} aria-hidden="true" />
                <span className={styles.navText}>Новая заявка</span>
              </Link>
            </>
          ) : (
            <>
              <Link
                href="/admin"
                className={`${shell.navItem} ${styles.navLink} ${activeId === "admin" && initialStatus === "all" ? shell.navItemActive : ""}`}
                aria-current={activeId === "admin" ? "page" : undefined}
              >
                <ClipboardList width={17} height={17} strokeWidth={1.75} aria-hidden="true" />
                <span className={styles.navText}>Все заявки</span>
                <span className={styles.navCount}>{counts.total}</span>
              </Link>
              <Link href="/admin?status=new" className={`${shell.navItem} ${styles.navLink} ${initialStatus === "new" ? shell.navItemActive : ""}`}>
                <InboxIcon width={17} height={17} strokeWidth={1.75} aria-hidden="true" />
                <span className={styles.navText}>Новые</span>
                <span className={styles.navCount}>{counts.new}</span>
              </Link>
              <Link href="/admin?status=in_progress" className={`${shell.navItem} ${styles.navLink} ${initialStatus === "in_progress" ? shell.navItemActive : ""}`}>
                <Clock3 width={17} height={17} strokeWidth={1.75} aria-hidden="true" />
                <span className={styles.navText}>В работе</span>
                <span className={styles.navCount}>{counts.in_progress}</span>
              </Link>
              <Link href="/admin?status=done" className={`${shell.navItem} ${styles.navLink} ${initialStatus === "done" ? shell.navItemActive : ""}`}>
                <CheckCheck width={17} height={17} strokeWidth={1.75} aria-hidden="true" />
                <span className={styles.navText}>Выполнено</span>
                <span className={styles.navCount}>{counts.done}</span>
              </Link>
            </>
          )}
        </nav>

        <div className={styles.sidebarFoot}>
          <button type="button" className={styles.recentToggle} onClick={() => setRecentOpen(value => !value)} aria-expanded={recentOpen}>
            {recentOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span className={styles.navText}>Недавние</span>
          </button>
          {recentOpen && (
            <ul className={styles.recentList}>
              {tickets.slice(0, 4).map(ticket => (
                <li key={ticket.id}>
                  <Link href={`/${role}/tickets/${ticket.id}`} className={styles.recentItem}>
                    <span className={styles.recentNum}>№{ticket.id}</span>
                    <span className={styles.recentTitle}>{ticket.title}</span>
                  </Link>
                </li>
              ))}
              {tickets.length === 0 && <li className={styles.recentEmpty}>Заявок пока нет</li>}
            </ul>
          )}
          {!collapsed && (
            <div className={styles.debugBlock}>
              <p className={shell.navGroupLabel}>Отладка</p>
              <div className={styles.debugActions}>
                <Button
                  variant="ghost"
                  size="sm"
                  loading={debugBusy === "notifications"}
                  disabled={debugBusy !== null}
                  onClick={() => void resetData("notifications")}
                >
                  Удалить все уведомления
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={debugBusy === "seed"}
                  disabled={debugBusy !== null}
                  onClick={() => void seedDemo()}
                >
                  Добавить тестовые заявки
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  loading={debugBusy === "tickets"}
                  disabled={debugBusy !== null}
                  onClick={() => void resetData("tickets")}
                >
                  Удалить все заявки
                </Button>
              </div>
            </div>
          )}
        </div>
      </aside>

      <div className={shell.mainCol}>
        <header className={shell.topbar}>
          <div className={styles.topLeft}>
            <Link className={`${shell.topBrand} ${styles.topBrand}`} href={`/${role}`} aria-label="X5, поддержка">
              <span className={`${styles.brandX5} ${styles.brandX5Small}`}>X5</span>
              <span>Поддержка</span>
            </Link>

          <div className={`${shell.topSearch} ${styles.topSearchStable}`}>
            <ExpandingSearch
              label="Поиск по заявкам"
              items={searchItems}
              suggestions={searchItems.slice(0, 3)}
              suggestionsLabel="Недавние"
              placeholder="Номер, заголовок или тема"
              emptyHint="Попробуйте другой номер или заголовок."
              anchor="start"
              expandedWidth={340}
              onSelect={item => {
                const id = item.id.replace("ticket:", "");
                navigate(`/${role}/tickets/${id}`);
              }}
            />
          </div>
          </div>

          <div className={styles.roleSlot}>
            <div className={styles.roleSwitch} data-role={role} role="tablist" aria-label="Режим работы">
              <Link
                href={match ? `/user/tickets/${match[2]}` : "/user"}
                className={role === "user" ? styles.roleSwitchActive : undefined}
                aria-current={role === "user" ? "page" : undefined}
              >
                Пользователь
              </Link>
              <Link
                href={match ? `/admin/tickets/${match[2]}` : "/admin"}
                className={role === "admin" ? styles.roleSwitchActive : undefined}
                aria-current={role === "admin" ? "page" : undefined}
              >
                Администратор
              </Link>
            </div>
          </div>

          <div className={styles.topActionsRight}>
            <div className={styles.notifySlot}>{role === "user" && <Notifications />}</div>
            <Button
              variant="secondary"
              size="sm"
              className={styles.themeButton}
              aria-label={theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему"}
              aria-pressed={theme === "dark"}
              onMouseDown={event => event.preventDefault()}
              onClick={() => applyTheme(theme === "light" ? "dark" : "light")}
            >
              {theme === "light" ? <Moon size={16} strokeWidth={1.75} /> : <Sun size={16} strokeWidth={1.75} />}
            </Button>
          </div>
        </header>

        <nav className={shell.mobileNav} aria-label="Разделы">
          <Link href="/user" className={shell.mobileNavLink}>
            Пользователь
          </Link>
          <Link href="/admin" className={shell.mobileNavLink}>
            Администратор
          </Link>
        </nav>

        <main className={shell.page}>
          <div className={styles.pageEnter} key={path + search}>
            {isCreate ? (
              <CreateTicket />
            ) : match ? (
              <TicketCard role={role} id={match[2]} />
            ) : path === "/" || path === "/user" ? (
              <UserTickets tickets={tickets} error={listError} reload={reloadList} initialStatus={initialStatus} loading={!listData} />
            ) : path === "/admin" ? (
              <AdminTickets tickets={tickets} error={listError} reload={reloadList} initialStatus={initialStatus} />
            ) : (
              <EmptyState
                icon={<InboxIcon size={22} />}
                title="Страница не найдена"
                description="Вернитесь к списку заявок, чтобы продолжить."
                action={<Button onClick={() => navigate(`/${role}`)}>К заявкам</Button>}
              />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
