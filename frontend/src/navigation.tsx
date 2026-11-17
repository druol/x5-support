import { useSyncExternalStore } from "react";
import type { AnchorHTMLAttributes, MouseEvent } from "react";

export function navigate(path: string) {
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo({ top: 0 });
}
function subscribe(callback: () => void) {
  window.addEventListener("popstate", callback);
  return () => window.removeEventListener("popstate", callback);
}
export function usePath() { return useSyncExternalStore(subscribe, () => window.location.pathname); }
export function useSearch() { return useSyncExternalStore(subscribe, () => window.location.search); }
export function Link({ href = "/user", children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const click = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); navigate(href);
  };
  return <a {...props} href={href} onClick={click}>{children}</a>;
}
