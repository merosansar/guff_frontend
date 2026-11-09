import { useEffect, useRef, useState } from "react"
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom"
import { CheckCircle2, Eye, EyeOff, Loader2, MailCheck, XCircle } from "lucide-react"
import { Avatar } from "@/components/common"
import { LivePreview } from "@/components/live-preview"
import { Wordmark } from "@/components/logo"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useSession } from "@/features/session"
import { api } from "@/lib/api"
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
  const justReset = !!(useLocation().state as { reset?: boolean } | null)?.reset
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
      {justReset && (
        <p className="mt-4 flex items-center gap-2 rounded-md bg-primary/10 p-3 text-sm" role="status">
          <CheckCircle2 className="size-4 shrink-0 text-primary" aria-hidden="true" /> Your password was changed. Sign in with the new one.
        </p>
      )}

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
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link to="/forgot-password" className="text-sm text-primary hover:underline">
              Forgot password?
            </Link>
          </div>
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

// ---- forgotten passwords -------------------------------------------------------------

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("")
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.auth.forgot(email)
      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t send the email.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout>
      {sent ? (
        <div className="grid gap-3">
          <MailCheck className="size-10 text-primary" aria-hidden="true" />
          <h1 className="text-2xl font-bold tracking-tight">Check your email</h1>
          <p className="text-muted-foreground">
            If <strong className="text-foreground">{email}</strong> has a Guff account, a link to choose a new password is on its way. It works for an hour.
          </p>
          <p className="text-sm text-muted-foreground">Running Guff on your own computer? Without an email service set up, the link is printed in the API window.</p>
          <Link to="/login" className="mt-2 text-sm font-semibold text-primary hover:underline">
            Back to sign in
          </Link>
        </div>
      ) : (
        <>
          <h1 className="text-2xl font-bold tracking-tight">Forgot your password?</h1>
          <p className="mt-1 text-muted-foreground">Enter your email and we’ll send you a link to choose a new one.</p>
          <form className="mt-7 grid gap-4" onSubmit={submit}>
            <div className="grid gap-1.5">
              <Label htmlFor="forgot-email">Email</Label>
              <Input id="forgot-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            </div>
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" size="lg" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
              Send reset link
            </Button>
          </form>
          <p className="mt-8 text-sm text-muted-foreground">
            Remembered it?{" "}
            <Link to="/login" className="font-semibold text-primary hover:underline">
              Sign in
            </Link>
          </p>
        </>
      )}
    </AuthLayout>
  )
}

export function ResetPasswordPage() {
  const [params] = useSearchParams()
  const token = params.get("token") ?? ""
  const navigate = useNavigate()
  const { status, logout } = useSession()
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password !== confirm) return setError("The two passwords don’t match.")
    setBusy(true)
    setError(null)
    try {
      await api.auth.reset(token, password)
      // Every session ended with the reset, this tab's too.
      if (status === "signed-in") await logout().catch(() => {})
      navigate("/login", { replace: true, state: { reset: true } })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t reset your password.")
      setBusy(false)
    }
  }

  return (
    <AuthLayout>
      <h1 className="text-2xl font-bold tracking-tight">Choose a new password</h1>
      <p className="mt-1 text-muted-foreground">You’ll be signed out everywhere, then you can sign in with the new one.</p>
      {!token ? (
        <p className="mt-6 text-sm text-destructive" role="alert">
          This link is incomplete. Open the link from the email again, or{" "}
          <Link to="/forgot-password" className="font-semibold underline">
            ask for a new one
          </Link>
          .
        </p>
      ) : (
        <form className="mt-7 grid gap-4" onSubmit={submit}>
          <div className="grid gap-1.5">
            <Label htmlFor="new-password">New password</Label>
            <PasswordInput id="new-password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} maxLength={72} required autoFocus />
            <p className="text-xs text-muted-foreground">At least 8 characters.</p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="confirm-password">Type it again</Label>
            <PasswordInput id="confirm-password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} minLength={8} maxLength={72} required />
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}{" "}
              {/expired|used/.test(error) && (
                <Link to="/forgot-password" className="font-semibold underline">
                  Get a new link
                </Link>
              )}
            </p>
          )}
          <Button type="submit" size="lg" disabled={busy}>
            {busy && <Loader2 className="animate-spin" />}
            Save new password
          </Button>
        </form>
      )}
    </AuthLayout>
  )
}

export function VerifyEmailPage() {
  const [params] = useSearchParams()
  const token = params.get("token") ?? ""
  const { status, user, updateUser } = useSession()
  const [state, setState] = useState<"working" | "done" | "failed">(token ? "working" : "failed")
  const [error, setError] = useState(token ? "" : "This link is incomplete. Open the link from the email again.")
  const started = useRef(false)

  useEffect(() => {
    if (!token || started.current) return
    started.current = true
    api.auth
      .verifyEmail(token)
      .then(() => setState("done"))
      .catch((e: Error) => {
        setState("failed")
        setError(e.message)
      })
  }, [token])

  useEffect(() => {
    if (state === "done" && user && !user.emailVerified) updateUser({ ...user, emailVerified: true })
  }, [state, user, updateUser])

  return (
    <AuthLayout>
      <div className="grid gap-3">
        {state === "working" ? (
          <Loader2 className="size-8 animate-spin text-muted-foreground" aria-label="Confirming" />
        ) : state === "done" ? (
          <CheckCircle2 className="size-10 text-primary" aria-hidden="true" />
        ) : (
          <XCircle className="size-10 text-destructive" aria-hidden="true" />
        )}
        <h1 className="text-2xl font-bold tracking-tight">
          {state === "working" ? "Confirming your email…" : state === "done" ? "Email confirmed" : "That link didn’t work"}
        </h1>
        <p className="text-muted-foreground">
          {state === "done" ? "Thanks! If you ever forget your password, we can send a reset link to this address." : state === "failed" ? error : ""}
        </p>
        {state !== "working" && (
          <Link to={status === "signed-in" ? "/" : "/login"} className="mt-2 text-sm font-semibold text-primary hover:underline">
            {status === "signed-in" ? "Back to Guff" : "Sign in"}
          </Link>
        )}
      </div>
    </AuthLayout>
  )
}
