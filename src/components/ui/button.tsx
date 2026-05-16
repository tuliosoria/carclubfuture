import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-sm transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-papaya focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50 disabled:pointer-events-none",
  {
    variants: {
      variant: {
        primary:
          "bg-papaya text-papaya-foreground hover:bg-papaya-hover active:bg-papaya-press uppercase tracking-[0.04em] font-semibold",
        ghost:
          "bg-transparent text-foreground border border-border hover:border-papaya hover:text-papaya uppercase tracking-[0.04em] font-semibold",
        "link-cta":
          "bg-transparent text-foreground hover:text-papaya px-0 h-auto font-medium",
        secondary:
          "border border-border bg-surface-elevated text-foreground hover:border-border-strong",
        outline:
          "border border-border text-foreground hover:border-papaya hover:text-papaya uppercase tracking-[0.04em] font-semibold",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-10 px-5 text-sm",
        lg: "h-12 px-6 text-sm",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  )
);
Button.displayName = "Button";
