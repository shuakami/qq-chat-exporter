import type { Metadata } from 'next'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import { Analytics } from '@vercel/analytics/next'
import { LoadingProvider } from '@/components/loading-provider'
import { AuthProvider } from '@/components/auth-provider'
import '@/styles/globals.css'

export const metadata: Metadata = {
  title: 'QCE v5 - QQ Chat Export Tool',
  description: 'QQ聊天记录导出工具 v5.0.0 - 高效导出和管理QQ聊天记录',
  generator: 'QCE v5',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var theme = localStorage.getItem('theme');
                  if (theme === 'dark' || (!theme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                    document.documentElement.classList.add('dark');
                  }
                } catch (e) {}
              })();
            `,
          }}
        />
      </head>
      <body className={`font-sans ${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
        <AuthProvider>
          <LoadingProvider>
            {children}
          </LoadingProvider>
        </AuthProvider>
        <Analytics />
      </body>
    </html>
  )
}
