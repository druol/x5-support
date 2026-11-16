import type { LineChartDatum, LineChartSeries } from "@/components/arc/line-chart/line-chart";
import styles from "./app.module.css";
import type { DataColumn } from "@/components/arc/sortable-data-table/sortable-data-table";

const DAY = 86_400_000;
const BASE = Date.UTC(2026, 10, 16); // 16 ноября 2026

const dateFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: "UTC" });
const longFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" });
const numberFmt = new Intl.NumberFormat("ru-RU");

/** Детерминированный шум: без Math.random, чтобы первый рендер был стабильным. */
function noise(seed: number) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

export const revenueFormat = (value: number) => `${numberFmt.format(value)} ₽`;
export const compactFormat = (value: number) =>
  new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 }).format(value);

/* ---------------------------------- линия --------------------------------- */

const POINTS = 90;

const rawLine = Array.from({ length: POINTS }, (_, index) => {
  const date = new Date(BASE - (POINTS - 1 - index) * DAY);
  const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6 ? 0.62 : 1;
  const trend = 1180 + index * 11;
  const wave = Math.sin(index * 0.42) * 190 + Math.sin(index * 0.11) * 260;
  const current = Math.round((trend + wave + noise(index) * 210) * weekend);
  const previous = Math.round((current * 0.83 + Math.sin(index * 0.3) * 90) * 0.98);
  return { date, current, previous };
});

export const lineSeries: LineChartSeries[] = [
  { key: "current", label: "Этот период" },
  { key: "previous", label: "Прошлый период", dashed: true },
];

export function lineData(days: number): LineChartDatum[] {
  return rawLine.slice(-days).map(({ date, current, previous }) => {
    const index = Math.round((date.getTime() - (BASE - (POINTS - 1) * DAY)) / DAY);
    return {
      key: date.toISOString().slice(0, 10),
      label: longFmt.format(date),
      axisLabel: index % Math.max(1, Math.round(days / 6)) === 0 ? dateFmt.format(date) : undefined,
      values: { current, previous },
    };
  });
}

export const ranges = [
  { value: "7", label: "7 дней" },
  { value: "30", label: "30 дней" },
  { value: "90", label: "90 дней" },
];

/* --------------------------------- теплокарта -------------------------------- */

export type ActivityDay = { date: string; count: number };

export const activityDays: ActivityDay[] = Array.from({ length: 365 }, (_, index) => {
  const date = new Date(BASE - (364 - index) * DAY);
  const weekday = date.getUTCDay();
  const weekend = weekday === 0 || weekday === 6 ? 0.4 : 1;
  const seasonal = 0.7 + 0.3 * Math.sin(index * 0.05);
  const count = Math.round(noise(index * 3.7) ** 2 * 38 * weekend * seasonal);
  return { date: date.toISOString().slice(0, 10), count };
});

/* ---------------------------------- donut --------------------------------- */

export const channels = [
  { key: "organic", label: "Органика", value: 428 },
  { key: "referral", label: "Рефералы", value: 264 },
  { key: "partners", label: "Партнёры", value: 182 },
  { key: "ads", label: "Реклама", value: 116 },
];

/* -------------------------------- аккаунты -------------------------------- */

export type Account = {
  id: string;
  name: string;
  domain: string;
  plan: "Старт" | "Команда" | "Бизнес";
  seats: number;
  mrr: number;
  status: "Активен" | "Истекает" | "Пауза";
  updated: string;
};

export const accounts: Account[] = [
  { id: "1", name: "Ветер", domain: "veter.io", plan: "Бизнес", seats: 64, mrr: 184000, status: "Активен", updated: "2 мин назад" },
  { id: "2", name: "Контур", domain: "kontur.team", plan: "Команда", seats: 28, mrr: 96000, status: "Активен", updated: "8 мин назад" },
  { id: "3", name: "Полярис", domain: "polaris.app", plan: "Бизнес", seats: 112, mrr: 248000, status: "Истекает", updated: "14 мин назад" },
  { id: "4", name: "Смена", domain: "smena.dev", plan: "Старт", seats: 8, mrr: 24000, status: "Активен", updated: "26 мин назад" },
  { id: "5", name: "Атлас", domain: "atlas.ru", plan: "Команда", seats: 36, mrr: 118000, status: "Пауза", updated: "1 ч назад" },
  { id: "6", name: "Точка роста", domain: "rost.grow", plan: "Команда", seats: 22, mrr: 84000, status: "Активен", updated: "2 ч назад" },
  { id: "7", name: "Пятый этаж", domain: "floor5.studio", plan: "Старт", seats: 6, mrr: 18000, status: "Активен", updated: "3 ч назад" },
  { id: "8", name: "Кедр", domain: "kedr.market", plan: "Бизнес", seats: 88, mrr: 206000, status: "Активен", updated: "5 ч назад" },
];

