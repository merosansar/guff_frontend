import { Suspense, lazy, useEffect, useState } from "react"
import { BrowserRouter, Outlet, Route, Routes } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { WifiOff } from "lucide-react"
import { CommandPalette } from "@/components/command-palette"
import { Sidebar } from "@/components/sidebar"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { RealtimeBridge } from "@/features/realtime"
import { GuestOnly, RequireAuth, SessionProvider } from "@/features/session"
import { ApiError } from "@/lib/api"
import { useConnection } from "@/lib/stores"
import { FullPageSpinner, Spinner } from "@/components/common"

// Each screen loads on demand, so the sign-in page stays small.
const LoginPage = lazy(() => import("@/pages/auth").then((m) => ({ default: m.LoginPage })))
const RegisterPage = lazy(() => import("@/pages/auth").then((m) => ({ default: m.RegisterPage })))
const ConversationPage = lazy(() => import("@/pages/conversation"))
const HomePage = lazy(() => import("@/pages/directory").then((m) => ({ default: m.HomePage })))
const BrowsePage = lazy(() => import("@/pages/directory").then((m) => ({ default: m.BrowsePage })))
const PeoplePage = lazy(() => import("@/pages/directory").then((m) => ({ default: m.PeoplePage })))
const NotFoundPage = lazy(() => import("@/pages/directory").then((m) => ({ default: m.NotFoundPage })))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Don't retry mistakes (4xx); do retry the network a couple of times.
      retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
      refetchOnWindowFocus: false,
    },
  },
})

/** Only after a few seconds: a quick reconnect shouldn't flash a warning. */
function ConnectionBanner() {
  const status = useConnection()
  const [late, setLate] = useState<string | null>(null)
  useEffect(() => {
    if (status === "online") return
    const t = setTimeout(() => setLate(status), 2500)
    return () => clearTimeout(t)
  }, [status])
  if (status === "online" || late !== status) return null
  return (
    <div role="status" className="flex items-center justify-center gap-2 bg-marigold px-4 py-1.5 text-center text-sm font-semibold text-marigold-foreground">
      <WifiOff className="size-4 shrink-0" aria-hidden="true" />
      {status === "connecting" ? "Connecting to Guff…" : "Reconnecting… Messages you send now will go out when you’re back."}
    </div>
  )
}

function AppShell() {
  return (
    <div className="flex h-svh overflow-hidden">
      <RealtimeBridge />
      <CommandPalette />
      <aside className="hidden w-[264px] shrink-0 md:block">
        <Sidebar />
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        <ConnectionBanner />
        <Suspense
          fallback={
            <div className="grid flex-1 place-items-center">
              <Spinner />
            </div>
          }
        >
          <Outlet />
        </Suspense>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider delayDuration={300}>
          <BrowserRouter>
            <SessionProvider>
              <Suspense fallback={<FullPageSpinner />}>
              <Routes>
                <Route path="/login" element={<GuestOnly><LoginPage /></GuestOnly>} />
                <Route path="/register" element={<GuestOnly><RegisterPage /></GuestOnly>} />
                <Route element={<RequireAuth><AppShell /></RequireAuth>}>
                  <Route index element={<HomePage />} />
                  <Route path="c/:channelId" element={<ConversationPage />} />
                  <Route path="browse" element={<BrowsePage />} />
                  <Route path="people" element={<PeoplePage />} />
                </Route>
                <Route path="*" element={<NotFoundPage />} />
              </Routes>
              </Suspense>
            </SessionProvider>
          </BrowserRouter>
          <Toaster position="bottom-right" />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
