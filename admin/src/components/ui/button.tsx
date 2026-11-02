import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes, Ref } from "react";

import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-60 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-brand-600 text-white shadow-sm hover:bg-brand-700",
        secondary: "border border-line-strong bg-surface text-ink hover:bg-neutral-50",
        ghost: "text-ink-muted hover:bg-neutral-50 hover:text-ink",
        danger: "bg-danger-700 text-white hover:bg-red-800",
      },
      size: {
        sm: "h-8 px-3",
        md: "h-9 px-4",
        lg: "h-10 px-5",
        icon: "size-9",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

type Props = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean; ref?: Ref<HTMLButtonElement> };

export function Button({ className, variant, size, asChild = false, ...props }: Props) {
  // Plain buttons never submit a surrounding form by accident; submit buttons say so.
  if (asChild) return <Slot className={cn(buttonVariants({ variant, size }), className)} {...props} />;
  return <button type="button" className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