export const accountColumns: DataColumn<Account>[] = [
  {
    key: "name",
    label: "Команда",
    width: "34%",
    render: (_, row) => (
      <span className={styles.tableLead}>
        <span className={styles.tableLeadName}>{row.name}</span>
        <span className={styles.tableLeadMeta}>{row.domain}</span>
      </span>
    ),
  },
  {
    key: "plan",
    label: "Тариф",
    render: (value) => (
      <span className={`${styles.cellBadge} ${value === "Бизнес" ? styles.cellBadgeInfo : ""}`}>{String(value)}</span>
    ),
  },
  { key: "seats", label: "Места", numeric: true },
  {
    key: "mrr",
    label: "MRR",
    numeric: true,
    render: (value) => <span className={styles.num}>{numberFmt.format(Number(value))} ₽</span>,
  },
  {
    key: "status",
    label: "Статус",
    render: (value) => (
      <span className={`${styles.cellStatus} ${styles[statusKey(String(value))]}`}>
        <span className={styles.cellStatusDot} aria-hidden="true" />
        {String(value)}
      </span>
    ),
  },
  { key: "updated", label: "Активность", sortable: false },
];

function statusKey(value: string) {
  if (value === "Активен") return "ok";
  if (value === "Истекает") return "warn";
  return "idle";
}

/* --------------------------------- релизы --------------------------------- */

export type Release = {
  id: string;
  version: string;
  name: string;
  team: string;
  date: string;
  adoption: number;
  state: "В проде" | "Катится" | "Черновик";
};

export const releases: Release[] = [
  { id: "r1", version: "v4.18", name: "Новый конструктор отчётов", team: "Ядро", date: "16 ноября", adoption: 82, state: "В проде" },
  { id: "r2", version: "v4.17", name: "Сравнение периодов на графиках", team: "Аналитика", date: "12 ноября", adoption: 64, state: "В проде" },
  { id: "r3", version: "v4.16", name: "Быстрый поиск по событиям", team: "Платформа", date: "9 ноября", adoption: 47, state: "Катится" },
  { id: "r4", version: "v4.15", name: "Экспорт в PDF по расписанию", team: "Отчёты", date: "5 ноября", adoption: 31, state: "Катится" },
  { id: "r5", version: "v4.19", name: "Мобильная версия дашборда", team: "Клиент", date: "20 ноября", adoption: 0, state: "Черновик" },
];

export const releaseColumns: DataColumn<Release>[] = [
  {
    key: "version",
    label: "Релиз",
    width: "34%",
    render: (_, row) => (
      <span className={styles.tableLead}>
        <span className={styles.tableLeadName}>
          {row.version} · {row.name}
        </span>
        <span className={styles.tableLeadMeta}>{row.team}</span>
      </span>
    ),
  },
  { key: "team", label: "Команда" },
  { key: "date", label: "Дата" },
  {
    key: "adoption",
    label: "Принятие",
    numeric: true,
    render: (value) => <span className={styles.num}>{String(value)}%</span>,
  },
  {
    key: "state",
    label: "Статус",
    sortable: false,
    render: (value) => (
      <span className={`${styles.cellStatus} ${styles[releaseKey(String(value))]}`}>
        <span className={styles.cellStatusDot} aria-hidden="true" />
        {String(value)}
      </span>
    ),
  },
];

function releaseKey(value: string) {
  if (value === "В проде") return "ok";
  if (value === "Катится") return "warn";
  return "idle";
}

/* ---------------------------------- команда --------------------------------- */

export const teamMembers = [
  { name: "Анна Соколова", status: "online" as const },
  { name: "Илья Кузнецов", status: "online" as const },
  { name: "Марина Литвинова", status: "offline" as const },
  { name: "Пётр Гаврилов", status: "online" as const },
  { name: "Олег Дорохов", status: "offline" as const },
  { name: "Дина Ахметова", status: "online" as const },
];

/* ----------------------------------- FAQ ---------------------------------- */

export const faqItems = [
  {
    title: "Нужно ли менять код продукта?",
    content:
      "Нет. Достаточно поставить SDK из двух строк и включить нужные события. Если продукт уже отправляет события в другой сервис, Орбита подключится к нему как приёмник и подтянет историю.",
  },
  {
    title: "Сколько времени занимает подключение?",
    content:
      "Первый отчёт появляется через 40 секунд после установки SDK. Полная история событий подтягивается за один вечер, дальше данные обновляются каждую минуту.",
  },
  {
    title: "Как считается стоимость?",
    content:
      "По активным командам, а не по событиям. Люди и события внутри команды не ограничены, поэтому счёт не меняется от всплеска трафика или нового релиза.",
  },
  {
    title: "Где хранятся данные?",
    content:
      "В дата-центрах в России и Европе. Регион выбирается при создании рабочего пространства, и позже его нельзя изменить: это защищает историю от случайного переноса.",
  },
  {
    title: "Можно ли экспортировать отчёты?",
    content:
      "Да. Любой отчёт выгружается в CSV и PDF или уходит по расписанию в Slack и на почту. Дашборд можно открыть по ссылке без доступа к остальным данным.",
  },
];

/* --------------------------------- события -------------------------------- */

export const productEvents = [
  { title: "Вышел релиз v4.18", meta: "16 ноября, 14:20", tone: "ok" as const },
  { title: "Полярис продлил тариф Бизнес", meta: "16 ноября, 12:05", tone: "ok" as const },
  { title: "Конверсия в оплату выросла на 3,1%", meta: "16 ноября, 09:40", tone: "ok" as const },
  { title: "Сборка v4.19 ждёт проверки", meta: "15 ноября, 19:12", tone: "warn" as const },
];
