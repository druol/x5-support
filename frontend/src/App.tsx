import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  ArrowRight,
  Bell,
  ChartLine,
  Check,
  FileText,
  LayoutDashboard,
  Orbit,
  Play,
  Plug,
  SearchX,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
  Zap,
} from "lucide-react";

import { Accordion } from "@/components/arc/accordion/accordion";
import { ActivityHeatmap } from "@/components/arc/activity-heatmap/activity-heatmap";
import { Alert } from "@/components/arc/alert/alert";
import { AnimatedCounter } from "@/components/arc/animated-counter/animated-counter";
import { AvatarGroup } from "@/components/arc/avatar-group/avatar-group";
import { Badge } from "@/components/arc/badge/badge";
import { Button } from "@/components/arc/button/button";
import { DonutChart } from "@/components/arc/donut-chart/donut-chart";
import { EmptyState } from "@/components/arc/empty-state/empty-state";
import { ExpandingSearch } from "@/components/arc/expanding-search/expanding-search";
import { Gauge } from "@/components/arc/gauge/gauge";
import { Input } from "@/components/arc/input/input";
import { LineChart } from "@/components/arc/line-chart/line-chart";
import { MetricCard } from "@/components/arc/metric-card/metric-card";
import { Progress } from "@/components/arc/progress/progress";
import { SearchField } from "@/components/arc/search-field/search-field";
import SegmentedControl from "@/components/arc/segmented-control/segmented-control";
import { SortableDataTable } from "@/components/arc/sortable-data-table/sortable-data-table";
import { Sparkline } from "@/components/arc/sparkline/sparkline";
import { Switch } from "@/components/arc/switch/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/arc/tabs/tabs";
import { ThemeSwitch } from "@/components/arc/theme-switch/theme-switch";
import type { Theme } from "@/components/arc/theme-switch/theme-switch";
import { Tooltip } from "@/components/arc/tooltip/tooltip";
import { UserMenu } from "@/components/arc/user-menu/user-menu";

import {
  accountColumns,
  accounts,
  activityDays,
  channels,
  compactFormat,
  faqItems,
  lineData,
  lineSeries,
  ranges,
  releaseColumns,
  releases,
  teamMembers,
} from "./data";
import styles from "./app.module.css";

const navItems = [
  { id: "overview", label: "Обзор", href: "#overview", icon: LayoutDashboard },
  { id: "metrics", label: "Метрики", href: "#metrics", icon: ChartLine },
  { id: "reports", label: "Отчёты", href: "#reports", icon: FileText },
  { id: "teams", label: "Команды", href: "#teams", icon: Users },
  { id: "features", label: "Возможности", href: "#features", icon: Sparkles },
  { id: "faq", label: "Вопросы", href: "#faq", icon: Settings },
];

const latency = [92, 104, 98, 118, 126, 121, 112, 108, 118, 132, 128, 119, 111, 124, 138, 129, 121, 116, 128, 134];

const sparkData = {
  signups: [42, 51, 48, 62, 58, 71, 74, 69, 78, 86, 82, 91],
  payments: [18, 22, 21, 26, 24, 29, 27, 33, 31, 36, 38, 41],
  errors: [12, 9, 11, 8, 10, 7, 6, 8, 5, 6, 4, 4],
};

const searchItems = [
  ...accounts.map((account) => ({
    id: `team:${account.id}`,
    title: account.name,
    meta: `${account.domain} · ${account.plan}`,
    group: "Команды",
  })),
  { id: "metric:mrr", title: "Выручка (MRR)", meta: "Метрика", group: "Метрики" },
  { id: "metric:retention", title: "Удержание 30 дней", meta: "Метрика", group: "Метрики" },
  { id: "report:activity", title: "Активность продукта", meta: "Отчёт", group: "Отчёты" },
  { id: "report:channels", title: "Каналы привлечения", meta: "Отчёт", group: "Отчёты" },
  { id: "faq:connect", title: "Сколько времени занимает подключение", meta: "Вопрос", group: "Вопросы" },
];

