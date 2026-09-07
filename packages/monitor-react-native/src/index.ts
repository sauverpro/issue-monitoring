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

type NavState = {
  index?: number;
  routes?: Array<{ name?: string; state?: NavState }>;
};

function currentRouteName(state: NavState | undefined): string | undefined {
  if (!state?.routes?.length) return undefined;
  const idx = state.index ?? state.routes.length - 1;
  const route = state.routes[idx];
  if (!route) return undefined;
  if (route.state) return currentRouteName(route.state) ?? route.name;
  return route.name;
}

export function init(opts: Omit<MonitorInit, "source">): MonitorClient {
  const client = initCore({
    ...opts,
    source: "mobile",
  });
  client.setContext({ platform: "react-native" });
  client.captureSystem("app_start");
  return client;
}

/** Pass React Navigation `onStateChange` the next navigation state. */
export function onNavigationStateChange(state: NavState | undefined): void {
  const name = currentRouteName(state);
  if (name) getClient()?.captureNavigation(`/${name.replace(/^\//, "")}`);
}

/** Call from AppState change: active | background | inactive. */
export function onAppStateChange(next: string): void {
  const client = getClient();
  if (!client) return;
  if (next === "active") client.captureLifecycle("foreground");
  else if (next === "background" || next === "inactive") client.captureLifecycle("background");
}

/** Optional: pass NetInfo `type` and `isConnected`. */
export function onNetInfo(info: { type?: string; isConnected?: boolean | null }): void {
  const client = getClient();
  if (!client) return;
  const network = info.isConnected === false ? "offline" : info.type || "unknown";
  client.setContext({ network });
  if (info.isConnected === false) client.captureSystem("offline");
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
