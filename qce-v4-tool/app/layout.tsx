import type { Metadata } from 'next'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import { Analytics } from '@vercel/analytics/next'
import { LoadingProvider } from '@/components/loading-provider'
import { AuthProvider } from '@/components/auth-provider'
import { Toaster } from '@/components/ui/toast'
import { InterFontLoader } from '@/components/inter-font-loader'
import '@/styles/globals.css'

export const metadata: Metadata = {
  title: 'QQ Chat Export',
  description: 'QQ聊天记录导出工具 - 高效导出和管理QQ聊天记录',
  generator: 'QQ Chat Export',
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
      'max-snippet': -1,
      'max-image-preview': 'none',
      'max-video-preview': -1,
    },
  },
  referrer: 'no-referrer',
  formatDetection: { telephone: false, email: false, address: false },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="zh-CN" translate="no" suppressHydrationWarning>
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
              
              // 修复浏览器翻译功能(Edge/Chrome等)导致的 React DOM 操作错误
              // 当翻译功能修改DOM后，React尝试操作已被移除的节点会抛出错误
              if (typeof Node !== 'undefined') {
                var originalRemoveChild = Node.prototype.removeChild;
                Node.prototype.removeChild = function(child) {
                  if (child.parentNode !== this) {
                    return child;
                  }
                  return originalRemoveChild.apply(this, arguments);
                };
                
                var originalInsertBefore = Node.prototype.insertBefore;
                Node.prototype.insertBefore = function(newNode, referenceNode) {
                  if (referenceNode && referenceNode.parentNode !== this) {
                    return newNode;
                  }
                  return originalInsertBefore.apply(this, arguments);
                };
              }
            `,
          }}
        />
      </head>
      <body className={`font-sans ${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
        <AuthProvider>
          <LoadingProvider>
            {children}
            <Toaster position="bottom-right" theme="macos" />
          </LoadingProvider>
        </AuthProvider>
        <InterFontLoader />
        <Analytics />
      </body>
    </html>
  )
}
