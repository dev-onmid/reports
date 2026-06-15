---
name: project-onmid-report-engine
description: Architecture and wiring of the ONMID Clean Performance report engine — visual template, data builder, API routes, and public viewer
metadata:
  type: project
---

The ONMID Clean Performance 16:9 report template is fully implemented and wired.

**Why:** The user wants all reports generated from ON_Reports to match the premium visual style shown in their reference slides (white background, green ONMID branding, 16:9 layout, strategic narrative per page).

**How to apply:** When working on report generation, follow this architecture:

## Architecture

- `src/components/onmid-performance-template/types.ts` — typed page definitions (CoverPage, ExecutiveSummaryPage, GrowthChartPage, NewCustomersPage, ExplanationCardsPage, ComparisonTablePage, CostPerCustomerPage, ReachImpressionsPage, MetricHighlightPage)
- `src/components/onmid-performance-template/index.tsx` — pure React visual renderer (no data fetching), renders `OmniReportData`
- `src/lib/report-builder.ts` — `buildOmniReport()` fetches monthly CRM + Meta Ads data, calls Claude AI to generate narrative text, assembles `OmniReportData`; `saveOmniReport()` persists to `diagnostic_reports` with `template_slug = 'onmid-clean-performance'`
- `src/app/api/reports/run-once/route.ts` — manual report generation, calls `buildOmniReport` + `saveOmniReport`
- `src/app/api/reports/run/[configId]/route.ts` — automated monthly generation, same pipeline
- `src/app/relatorio/[token]/page.tsx` — public viewer: if `template_slug = 'onmid-clean-performance'` renders `OmniPerformanceTemplate`, otherwise falls back to old `DiagnosticoTemplate`

## Template slug routing
- `'onmid-clean-performance'` → `OmniPerformanceTemplate`
- `'diagnostico-performance'` (legacy) → `DiagnosticoTemplate`

## Default date range
The "Gerar Relatório" modal defaults to **12 months back** to provide enough monthly history for the charts.

## Page types the AI can include
cover, executive_summary, growth_chart, new_customers, explanation_cards, comparison_table, cost_per_customer, reach_impressions, metric_highlight
