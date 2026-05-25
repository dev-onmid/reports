import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Button system aligned with ON_Reports design language:
 * - Angular geometry: rounded-[--radius] (2px)
 * - Single accent: primary (Verde Onmid) carries all CTAs
 * - Outline: green border, transparent fill — secondary actions
 * - All interactive elements: min 44px height (WCAG AA touch target)
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-2 border border-transparent bg-clip-padding font-bold whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-40 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        /* Primary CTA — Verde Onmid fill, pressed drops to primary-dark */
        default:
          "bg-primary text-primary-foreground hover:bg-[var(--primary-dark)] active:bg-[var(--primary-dark)]",
        /* Outline — primary border, transparent fill */
        outline:
          "border-2 border-primary bg-transparent text-foreground hover:bg-primary/10",
        /* Outline on dark surfaces — white border */
        "outline-dark":
          "border border-foreground/80 bg-transparent text-foreground hover:bg-foreground/10",
        /* Ghost — no chrome, just text affordance */
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted",
        /* Ghost link — arrow-link style CTA below cards */
        link:
          "text-primary underline-offset-4 hover:underline",
        /* Destructive */
        destructive:
          "bg-destructive text-white hover:bg-destructive/90",
        /* Disabled appearance as standalone variant */
        muted:
          "bg-muted text-muted-foreground cursor-not-allowed",
        /* Secondary (editorial use — Roxo Onmid) */
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/85",
      },
      size: {
        /* Standard CTA — 44px height (WCAG AA) */
        default: "h-11 rounded-[var(--radius)] px-6 text-base leading-tight",
        /* Hero CTA — 48px, larger copy */
        lg:      "h-12 rounded-[var(--radius)] px-8 text-lg leading-tight",
        /* Compact CTA — 36px */
        sm:      "h-9  rounded-[var(--radius)] px-4 text-sm",
        /* Micro: pill-tab, filter chips — 32px */
        xs:      "h-8  rounded-[var(--radius)] px-3 text-xs",
        /* Icon-only variants */
        icon:    "size-11 rounded-[var(--radius)]",
        "icon-sm": "size-9 rounded-[var(--radius)]",
        "icon-xs": "size-8 rounded-[var(--radius)]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
