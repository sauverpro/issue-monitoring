import {
  init as initCore,
  getClient,
  setUser,
  setScreen,
  captureNavigation,
  captureClick,
  captureScreenView,
  captureFormStart,
  captureFormSubmit,
  captureSearch,
  captureFilter,
  captureModalOpen,
  captureModalClose,
  captureDownload,
  captureFileUpload,
  capturePurchaseStart,
  capturePurchaseComplete,
  captureLogout,
  wrapFetch,
  type MonitorInit,
  type MonitorClient,
} from "@koralink/monitor-core";

const DOWNLOAD_EXT = /\.(pdf|csv|xlsx?|docx?|zip|png|jpe?g)(\?|$)/i;

function currentPath(): string {
  if (typeof window === "undefined") return "/";
  return `${window.location.pathname}${window.location.search}`;
}

function patchHistory(client: MonitorClient): void {
  if (typeof window === "undefined") return;
  const wrap = (method: "pushState" | "replaceState") => {
    const orig = history[method].bind(history);
    history[method] = function (this: History, ...args: Parameters<History["pushState"]>) {
      const from = currentPath();
      const result = orig(...args);
      client.captureNavigation(currentPath(), from);
      return result;
    };
  };
  wrap("pushState");
  wrap("replaceState");
  window.addEventListener("popstate", () => {
    client.captureNavigation(currentPath());
  });
}

function patchClicks(client: MonitorClient): void {
  if (typeof document === "undefined") return;
  document.addEventListener(
    "click",
    (event) => {
      const target = event.target as Element | null;
      const modalOpen = target?.closest?.("[data-monitor-modal-open]");
      if (modalOpen) {
        client.captureModalOpen({
          modal: modalOpen.getAttribute("data-monitor-modal-open") || "modal",
          screen: currentPath(),
        });
      }
      const modalClose = target?.closest?.("[data-monitor-modal-close]");
      if (modalClose) {
        client.captureModalClose({
          modal: modalClose.getAttribute("data-monitor-modal-close") || "modal",
          screen: currentPath(),
        });
      }
      const logout = target?.closest?.("[data-monitor-logout]");
      if (logout) {
        client.captureLogout(currentPath());
      }

      const el = target?.closest?.("button, a, [role='button'], [data-monitor-click]");
      if (!el) return;
      const labeled =
        el.getAttribute("data-monitor-click") ||
        el.getAttribute("aria-label") ||
        (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
      if (labeled) {
        client.captureClick({
          label: labeled,
          target: el.tagName.toLowerCase(),
          screen: currentPath(),
        });
      }

      if (el.tagName.toLowerCase() === "a") {
        const href = el.getAttribute("href") || "";
        if (el.hasAttribute("download") || DOWNLOAD_EXT.test(href)) {
          client.captureDownload({ file: href || labeled || "file", screen: currentPath() });
        }
      }
    },
    true
  );
}

function patchForms(client: MonitorClient): void {
  if (typeof document === "undefined") return;
  const started = new WeakSet<Element>();
  const formName = (form: Element): string =>
    form.getAttribute("data-monitor-form") ||
    (form as HTMLFormElement).name ||
    form.id ||
    "form";
  document.addEventListener(
    "focusin",
    (event) => {
      const form = (event.target as Element | null)?.closest?.("form");
      if (!form || started.has(form)) return;
      started.add(form);
      client.captureFormStart({ form: formName(form), screen: currentPath() });
    },
    true
  );
  document.addEventListener(
    "submit",
    (event) => {
      const form = event.target as Element | null;
      if (!form || form.tagName.toLowerCase() !== "form") return;
      client.captureFormSubmit({ form: formName(form), screen: currentPath() });
    },
    true
  );
}

function patchFileInputs(client: MonitorClient): void {
  if (typeof document === "undefined") return;
  document.addEventListener(
    "change",
    (event) => {
      const input = event.target as HTMLInputElement | null;
      if (!input || input.tagName.toLowerCase() !== "input" || input.type !== "file") return;
      const file = input.files?.[0];
      if (!file) return;
      client.captureFileUpload({ file: file.name, screen: currentPath(), sizeBytes: file.size });
    },
    true
  );
}

function patchVisibility(client: MonitorClient): void {
  if (typeof document === "undefined") return;
  document.addEventListener("visibilitychange", () => {
    client.captureLifecycle(document.hidden ? "background" : "foreground");
  });
  window.addEventListener("online", () => client.setContext({ network: "online" }));
  window.addEventListener("offline", () => {
    client.setContext({ network: "offline" });
    client.captureSystem("offline");
  });
}

export function init(opts: Omit<MonitorInit, "source">): MonitorClient {
  const client = initCore({
    ...opts,
    source: "web",
  });
  client.setContext({
    platform: "web",
    os: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 120) : undefined,
  });
  if (typeof window !== "undefined" && window.fetch) {
    window.fetch = client.wrapFetch(window.fetch.bind(window));
  }
  patchHistory(client);
  patchVisibility(client);
  patchClicks(client);
  patchForms(client);
  patchFileInputs(client);
  client.captureNavigation(currentPath());
  client.captureSystem("web_start");
  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", () => {
      void client.flush();
    });
  }
  return client;
}

export {
  getClient,
  setUser,
  setScreen,
  captureNavigation,
  captureClick,
  captureScreenView,
  captureFormStart,
  captureFormSubmit,
  captureSearch,
  captureFilter,
  captureModalOpen,
  captureModalClose,
  captureDownload,
  captureFileUpload,
  capturePurchaseStart,
  capturePurchaseComplete,
  captureLogout,
  wrapFetch,
};
export type { MonitorInit, MonitorClient };
