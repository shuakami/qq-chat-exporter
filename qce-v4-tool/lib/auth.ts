/**
 * 认证工具库
 */

const TOKEN_KEY = 'qce_access_token';

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
   * 初始化认证（检查URL参数）
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

    // 如果没有token，重定向到认证页面
    if (!this.token) {
      window.location.href = '/qce-v4-tool/auth';
      return;
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
    }
  }

  /**
   * 获取token
   */
  getToken(): string | null {
    return this.token;
  }

  /**
   * 清除token
   */
  clearToken() {
    this.token = null;
    if (typeof window !== 'undefined') {
      localStorage.removeItem(TOKEN_KEY);
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
      const isApiRequest = url.startsWith('/api') || url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost');
      
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
        
        // 如果返回401或403，清除token并重定向
        if (response.status === 401 || response.status === 403) {
          this.clearToken();
          window.location.href = '/qce-v4-tool/auth';
          return response;
        }
        
        return response;
      } catch (error) {
        throw error;
      }
    };
  }
}

export default AuthManager;