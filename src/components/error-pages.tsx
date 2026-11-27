import {
  Link,
  useRouter,
  type ErrorComponentProps,
} from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { IP_BLOCKED_MESSAGE } from '@/lib/access'

/** Shown instead of any page when the visitor's address is blocked. */
export function IpBlockedPage() {
  return (
    <main className="grid min-h-svh place-items-center px-6 py-16">
      <div className="max-w-md space-y-4 text-center">
        <p className="text-sm font-medium text-muted-foreground">403</p>
        <h1 className="text-3xl font-semibold tracking-tight">Dostęp zablokowany</h1>
        <p role="alert" className="text-muted-foreground">
          Dostęp do tej strony z Twojego adresu IP został zablokowany ze względów bezpieczeństwa
          (np. wiele nieudanych prób logowania). Jeśli to pomyłka, skontaktuj się z administratorem rejestru.
        </p>
      </div>
    </main>
  )
}

export function NotFoundPage() {
  return (
    <main className="grid min-h-svh place-items-center px-6 py-16">
      <div className="max-w-md space-y-6 text-center">
        <p className="text-sm font-medium text-muted-foreground">404</p>
        <h1 className="text-3xl font-semibold tracking-tight">
          Page not found
        </h1>
        <p className="text-muted-foreground">
          This page doesn’t exist. Check the address or return to the home page.
        </p>
        <Button asChild>
          <Link to="/">Go home</Link>
        </Button>
      </div>
    </main>
  )
}

export function RouteErrorPage({ error, reset }: ErrorComponentProps) {
  const router = useRouter()

  if (error instanceof Error && error.message === IP_BLOCKED_MESSAGE) return <IpBlockedPage />

  return (
    <main className="grid min-h-svh place-items-center px-6 py-16">
      <div className="max-w-md space-y-6 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">
          This page couldn’t load
        </h1>
        <p role="alert" className="text-muted-foreground">
          Please try again, or return to the home page.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Button
            onClick={() => {
              void router.invalidate()
              reset()
            }}
          >
            Try again
          </Button>
          <Button variant="outline" asChild>
            <a href="/">Go home</a>
          </Button>
        </div>
      </div>
    </main>
  )
}
