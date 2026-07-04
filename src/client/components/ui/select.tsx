import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  /** small uppercase label rendered inside the control */
  label?: string;
  icon?: React.ReactNode;
}

/**
 * Native <select> dressed up to match the console theme: a leading label/icon,
 * a custom chevron, and consistent focus/hover states. Keeps native a11y +
 * keyboard behaviour while fixing the cramped overflow of a bare <select>.
 */
const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, label, icon, children, ...props }, ref) => {
    return (
      <div
        className={cn(
          "group relative flex h-9 items-center gap-2 rounded-md border border-border bg-elevated/70 pl-2.5 pr-8 text-xs",
          "transition-colors hover:border-border-strong focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-ring/40",
          className,
        )}
      >
        {icon && <span className="shrink-0 text-muted-foreground">{icon}</span>}
        {label && (
          <span className="shrink-0 select-none text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {label}
          </span>
        )}
        <select
          ref={ref}
          className="peer h-full w-full cursor-pointer appearance-none bg-transparent py-0 text-xs font-medium text-foreground outline-none"
          {...props}
        >
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2.5 size-3.5 text-muted-foreground transition-transform group-focus-within:text-foreground" />
      </div>
    );
  },
);
Select.displayName = "Select";

export { Select };