const searchSuggestions = [searchItems[0]!, searchItems[8]!, searchItems[9]!];

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

  function applyTheme(next: Theme, trigger: HTMLElement) {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const doc = document as Document & {
      startViewTransition?: (callback: () => void) => { finished: Promise<void> };
    };
    if (!doc.startViewTransition || reduce) {
      setTheme(next);
      return;
    }
    const rect = trigger.getBoundingClientRect();
    document.documentElement.style.setProperty("--x", `${rect.left + rect.width / 2}px`);
    document.documentElement.style.setProperty("--y", `${rect.top + rect.height / 2}px`);
    doc.startViewTransition(() => setTheme(next));
  }

  return { theme, applyTheme };
}

export default function App() {
  const { theme, applyTheme } = useAppliedTheme();
  const [activeNav, setActiveNav] = useState("overview");
  const [range, setRange] = useState("30");
  const [chartLoading, setChartLoading] = useState(false);
  const [activePoint, setActivePoint] = useState<{ date: string; value: number } | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>("2026-11-14");
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("accounts");
  const [email, setEmail] = useState("");
  const [leadState, setLeadState] = useState<"idle" | "sending" | "sent">("idle");
  const [setupDone, setSetupDone] = useState<string[]>(["connect"]);

  const data = lineData(Number(range));
  const latest = data[data.length - 1];
  const readout = activePoint ?? {
    date: latest.label,
    value: latest.values.current ?? 0,
  };
  const filteredAccounts = accounts.filter((account) =>
    `${account.name} ${account.domain} ${account.plan}`.toLowerCase().includes(query.trim().toLowerCase()),
  );

  useEffect(() => {
    if (!chartLoading) return;
    const timer = window.setTimeout(() => setChartLoading(false), 520);
    return () => window.clearTimeout(timer);
  }, [chartLoading]);

  function changeRange(next: string) {
    setRange(next);
    setActivePoint(null);
    setChartLoading(true);
  }

  function submitLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return;
    setLeadState("sending");
    window.setTimeout(() => setLeadState("sent"), 900);
  }

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <a className={styles.brand} href="#overview" aria-label="Орбита, на главную">
          <span className={styles.brandMark} aria-hidden="true">
            <Orbit width={22} height={22} strokeWidth={1.75} />
          </span>
          <span className={styles.brandName}>Орбита</span>
        </a>

        <nav className={styles.nav} aria-label="Основная навигация">
          <p className={styles.navGroupLabel}>Рабочее пространство</p>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <a
                key={item.id}
                href={item.href}
                className={`${styles.navItem} ${activeNav === item.id ? styles.navItemActive : ""}`}
                aria-current={activeNav === item.id ? "page" : undefined}
                onClick={() => setActiveNav(item.id)}
              >
                <Icon width={18} height={18} strokeWidth={1.75} aria-hidden="true" />
                <span>{item.label}</span>
              </a>
            );
          })}
        </nav>

        <div className={styles.sidebarFoot}>
          <div className={styles.planCard}>
            <div className={styles.planTop}>
              <span className={styles.planName}>Тариф Бизнес</span>
              <Badge tone="success" size="sm" dot>
                Активен
              </Badge>
            </div>
            <p className={styles.planText}>8 из 12 мест занято</p>
            <Progress value={8} max={12} label="Места в команде" showValue />
            <Button variant="secondary" size="sm" className={styles.planButton}>
              Управлять тарифом
            </Button>
          </div>

          <UserMenu
            user={{ name: "Анна Соколова", email: "anna@orbita.app", plan: "Бизнес" }}
            status="available"
            items={[
              { label: "Профиль", keys: ["G", "P"] },
              { label: "Настройки", keys: ["G", "S"] },
              { label: "Помощь", keys: ["?"] },
            ]}
            showName
            align="start"
          />
        </div>
      </aside>

      <div className={styles.mainCol}>
        <header className={styles.topbar}>
          <a className={styles.topBrand} href="#overview" aria-label="Орбита">
            <Orbit width={20} height={20} strokeWidth={1.75} aria-hidden="true" />
            <span>Орбита</span>
          </a>

          <div className={styles.topSearch}>
            <ExpandingSearch
              label="Поиск по метрикам и отчётам"
              items={searchItems}
              suggestions={searchSuggestions}
              suggestionsLabel="Недавние"
              placeholder="Команда, метрика или отчёт"
              emptyHint="Попробуйте другое название или домен."
              anchor="start"
              expandedWidth={420}
              onSelect={(item) => {
                if (item.id.startsWith("team:")) {
                  setQuery(item.title);
                  setTab("accounts");
                  setActiveNav("teams");
                  document.getElementById("teams")?.scrollIntoView({ behavior: "smooth" });
                  return;
                }
                if (item.id.startsWith("metric:")) {
                  setActiveNav("metrics");
                  document.getElementById("metrics")?.scrollIntoView({ behavior: "smooth" });
                  return;
                }
                if (item.id.startsWith("report:")) {
                  setActiveNav("reports");
                  document.getElementById("reports")?.scrollIntoView({ behavior: "smooth" });
                  return;
                }
                setActiveNav("faq");
                document.getElementById("faq")?.scrollIntoView({ behavior: "smooth" });
              }}
            />
          </div>

          <div className={styles.topActions}>
            <Tooltip content="Что нового">
              <Button variant="ghost" size="sm" aria-label="Что нового" className={styles.iconButton}>
                <span className={styles.bell}>
                  <Bell width={18} height={18} strokeWidth={1.75} aria-hidden="true" />
                  <span className={styles.bellDot} aria-hidden="true" />
                </span>
              </Button>
            </Tooltip>
            <ThemeSwitch
              theme={theme}
              iconOnly
              variant="reveal"
              label={theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему"}
              onThemeChange={(next, _variant, trigger) => applyTheme(next, trigger)}
            />
            <Button variant="secondary" size="sm" className={styles.signIn}>
              Войти
            </Button>
          </div>
        </header>

        <nav className={styles.mobileNav} aria-label="Разделы страницы">
          {navItems.map((item) => (
            <a
              key={item.id}
              href={item.href}
              className={`${styles.mobileNavLink} ${activeNav === item.id ? styles.mobileNavLinkActive : ""}`}
              onClick={() => setActiveNav(item.id)}
            >
              {item.label}
            </a>
          ))}
        </nav>

        <main className={styles.page}>
          {/* ----------------------------- герой ----------------------------- */}
          <section id="overview" className={styles.hero}>
            <div className={styles.heroCopy}>
              <h1 className={styles.heroTitle}>
                Пульт управления
                <br />
                продуктом
              </h1>
              <p className={styles.heroLead}>
                Орбита собирает метрики, релизы и обратную связь в один рабочий экран. Команда видит, что происходит
                сейчас, и не тратит утро на сборку отчётов.
              </p>
              <div className={styles.heroActions}>
                <Button size="lg" onClick={() => document.getElementById("lead")?.scrollIntoView({ behavior: "smooth" })}>
                  Начать бесплатно
                  <ArrowRight width={18} height={18} strokeWidth={1.75} aria-hidden="true" />
                </Button>
                <Button
                  variant="secondary"
                  size="lg"
                  onClick={() => document.getElementById("reports")?.scrollIntoView({ behavior: "smooth" })}
                >
                  <Play width={16} height={16} strokeWidth={1.75} aria-hidden="true" />
                  Смотреть демо
                </Button>
              </div>
              <div className={styles.heroMeta}>
                <AvatarGroup members={teamMembers} max={4} size="md" label="Команды на орбите" />
                <p>
                  <strong>1 284 команды</strong> уже собрали свой пульт
                </p>
              </div>
              <p className={styles.heroNote}>14 дней полного доступа. Без карты и звонков.</p>
            </div>

            <aside className={styles.liveCard} aria-label="Состояние сервиса">
              <div className={styles.liveHead}>
                <div>
                  <p className={styles.liveTitle}>Состояние сервиса</p>
                  <p className={styles.liveSub}>Москва, 21:33</p>
                </div>
                <Badge tone="success" size="sm" dot>
                  В норме
                </Badge>
              </div>
              <Gauge
                value={96}
                label="Здоровье сервиса"
                detail="SLA 99,98% за 30 дней"
                thresholds={[
                  { from: 0, tone: "warning", label: "Следим" },
                  { from: 80, tone: "success", label: "Норма" },
                ]}
              />
              <div className={styles.liveSpark}>
                <Sparkline
                  label="Задержка API, p95"
                  data={latency}
                  value="128 мс"
                  change="-14%"
                  tone="success"
                  height={46}
                  interactive={false}
                />
              </div>
              <ul className={styles.liveRows}>
                <li>
                  <span>Приём событий</span>
                  <Badge tone="success" size="sm" dot>
                    2,4 млн в час
                  </Badge>
                </li>
                <li>
                  <span>Экспорт отчётов</span>
                  <Badge tone="warning" size="sm" dot>
                    очередь 40 с
                  </Badge>
                </li>
                <li>
                  <span>Последний релиз</span>
                  <span className={styles.liveValue}>v4.18, 14:20</span>
                </li>
              </ul>
            </aside>
          </section>

          {/* ----------------------------- метрики ----------------------------- */}
          <section id="metrics" className={styles.section} aria-labelledby="metrics-title">
            <div className={styles.sectionHead}>
              <div>
                <h2 id="metrics-title" className={styles.sectionTitle}>
                  Ключевые метрики
                </h2>
                <p className={styles.sectionDesc}>Все команды, последние 30 дней</p>
              </div>
              <span className={styles.updated}>Обновлено минуту назад</span>
            </div>
            <div className={styles.kpiGrid}>
              <MetricCard label="Активные команды" value={1284} context="за последние 30 дней" change="+12%" />
              <MetricCard label="Выручка, тыс. ₽" value={4820} context="MRR, ноябрь" change="+8,4%" />
              <MetricCard label="Удержание, %" value={68} context="30 дней, когорта октября" change="+3,1%" />
              <MetricCard label="Сборка отчёта, с" value={42} context="медиана за неделю" change="-16%" />
            </div>
          </section>

          {/* ----------------------------- отчёты ----------------------------- */}
          <section id="reports" className={styles.section} aria-labelledby="reports-title">
            <div className={styles.sectionHead}>
              <div>
                <h2 id="reports-title" className={styles.sectionTitle}>
                  Отчёты
                </h2>
                <p className={styles.sectionDesc}>Так выглядит рабочий экран команды после подключения</p>
              </div>
            </div>

            <div className={styles.dashGrid}>
              <article className={`${styles.card} ${styles.chartCard}`}>
                <header className={styles.cardHead}>
                  <div>
                    <h3 className={styles.cardTitle}>Активность продукта</h3>
                    <p className={styles.cardDesc}>События в день, все команды</p>
                  </div>
                  <SegmentedControl
                    options={ranges}
                    value={range}
                    onValueChange={changeRange}
                    label="Период графика"
                  />
                </header>
                <div className={styles.readout}>
                  <div className={styles.readoutValue}>
                    <AnimatedCounter value={readout.value} locale="ru-RU" />
                    <span>событий</span>
                  </div>
                  <span className={styles.readoutDate}>{readout.date}</span>
                </div>
                <LineChart
                  label="События в день"
                  data={data}
                  series={lineSeries}
                  height={236}
                  loading={chartLoading}
                  unit="событий"
                  formatValue={(value) => compactFormat(value)}
                  formatTick={(value) => compactFormat(value)}
                  onActiveChange={(_index, datum) => {
                    setActivePoint(
                      datum ? { date: datum.label, value: datum.values.current ?? 0 } : null,
                    );
                  }}
                />
              </article>

              <div className={styles.sideCol}>
                <article className={styles.card}>
                  <header className={styles.cardHead}>
                    <div>
                      <h3 className={styles.cardTitle}>Воронка за неделю</h3>
                      <p className={styles.cardDesc}>Ключевые шаги, все команды</p>
                    </div>
                  </header>
                  <div className={styles.sparkStack}>
                    <Sparkline
                      label="Регистрации"
                      data={sparkData.signups}
                      value="912"
                      change="+18%"
                      tone="success"
                      height={44}
                      interactive={false}
                    />
                    <Sparkline
                      label="Оплаты"
                      data={sparkData.payments}
                      value="368"
                      change="+11%"
                      tone="accent"
                      height={44}
                      interactive={false}
                    />
                    <Sparkline
                      label="Ошибки"
                      data={sparkData.errors}
                      value="41"
                      change="-23%"
                      tone="danger"
                      height={44}
                      interactive={false}
                    />
                  </div>
                </article>

                <article className={styles.card}>
                  <header className={styles.cardHead}>
                    <div>
                      <h3 className={styles.cardTitle}>Быстрый старт в демо</h3>
                      <p className={styles.cardDesc}>Три шага до первого отчёта</p>
                    </div>
                    <Badge tone={setupDone.length === 3 ? "success" : "neutral"} size="sm" dot={setupDone.length === 3}>
                      {setupDone.length} из 3
                    </Badge>
                  </header>
                  <Progress value={setupDone.length} max={3} label="Готовность демо" showValue />
                  <ul className={styles.setupList}>
                    {[
                      { id: "connect", label: "Подключить источник событий" },
                      { id: "report", label: "Собрать первый отчёт" },
                      { id: "team", label: "Позвать команду" },
                    ].map((step) => (
                      <li key={step.id} className={styles.setupRow}>
                        <span className={setupDone.includes(step.id) ? styles.setupLabelDone : styles.setupLabel}>
                          {step.label}
                        </span>
                        <Switch
                          checked={setupDone.includes(step.id)}
                          onCheckedChange={(checked) =>
                            setSetupDone((previous) =>
                              checked ? [...previous, step.id] : previous.filter((id) => id !== step.id),
                            )
                          }
                          aria-label={step.label}
                        />
                      </li>
                    ))}
                  </ul>
                </article>
              </div>

              <article className={`${styles.card} ${styles.heatCard}`}>
                <header className={styles.cardHead}>
                  <div>
                    <h3 className={styles.cardTitle}>Ритм работы</h3>
                    <p className={styles.cardDesc}>
                      {selectedDay ? `Выбран день ${new Date(selectedDay).toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" })}` : "События по дням за год"}
                    </p>
                  </div>
                  <Badge tone="neutral" size="sm">
                    {activityDays.length} дней
                  </Badge>
                </header>
                <ActivityHeatmap
                  days={activityDays}
                  label="События за год"
                  period="2026"
                  unit={{ one: "событие", other: "событий" }}
                  locale="ru-RU"
                  weekStartsOn={1}
                  selectedDate={selectedDay}
                  onSelectDate={setSelectedDay}
                />
              </article>

              <article className={`${styles.card} ${styles.donutCard}`}>
                <header className={styles.cardHead}>
                  <div>
                    <h3 className={styles.cardTitle}>Каналы привлечения</h3>
                    <p className={styles.cardDesc}>Новые команды за ноябрь</p>
                  </div>
                </header>
                <DonutChart
                  data={channels}
                  label="Новые команды по каналам"
                  unit="команд"
                  totalLabel="Новые команды"
                  size={188}
                  thickness={22}
                />
              </article>
            </div>
          </section>

          {/* ----------------------------- команды ----------------------------- */}
          <section id="teams" className={styles.section} aria-labelledby="teams-title">
            <div className={styles.sectionHead}>
              <div>
                <h2 id="teams-title" className={styles.sectionTitle}>
                  Команды и релизы
                </h2>
                <p className={styles.sectionDesc}>Живые данные из демо-пространства</p>
              </div>
            </div>

            <Tabs value={tab} onValueChange={setTab}>
              <div className={styles.tableToolbar}>
                <TabsList aria-label="Данные демо-пространства">
                  <TabsTrigger value="accounts">Аккаунты</TabsTrigger>
                  <TabsTrigger value="releases">Релизы</TabsTrigger>
                </TabsList>
                <div className={styles.tableFilters}>
                  {tab === "accounts" ? (
                    <>
                      <span className={styles.tableCount}>{filteredAccounts.length} команды</span>
                      <div className={styles.tableSearch}>
                        <SearchField
                          label="Найти команду"
                          value={query}
                          onValueChange={setQuery}
                          placeholder="Название или домен"
                        />
                      </div>
                    </>
                  ) : (
                    <span className={styles.tableCount}>{releases.length} релиза</span>
                  )}
                </div>
              </div>

              <TabsContent value="accounts">
                {filteredAccounts.length > 0 ? (
                  <SortableDataTable
                    rows={filteredAccounts}
                    columns={accountColumns}
                    rowKey="id"
                    caption="Аккаунты на орбите"
                    defaultSort={{ key: "mrr", direction: "desc" }}
                    itemName={{ one: "команда", other: "команд" }}
                  />
                ) : (
                  <EmptyState
                    title="Ничего не нашлось"
                    description={`По запросу «${query}» команд нет. Попробуйте другое название или домен.`}
                    icon={<SearchX width={22} height={22} strokeWidth={1.75} aria-hidden="true" />}
                    action={
                      <Button variant="secondary" size="sm" onClick={() => setQuery("")}>
                        Сбросить поиск
                      </Button>
                    }
                  />
                )}
              </TabsContent>

              <TabsContent value="releases">
                <SortableDataTable
                  rows={releases}
                  columns={releaseColumns}
                  rowKey="id"
                  caption="Релизы за ноябрь"
                  defaultSort={{ key: "date", direction: "desc" }}
                  itemName={{ one: "релиз", other: "релизов" }}
                />
              </TabsContent>
            </Tabs>
          </section>

          {/* --------------------------- возможности --------------------------- */}
          <section id="features" className={styles.section} aria-labelledby="features-title">
            <div className={styles.sectionHead}>
              <div>
                <h2 id="features-title" className={styles.sectionTitle}>
                  Один экран вместо пяти вкладок
                </h2>
                <p className={styles.sectionDesc}>
                  Метрики, релизы и решения команды живут рядом, поэтому причина и следствие не теряются.
                </p>
              </div>
            </div>
            <div className={styles.featureGrid}>
              <div className={styles.feature}>
                <Zap width={20} height={20} strokeWidth={1.75} aria-hidden="true" className={styles.featureIcon} />
                <h3>Метрики без сборки</h3>
                <p>
                  События, выручка и удержание обновляются сами. Раз в неделю отчёт приходит на почту, без выгрузок
                  в таблицы.
                </p>
              </div>
              <div className={styles.feature}>
                <ShieldCheck width={20} height={20} strokeWidth={1.75} aria-hidden="true" className={styles.featureIcon} />
                <h3>Релизы под контролем</h3>
                <p>
                  Каждая сборка связана с изменениями метрик. Если конверсия просела, видно, какой релиз к этому
                  привёл.
                </p>
              </div>
              <div className={styles.feature}>
                <Plug width={20} height={20} strokeWidth={1.75} aria-hidden="true" className={styles.featureIcon} />
                <h3>Подключение за вечер</h3>
                <p>
                  SDK из двух строк, коннекторы к популярным хранилищам и вебхуки. Историю можно загрузить задним
                  числом.
                </p>
              </div>
            </div>
          </section>

          {/* ------------------------------ цифры ------------------------------ */}
          <section className={styles.proof} aria-label="Орбита в цифрах">
            <div className={styles.proofItem}>
              <AnimatedCounter value={1284} animateOnView locale="ru-RU" />
              <span>команды работают в Орбите</span>
            </div>
            <div className={styles.proofItem}>
              <AnimatedCounter value={42} animateOnView suffix={" с"} locale="ru-RU" />
              <span>до первого отчёта</span>
            </div>
            <div className={styles.proofItem}>
              <AnimatedCounter value={99.98} animateOnView decimals={2} suffix="%" locale="ru-RU" />
              <span>доступность сервиса</span>
            </div>
            <div className={styles.proofItem}>
              <AnimatedCounter value={4.9} animateOnView decimals={1} suffix={" из 5"} locale="ru-RU" />
              <span>средняя оценка команд</span>
            </div>
          </section>

          {/* ------------------------------ вопросы ------------------------------ */}
          <section id="faq" className={styles.faq} aria-labelledby="faq-title">
            <div className={styles.faqIntro}>
              <h2 id="faq-title" className={styles.sectionTitle}>
                Вопросы и ответы
              </h2>
              <p className={styles.sectionDesc}>
                Если чего-то не хватает, напишите в поддержку. Отвечает команда продукта, обычно в течение часа.
              </p>
              <Button variant="secondary" size="sm" className={styles.faqButton}>
                Написать в поддержку
              </Button>
            </div>
            <div className={styles.faqList}>
              <Accordion items={faqItems} defaultOpen={0} size="lg" />
            </div>
          </section>

          {/* -------------------------------- CTA -------------------------------- */}
          <section id="lead" className={styles.cta} aria-labelledby="lead-title">
            <div className={styles.ctaCopy}>
              <h2 id="lead-title" className={styles.ctaTitle}>
                Соберите свой пульт за вечер
              </h2>
              <p className={styles.ctaDesc}>
                14 дней полного доступа, без карты и звонков. Достаточно рабочей почты, остальное покажем на первом
                созвоне, если захотите.
              </p>
              <ul className={styles.ctaList}>
                <li>
                  <Check width={18} height={18} strokeWidth={1.75} aria-hidden="true" />
                  Все метрики и отчёты без ограничений
                </li>
                <li>
                  <Check width={18} height={18} strokeWidth={1.75} aria-hidden="true" />
                  Перенос истории и помощь с подключением
                </li>
                <li>
                  <Check width={18} height={18} strokeWidth={1.75} aria-hidden="true" />
                  Данные остаются вашими, экспорт в один клик
                </li>
              </ul>
            </div>
            <div className={styles.ctaForm}>
              {leadState === "sent" ? (
                <div className={styles.ctaSuccess}>
                  <Alert title="Письмо отправлено" tone="success">
                    Доступ уже ждёт на {email}. Проверьте входящие через минуту.
                  </Alert>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setLeadState("idle");
                      setEmail("");
                    }}
                  >
                    Отправить на другой адрес
                  </Button>
                </div>
              ) : (
                <form onSubmit={submitLead} className={styles.form}>
                  <Input
                    label="Рабочая почта"
                    type="email"
                    name="email"
                    placeholder="name@company.ru"
                    description="Пришлём доступ и короткую инструкцию по подключению."
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                  />
                  <Button type="submit" size="lg" loading={leadState === "sending"}>
                    Начать бесплатно
                  </Button>
                  <p className={styles.formNote}>Без спама. Отписаться можно в один клик.</p>
                </form>
              )}
            </div>
          </section>

          <footer className={styles.footer}>
            <div className={styles.footerBrand}>
              <span className={styles.brandMark} aria-hidden="true">
                <Orbit width={20} height={20} strokeWidth={1.75} />
              </span>
              <div>
                <p className={styles.footerName}>Орбита</p>
                <p className={styles.footerNote}>Продуктовая аналитика для команд, которые решают быстро.</p>
              </div>
            </div>
            <nav className={styles.footerLinks} aria-label="Подвал">
              <a href="#metrics">Метрики</a>
              <a href="#reports">Отчёты</a>
              <a href="#teams">Команды</a>
              <a href="#faq">Вопросы</a>
              <a href="#lead">Доступ</a>
            </nav>
            <p className={styles.footerLegal}>© 2026 Орбита. Все права защищены.</p>
          </footer>
        </main>
      </div>
    </div>
  );
}
