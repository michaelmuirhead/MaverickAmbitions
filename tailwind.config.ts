import type { Config } from "tailwindcss";

/**
 * Maverick Ambitions Tailwind config.
 *
 * Breakpoint strategy (iPhone-first, with real iPad and Desktop layouts):
 *  - default:   <640px    iPhone (compact, bottom-nav, stacked cards)
 *  - sm:        >=640px   Large phone / small tablet portrait
 *  - md:        >=768px   iPad portrait (side-nav appears, 2-col)
 *  - lg:        >=1024px  iPad landscape / small desktop (3-col dashboards)
 *  - xl:        >=1280px  Desktop (full multi-pane workspace)
 *  - 2xl:       >=1536px  Large desktop
 *
 * NOTE: the app uses `ResponsiveShell` to pick actual layout components
 * (BottomNav on phone, SideNav on iPad+), so we never just stretch the
 * phone layout to a big screen.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Brand palette — muted finance/fintech feel
        ink: {
          50: "#f7f8fa",
          100: "#eef0f4",
          200: "#d9dde5",
          300: "#b6bdcb",
          400: "#8a93a5",
          500: "#626b7e",
          600: "#454d5e",
          700: "#2f3647",
          800: "#1d2330",
          900: "#0f1320",
          950: "#070a14",
        },
        money: {
          DEFAULT: "#16a34a",
          dark: "#166534",
        },
        loss: {
          DEFAULT: "#dc2626",
          dark: "#7f1d1d",
        },
        accent: {
          DEFAULT: "#f59e0b",
          dark: "#b45309",
        },
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "monospace",
        ],
      },
      boxShadow: {
        card: "0 1px 2px rgba(15,19,32,0.04), 0 4px 12px rgba(15,19,32,0.06)",
      },
      borderRadius: {
        xl: "14px",
        "2xl": "18px",
      },
    },
  },
  plugins: [],
};

export default config;
