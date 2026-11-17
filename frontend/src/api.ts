import { useCallback, useEffect, useState } from "react";

export async function request<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal ?? AbortSignal.timeout(15000),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error("Нет соединения с сервисом. Проверьте подключение и повторите попытку.");
  }
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Сервис временно недоступен. Повторите попытку.");
  }
  return response.json() as Promise<T>;
}

// Sequential polling avoids overlapping requests. Cancel obsolete routes/filters;
// keep the last successful response visible during a temporary outage.
export function useResource<T>(path: string, interval = 3000) {
  const [state, setState] = useState<{ path: string; data?: T; error?: string }>({ path });
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const data = await request<T>(path, undefined, AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]));
        if (!controller.signal.aborted) setState({ path, data });
      } catch (error) {
        if (!controller.signal.aborted) setState(previous => ({ path, data: previous.path === path ? previous.data : undefined, error: error instanceof Error ? error.message : "Не удалось загрузить данные" }));
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(load, interval);
      }
    };
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [path, interval, revision]);
  return { data: state.path === path ? state.data : undefined, error: state.path === path ? state.error : undefined, reload };
}
