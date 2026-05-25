import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Badge — document-type / category label.
 * Angular geometry (2px radius), uppercase tracking for tag labels.
 * No pill shape (rounded-full reserved for avatar/social only).
 */
const badgeVariants = cva(
  "group/badge inline-flex h-6 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-[var(--radius)] border border-transparent px-2 py-0.5 text-xs font-bold whitespace-nowrap uppercase tracking-wider transition-all focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        /* Default: primary fill */
        default:
          "bg-primary text-primary-foreground",
        /* Category tag — soft surface, body text */
        tag:
          "border-border bg-muted text-muted-foreground",
        /* Editorial secondary — Roxo Onmid */
        secondary:
          "bg-secondary/15 text-secondary border-secondary/30",
        /* Destructive */
        destructive:
          "bg-destructive/10 text-destructive border-destructive/30",
        /* Outline */
        outline:
          "border-border text-foreground bg-transparent",
        /* Ghost */
        ghost:
          "text-muted-foreground hover:bg-muted hover:text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
