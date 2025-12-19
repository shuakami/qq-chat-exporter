import path from 'path'

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  output: 'export',
  trailingSlash: true,
  // 生产环境下配置基础路径和资源前缀
  basePath: process.env.NODE_ENV === 'production' ? '/static/qce-v4-tool' : '',
  assetPrefix: process.env.NODE_ENV === 'production' ? '/static/qce-v4-tool' : '',
  // 确保构建输出目录为 out (默认值)
  distDir: '.next',
  // Turbopack 配置
  turbopack: {},
}

export default nextConfig
