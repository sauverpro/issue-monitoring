import type { ReactNode } from "react";
import { SidebarLayout } from "./SidebarLayout";

export function Layout({ children }: { children: ReactNode }) {
  return <SidebarLayout>{children}</SidebarLayout>;
}
