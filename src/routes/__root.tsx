import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'

import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { NotFoundPage } from '@/components/error-pages'
import { CookieNotice } from '@/components/cookie-notice'
import { PageTransition, SiteFooter, SiteHeader } from '@/components/site-chrome'
import { IP_BLOCKED_MESSAGE } from '@/lib/access'
import { checkAccess } from '@/lib/access.functions'

import '../styles.css'

const siteName =
  'Centralny Rejestr Lekarzy, Pielęgniarzy i Ratowników Medycznych'
const siteDescription =
  'Wyszukiwarka osób wykonujących zawody medyczne (strona fikcyjna na potrzeby roleplayu)'

export const Route = createRootRoute({
  // A blocked address gets no page at all: throwing here stops every child loader, so no data is rendered.
  // Checked on the server (every full page load); the server functions guard themselves as well.
  beforeLoad: async () => {
    if (typeof document !== 'undefined') return
    const access = await checkAccess()
    if (access.blocked) throw new Error(IP_BLOCKED_MESSAGE)
  },
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: siteName,
      },
      {
        name: 'description',
        content: siteDescription,
      },
      {
        property: 'og:title',
        content: siteName,
      },
      {
        property: 'og:description',
        content: siteDescription,
      },
      {
        property: 'og:type',
        content: 'website',
      },
      {
        name: 'twitter:card',
        content: 'summary_large_image',
      },
    ],
    scripts: [
      {
        // Sets the saved (or system) colour scheme before the first paint.
        children:
          "try{var t=localStorage.getItem('theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark');var h=parseInt(localStorage.getItem('palette-hue'),10);if(h>=0&&h<=360)document.documentElement.style.setProperty('--hue',String(h));var a=JSON.parse(localStorage.getItem('appearance')||'{}');for(var k in a){if(a[k])document.documentElement.dataset[k]=String(a[k])}}catch(e){}",
      },
    ],
    links: [
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      {
        rel: 'preconnect',
        href: 'https://fonts.gstatic.com',
        crossOrigin: 'anonymous',
      },
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;500;600;700&family=Source+Serif+4:opsz,wght@8..60,600;8..60,700&display=swap',
      },
    ],
  }),
  shellComponent: RootDocument,
  notFoundComponent: NotFoundPage,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pl" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <TooltipProvider>
          <div className="flex min-h-screen flex-col">
            <SiteHeader />
            <main className="flex-1">
              <PageTransition>{children}</PageTransition>
            </main>
            <SiteFooter />
          </div>
        </TooltipProvider>
        <CookieNotice />
        <Toaster />
        <Scripts />
      </body>
    </html>
  )
}
