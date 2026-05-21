import { reactRouter } from "@react-router/dev/vite"
import tailwindcss from "@tailwindcss/vite"
import { cpSync, existsSync, readdirSync, rmSync } from "fs"
import { join, resolve } from "path"
import { defineConfig } from "vite"
import tsconfigPaths from "vite-tsconfig-paths"

const optimizeDepsInclude = [
  "react",
  "react/jsx-runtime",
  "react-dom",
  "react-dom/client",
  "react-router",
  "react-router/dom",
  "@base-ui/react",
  "@base-ui/react/accordion",
  "@base-ui/react/alert-dialog",
  "@base-ui/react/avatar",
  "@base-ui/react/button",
  "@base-ui/react/checkbox",
  "@base-ui/react/collapsible",
  "@base-ui/react/context-menu",
  "@base-ui/react/dialog",
  "@base-ui/react/direction-provider",
  "@base-ui/react/input",
  "@base-ui/react/menu",
  "@base-ui/react/menubar",
  "@base-ui/react/merge-props",
  "@base-ui/react/navigation-menu",
  "@base-ui/react/popover",
  "@base-ui/react/preview-card",
  "@base-ui/react/progress",
  "@base-ui/react/radio",
  "@base-ui/react/radio-group",
  "@base-ui/react/scroll-area",
  "@base-ui/react/select",
  "@base-ui/react/separator",
  "@base-ui/react/slider",
  "@base-ui/react/switch",
  "@base-ui/react/tabs",
  "@base-ui/react/toggle",
  "@base-ui/react/toggle-group",
  "@base-ui/react/tooltip",
  "@base-ui/react/use-render",
  "class-variance-authority",
  "clsx",
  "cmdk",
  "date-fns",
  "dompurify",
  "embla-carousel-react",
  "highlight.js",
  "i18next",
  "input-otp",
  "katex",
  "lucide-react",
  "marked",
  "next-themes",
  "react-day-picker",
  "react-i18next",
  "react-resizable-panels",
  "recharts",
  "sonner",
  "tailwind-merge",
  "vaul",
  "xlsx",
]

function flattenClientBuild() {
  return {
    name: "flatten-client-build",
    apply: "build" as const,
    closeBundle() {
      // Run only after the SSR build (which runs after client build).
      // The SSR build needs build/client/.vite/manifest.json, so we must
      // not move files until the SSR bundle has closed.
      // @ts-ignore – Vite 6+ environment API
      if (this.environment?.name !== "ssr") return
      const clientDir = resolve(process.cwd(), "build/client")
      const buildDir = resolve(process.cwd(), "build")
      if (!existsSync(clientDir)) return
      for (const entry of readdirSync(clientDir)) {
        cpSync(join(clientDir, entry), join(buildDir, entry), { recursive: true })
      }
      rmSync(clientDir, { recursive: true, force: true })
    },
  }
}

export default defineConfig({
  plugins: [tailwindcss(), reactRouter(), tsconfigPaths(), flattenClientBuild()],
  optimizeDeps: {
    include: optimizeDepsInclude,
    force: true,
  },
  build: {
    assetsDir: "static",
  },
})
