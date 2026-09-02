/**
 * 认证工具库
 */

const TOKEN_KEY = 'qce_access_token';
const PREVIEW_TOKEN_COOKIE = 'qce_preview_token';

export class AuthManager {
  private static instance: AuthManager;
  private token: string | null = null;

  private constructor() {
    // 从localStorage加载token
    if (typeof window !== 'undefined') {
      this.token = localStorage.getItem(TOKEN_KEY);
    }
  }

  static getInstance(): AuthManager {
    if (!AuthManager.instance) {
      AuthManager.instance = new AuthManager();
    }
    return AuthManager.instance;
  }

  /**
   * 初始化认证（检查URL参数并设置fetch拦截器）
   */
  initialize() {
    if (typeof window === 'undefined') return;

    // 检查URL中的token参数
    const urlParams = new URLSearchParams(window.location.search);
    const urlToken = urlParams.get('token');
    
    if (urlToken) {
      this.setToken(urlToken);
      // 清除URL中的token参数
      urlParams.delete('token');
      const newUrl = window.location.pathname + (urlParams.toString() ? '?' + urlParams.toString() : '');
      window.history.replaceState({}, '', newUrl);
    }

    // localStorage 里的令牌在页面重载后不会经过 setToken，这里同步一次
    // 预览 Cookie，保证 /resources/ 静态资源能通过鉴权。
    if (this.token) {
      this.syncPreviewCookie(this.token);
    }

    // 拦截所有fetch请求，自动添加认证头
    this.interceptFetch();
  }

  /**
   * 设置token
   */
  setToken(token: string) {
    this.token = token;
    if (typeof window !== 'undefined') {
      localStorage.setItem(TOKEN_KEY, token);
      this.syncPreviewCookie(token);
    }
  }

  /**
   * 把令牌同步到预览 Cookie，供 <img>/<audio> 等带不上 Authorization 头的
   * 静态资源请求（/resources/…）通过鉴权。与后端 auth_middleware 的
   * Cookie 兜底路径保持一致。
   */
  private syncPreviewCookie(token: string) {
    document.cookie = `${PREVIEW_TOKEN_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=86400; SameSite=Strict`;
  }

  /**
   * 获取token
   */
  getToken(): string | null {
    return this.token;
  }

  /**
   * 浏览器 WebSocket 无法设置认证头，使用同源 URL 的查询参数传递当前令牌。
   */
  getWebSocketUrl(): string {
    const url = new URL('/', window.location.origin);
    url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    if (this.token) {
      url.searchParams.set('token', this.token);
    }
    return url.toString();
  }

  /**
   * 清除token
   */
  clearToken() {
    this.token = null;
    if (typeof window !== 'undefined') {
      localStorage.removeItem(TOKEN_KEY);
      document.cookie = `${PREVIEW_TOKEN_COOKIE}=; Path=/; Max-Age=0; SameSite=Strict`;
    }
  }

  /**
   * 检查是否已认证
   */
  isAuthenticated(): boolean {
    return !!this.token;
  }

  /**
   * 拦截fetch请求，自动添加认证头
   */
  private interceptFetch() {
    if (typeof window === 'undefined') return;

    const originalFetch = window.fetch;
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const options = init || {};
      
      // 只为相对路径或同域请求添加认证头
      const url = input instanceof URL ? input.toString() : input.toString();
      const isApiRequest = this.isProtectedApiRequest(url);
      
      if (isApiRequest && this.token) {
        if (!options.headers) {
          options.headers = {};
        }
        
        const headers = options.headers as Record<string, string>;
        headers['Authorization'] = `Bearer ${this.token}`;
        headers['X-Access-Token'] = this.token;
      }

      try {
        const response = await originalFetch(input, options);
        
        // 只有受保护的本地 API 返回鉴权失败时，才清除 token。
        // 外部请求（例如 GitHub Star 数）失败不应该影响登录态。
        if (isApiRequest && (response.status === 401 || response.status === 403)) {
          this.clearToken();
          window.location.href = '/qce/auth';
          return response;
        }
        
        return response;
      } catch (error) {
        throw error;
      }
    };
  }

  private isProtectedApiRequest(url: string): boolean {
    if (url.startsWith('/')) {
      return true;
    }

    try {
      const parsedUrl = new URL(url, window.location.origin);
      const isSameOrigin = parsedUrl.origin === window.location.origin;
      const isLocalhostOrigin = ['127.0.0.1', 'localhost'].includes(parsedUrl.hostname);

      return isSameOrigin || isLocalhostOrigin;
    } catch {
      return false;
    }
  }
}

export default AuthManager;
