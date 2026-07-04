import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "relative inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 active:translate-y-px [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-gradient-to-b from-primary to-primary/85 text-primary-foreground shadow-[0_1px_0_0_hsl(0_0%_100%/0.18)_inset,0_6px_20px_-8px_hsl(var(--primary)/0.75)] hover:brightness-110 hover:shadow-[0_1px_0_0_hsl(0_0%_100%/0.22)_inset,0_10px_28px_-8px_hsl(var(--primary)/0.85)]",
        destructive:
          "bg-destructive text-destructive-foreground shadow-[0_6px_20px_-10px_hsl(var(--destructive)/0.8)] hover:brightness-110",
        success:
          "bg-success text-success-foreground shadow-[0_6px_20px_-10px_hsl(var(--success)/0.8)] hover:brightness-110",
        outline:
          "border border-border-strong bg-elevated/60 text-foreground backdrop-blur-sm hover:bg-elevated hover:border-primary/40 hover:text-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/70 border border-border",
        ghost:
          "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 text-sm",
        xs: "h-7 px-2.5 text-xs rounded-md",
        sm: "h-8 px-3 text-xs",
        lg: "h-11 px-6 text-sm",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
