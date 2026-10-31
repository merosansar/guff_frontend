import { createContext, useContext, useEffect, useState } from "react"

export type Theme = "light" | "dark" | "system"

interface ThemeValue {
  theme: Theme
  resolved: "light" | "dark"
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeValue | null>(null)
const KEY = "guff-theme"
const media = () => window.matchMedia("(prefers-color-scheme: dark)")

function read(): Theme {
  try {
    const t = localStorage.getItem(KEY)
    return t === "light" || t === "dark" ? t : "system"
  } catch {
    return "system"
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(read)
  const [systemDark, setSystemDark] = useState(() => media().matches)
  const resolved = theme === "system" ? (systemDark ? "dark" : "light") : theme

  useEffect(() => {
    const m = media()
    const onChange = () => setSystemDark(m.matches)
    m.addEventListener("change", onChange)
    return () => m.removeEventListener("change", onChange)
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolved === "dark")
    document.documentElement.style.colorScheme = resolved
  }, [resolved])

  const setTheme = (next: Theme) => {
    setThemeState(next)
    try {
      localStorage.setItem(KEY, next)
    } catch {
      /* storage blocked: the choice lasts for this visit */
    }
  }

  return <ThemeContext.Provider value={{ theme, resolved, setTheme }}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>")
  return ctx
}
