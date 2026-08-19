import type React from "react";
import { clsx } from "clsx";

export function Skeleton({
  className,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx(
        "animate-pulse rounded-md bg-zinc-200/80 dark:bg-zinc-800/80",
        className
      )}
      {...rest}
    />
  );
}
