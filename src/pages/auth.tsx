import { useState } from "react"
import { Link } from "react-router-dom"
import { Eye, EyeOff, Loader2 } from "lucide-react"
import { Avatar } from "@/components/common"
import { LivePreview } from "@/components/live-preview"
import { Wordmark } from "@/components/logo"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useSession } from "@/features/session"
import { WORKSPACE_NAME } from "@/lib/config"
import type { AvatarColor } from "@/lib/types"

const DEMO_PASSWORD = "Demo@1234"
const DEMO_PEOPLE: { email: string; name: string; title: string; color: AvatarColor }[] = [
  { email: "aarav@guff.local", name: "Aarav Shrestha", title: "Engineering lead", color: "indigo" },
  { email: "sita@guff.local", name: "Sita Sharma", title: "Product manager", color: "teal" },
]

function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-svh lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-sidebar p-10 text-sidebar-foreground lg:flex">
        <Wordmark className="text-white" />
        <div className="grid gap-10">
          <div className="max-w-md">
            <h1 className="text-[2.6rem] leading-[1.08] font-bold tracking-tight text-white">Team chat that keeps up with the team.</h1>
            <p className="mt-4 text-lg text-sidebar-muted">
              Channels, direct messages, mentions and files. Everyone sees each message the moment you press Enter.
            </p>
          </div>
          <LivePreview />
        </div>
        <p className="text-sm text-sidebar-muted">
          <span lang="ne">गफ</span> (guff) is Nepali for a good chat.
        </p>
      </div>
      <main className="flex flex-col items-center justify-center bg-background px-5 py-10 sm:px-8">
        <div className="mb-8 lg:hidden">
          <Wordmark onDark={false} />
        </div>
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  )
}

function PasswordInput(props: React.ComponentProps<typeof Input>) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <Input {...props} type={show ? "text" : "password"} className="pr-10" />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute top-1/2 right-1 grid size-8 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:text-foreground"
        aria-label={show ? "Hide password" : "Show password"}
      >
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  )
}

export function LoginPage() {
  const { login } = useSession()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const signIn = async (e: string, p: string, who: string) => {
    setBusy(who)
    setError(null)
    try {
      await login(e, p)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t sign in.")
      setBusy(null)
    }
  }

  return (
    <AuthLayout>
      <h1 className="text-2xl font-bold tracking-tight">Sign in to {WORKSPACE_NAME}</h1>
      <p className="mt-1 text-muted-foreground">Pick up where the conversation left off.</p>

      <form
        className="mt-7 grid gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void signIn(email, password, "form")
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="password">Password</Label>
          <PasswordInput id="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" disabled={busy !== null}>
          {busy === "form" && <Loader2 className="animate-spin" />}
          Sign in
        </Button>
      </form>

      <div className="mt-8">
        <h2 className="text-sm font-semibold">Try the demo</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Sign in as Aarav here and as Sita in a private window to chat with yourself. Or message a teammate: they answer.
        </p>
        <div className="mt-3 grid gap-2">
          {DEMO_PEOPLE.map((p) => (
            <button
              key={p.email}
              type="button"
              disabled={busy !== null}
              onClick={() => void signIn(p.email, DEMO_PASSWORD, p.email)}
              className="flex items-center gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:border-primary/50 hover:bg-accent disabled:opacity-60"
            >
              <Avatar name={p.name} color={p.color} size="md" />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">Sign in as {p.name.split(" ")[0]}</span>
                <span className="block text-sm text-muted-foreground">
                  {p.name}, {p.title.toLowerCase()}
                </span>
              </span>
              {busy === p.email && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-8 text-sm text-muted-foreground">
        New here?{" "}
        <Link to="/register" className="font-semibold text-primary hover:underline">
          Create an account
        </Link>
      </p>
    </AuthLayout>
  )
}

export function RegisterPage() {
  const { register } = useSession()
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  return (
    <AuthLayout>
      <h1 className="text-2xl font-bold tracking-tight">Join {WORKSPACE_NAME} on Guff</h1>
      <p className="mt-1 text-muted-foreground">You’ll start in #general and #random. Browse for more once you’re in.</p>
      <form
        className="mt-7 grid gap-4"
        onSubmit={async (e) => {
          e.preventDefault()
          if (password.length < 8) return setError("Use at least 8 characters for your password.")
          setBusy(true)
          setError(null)
          try {
            await register({ name, email, password })
          } catch (err) {
            setError(err instanceof Error ? err.message : "Couldn’t create your account.")
            setBusy(false)
          }
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="name">Full name</Label>
          <Input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="email">Work email</Label>
          <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="password">Password</Label>
          <PasswordInput id="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
          <p className="text-xs text-muted-foreground">At least 8 characters.</p>
        </div>
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" disabled={busy}>
          {busy && <Loader2 className="animate-spin" />}
          Create account
        </Button>
      </form>
      <p className="mt-8 text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link to="/login" className="font-semibold text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  )
}
