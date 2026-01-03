import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

// 从后端 package.json 读取版本
function getVersionFromPlugin() {
  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url))
    const pluginPkgPath = path.join(__dirname, '../plugins/qq-chat-exporter/package.json')
    const pkg = JSON.parse(fs.readFileSync(pluginPkgPath, 'utf-8'))
    return pkg.version || 'unknown'
  } catch {
    return 'unknown'
  }
}

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
  // 环境变量注入
  env: {
    QCE_VERSION: process.env.QCE_VERSION || getVersionFromPlugin(),
  },
}

export default nextConfig
