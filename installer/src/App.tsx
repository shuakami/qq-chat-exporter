import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Check,
  Folder,
  X,
  ChevronLeft,
  ChevronDown,
  ExternalLink,
} from 'lucide-react';

import { motion, AnimatePresence } from 'framer-motion';

import api, {
  type InstallProgress,
  type QuickLoginAccount,
  type PackageKind,
} from './tauri';

type InstallStep = 'welcome' | 'installing' | 'complete' | 'setup';
type SetupStep = 'intro' | 'login' | 'warning' | 'configuring' | 'done' | 'running';
type Direction = 'forward' | 'back' | 'none';

interface LoaderProps {
  size?: number;
  className?: string;
}

const Loader = ({ size = 16, className = '' }: LoaderProps) => (
  <svg
    className={`animate-spin ${className}`}
    height={size}
    width={size}
    strokeLinejoin="round"
    style={{ color: 'currentcolor' }}
    viewBox="0 0 16 16"
  >
    <g clipPath="url(#loader-clip)">
      <path d="M8 0V4" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 16V12" opacity="0.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3.29773 1.52783L5.64887 4.7639" opacity="0.9" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12.7023 1.52783L10.3511 4.7639" opacity="0.1" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12.7023 14.472L10.3511 11.236" opacity="0.4" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3.29773 14.472L5.64887 11.236" opacity="0.6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M15.6085 5.52783L11.8043 6.7639" opacity="0.2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M0.391602 10.472L4.19583 9.23598" opacity="0.7" stroke="currentColor" strokeWidth="1.5" />
      <path d="M15.6085 10.4722L11.8043 9.2361" opacity="0.3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M0.391602 5.52783L4.19583 6.7639" opacity="0.8" stroke="currentColor" strokeWidth="1.5" />
    </g>
    <defs>
      <clipPath id="loader-clip">
        <rect fill="white" height="16" width="16" />
      </clipPath>
    </defs>
  </svg>
);

// --- Modern Components ---

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  className = '',
  disabled,
  ...props
}) => {
  const baseStyles =
    'inline-flex items-center justify-center font-medium transition-colors duration-200 select-none focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed rounded-md';

  const variants = {
    primary: 'bg-[#1E7AD4] text-white hover:bg-[#1665b0] active:bg-[#125393] border border-transparent',
    secondary: 'bg-white text-[var(--color-text)] border border-[var(--color-border)] hover:bg-[#F7F7F5] active:bg-[#EFEFEE]',
    ghost: 'bg-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[#EFEFEE]',
  };

  const sizes = {
    sm: 'text-[12px] px-2 h-6',
    md: 'text-[13px] px-3 h-8',
    lg: 'text-[13px] px-4 h-9',
  };

  const widthClass = fullWidth ? 'w-full' : '';

  return (
    <button
      className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${widthClass} ${className}`}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
};

const ModernCheckbox = ({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) => (
  <div
    onClick={onChange}
    className="group flex items-center gap-2.5 py-1.5 cursor-pointer transition-colors select-none"
  >
    <div
      className={`
      w-3.5 h-3.5 rounded-[4px] border flex items-center justify-center transition-all duration-200 ease-out shrink-0
      ${
        checked
          ? 'bg-[#1E7AD4] border-[#1E7AD4]'
          : 'bg-[var(--color-card-bg)] border-[var(--color-border)] group-hover:border-[var(--color-text-secondary)]'
      }
    `}
    >
      <Check size={9} className={`text-white transition-transform duration-200 ${checked ? 'scale-100' : 'scale-0'}`} strokeWidth={3} />
    </div>
    <div className="text-[12px] font-medium text-[var(--color-text)]">{label}</div>
  </div>
);

const SuccessAnimation = () => (
  <div className="flex flex-col items-center gap-4 mb-6">
    <motion.div
      initial={{ scale: 0.85, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className="relative flex items-center justify-center text-[#1E7AD4]"
    >
      <svg viewBox="0 0 100 100" className="w-16 h-16 overflow-visible">
        <motion.circle
          cx="50"
          cy="50"
          r="44"
          fill="none"
          stroke="currentColor"
          strokeWidth="6"
          strokeLinecap="round"
          initial={{ pathLength: 0, rotate: -90 }}
          animate={{ pathLength: 1 }}
          style={{ transformOrigin: 'center' }}
          transition={{ duration: 0.45, ease: [0.65, 0, 0.35, 1] }}
        />
        <motion.path
          d="M32 52 L44 64 L68 38"
          fill="none"
          stroke="currentColor"
          strokeWidth="6.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.3, delay: 0.35, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
    </motion.div>
  </div>
);

const INSTALL_TIPS = [
  '快速导出多年 QQ 聊天记录，保留珍贵回忆',
  '支持导出为 HTML、PDF、TXT、JSON 多种格式',
  '自动解析语音、图片、视频等多媒体文件',
  '本地离线运行，绝对保障您的隐私安全',
  '支持按群聊、私聊、时间段精确筛选导出内容',
  '界面美观，导出结果支持搜索与高亮显示',
];

const FRAMEWORK_DOWNLOAD_URL = 'https://github.com/shuakami/qq-chat-exporter/releases/latest';

const isAlreadyLoggedIn = (msg: string) =>
  msg.includes('已登录') || /is\s*logined|already\s*log/i.test(msg);

export default function App() {
  const [step, setStep] = useState<InstallStep>('welcome');
  const [setupStep, setSetupStep] = useState<SetupStep>('intro');
  const [loginMethod, setLoginMethod] = useState<'quick' | 'qrcode'>('quick');
  const [setupProgress, setSetupProgress] = useState(0);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [direction, setDirection] = useState<Direction>('none');
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [currentLog, setCurrentLog] = useState('准备安装环境...');
  const [progress, setProgress] = useState(0);
  const [activeTipIndex, setActiveTipIndex] = useState(0);

  const [installPath, setInstallPath] = useState('');
  const [freeSpace, setFreeSpace] = useState<number>(0);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isClosingAdvanced, setIsClosingAdvanced] = useState(false);

  const [packageKind, setPackageKind] = useState<PackageKind>('shell');
  const [accounts, setAccounts] = useState<QuickLoginAccount[]>([]);
  const [selectedUin, setSelectedUin] = useState<string>('');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [loginError, setLoginError] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [webuiUrl, setWebuiUrl] = useState<string>('');
  const [setupHint, setSetupHint] = useState('请稍候，我们正在为您初始化导出组件...');

  const [options, setOptions] = useState({ shortcut: true, autoStart: false });

  const tipsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const qrPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedAccount = accounts.find((a) => a.uin === selectedUin) ?? null;

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Detect an existing installation (launched from the desktop shortcut or
  // autostart) and skip straight to the setup flow; otherwise prepare the
  // default install path for a fresh install.
  useEffect(() => {
    (async () => {
      try {
        const installed = await api.getInstallState();
        if (installed) {
          setInstallPath(installed);
          setStep('setup');
          setSetupStep('login');
          return;
        }
      } catch {
        /* fall through to fresh-install flow */
      }
      try {
        // Prefer the previously-used dir (upgrade scenario) over the default.
        const saved = await api.getSavedInstallDir();
        const path = saved || await api.getDefaultInstallDir();
        setInstallPath(path);
        const space = await api.getFreeSpace(path);
        setFreeSpace(space);
      } catch {
        setInstallPath('C:\\QQChatExporter');
      }
    })();
  }, []);

  const handleChangePath = async () => {
    try {
      const selected = await api.pickDirectory();
      if (selected && typeof selected === 'string') {
        const cleanPath = selected.replace(/[\\/]+$/, '');
        const finalPath = `${cleanPath}\\QQChatExporter`;
        setInstallPath(finalPath);
        const space = await api.getFreeSpace(finalPath);
        setFreeSpace(space);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const formatSpace = (bytes: number): string => (bytes / 1024 ** 3).toFixed(1) + ' GB';

  const navigate = (nextStep: InstallStep) => {
    if (step === 'welcome' && nextStep === 'installing') setDirection('forward');
    else if (step === 'installing' && nextStep === 'complete') setDirection('forward');
    else if (step === 'complete' && nextStep === 'setup') setDirection('forward');
    else setDirection('none');
    void direction;
    setStep(nextStep);
  };

  // Tips Rotation
  useEffect(() => {
    if (step === 'installing') {
      tipsTimerRef.current = setInterval(() => {
        setActiveTipIndex((prev) => (prev + 1) % INSTALL_TIPS.length);
      }, 5000);
    }
    return () => {
      if (tipsTimerRef.current) clearInterval(tipsTimerRef.current);
    };
  }, [step]);

  // Real installation process
  useEffect(() => {
    if (step !== 'installing') return;
    let unlisten: (() => void) | null = null;
    (async () => {
      unlisten = await api.onInstallProgress((data: InstallProgress) => {
        setProgress(data.percent);
        setCurrentLog(data.message);
        if (data.phase === 'Done') setTimeout(() => navigate('complete'), 800);
        if (data.phase === 'Error') setCurrentLog(`安装失败：${data.message}`);
      });
      try {
        await api.startInstall({
          installPath,
          createShortcut: options.shortcut,
          autoStart: options.autoStart,
        });
      } catch (err) {
        setCurrentLog(`安装失败：${String(err)}`);
      }
    })();
    return () => {
      if (unlisten) unlisten();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // When entering the login step, start the service so we can query NapCat.
  useEffect(() => {
    if (step !== 'setup' || setupStep !== 'login') return;
    let cancelled = false;
    (async () => {
      setBusy(true);
      setLoginError('');
      try {
        setPackageKind(await api.detectPackageKind());
        await api.startService();
        // NapCat needs a few seconds to boot its WebUI; retry up to 15 times
        // with a 2-second gap so we don't give up before it's ready. An empty
        // list right after boot usually means NapCat hasn't enumerated the
        // login history yet, so keep retrying until it's non-empty.
        let list: Awaited<ReturnType<typeof api.getQuickLoginList>> = [];
        for (let attempt = 0; attempt < 15; attempt++) {
          if (cancelled) return;
          try {
            list = await api.getQuickLoginList();
            if (list.length > 0) break;
          } catch {
            /* WebUI not up yet, or auth not ready — retry below */
          }
          if (attempt < 14) await new Promise((r) => setTimeout(r, 2000));
        }
        if (cancelled) return;
        setAccounts(list);
        if (list.length > 0) {
          setSelectedUin((prev) => prev || list[0].uin);
          setLoginMethod('quick');
        } else {
          setLoginMethod('qrcode');
        }
      } catch (err) {
        if (!cancelled) {
          setLoginError(String(err));
          setLoginMethod('qrcode');
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [step, setupStep]);

  // QR-code lifecycle: fetch a code and poll for completion.
  useEffect(() => {
    if (step !== 'setup' || setupStep !== 'login' || loginMethod !== 'qrcode') return;
    let cancelled = false;
    (async () => {
      try {
        const dataUrl = await api.getQrCode();
        if (!cancelled) setQrDataUrl(dataUrl);
      } catch (err) {
        if (!cancelled) setLoginError(String(err));
      }
    })();
    qrPollRef.current = setInterval(async () => {
      try {
        const done = await api.getLoginStatus();
        if (done && !cancelled) {
          if (qrPollRef.current) clearInterval(qrPollRef.current);
          startConfiguring();
        }
      } catch {
        /* keep polling */
      }
    }, 2000);
    return () => {
      cancelled = true;
      if (qrPollRef.current) clearInterval(qrPollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, setupStep, loginMethod]);

  const handleQuickAuthorize = useCallback(async () => {
    if (!selectedAccount) return;
    setBusy(true);
    setLoginError('');
    try {
      // Shell 版本无法与桌面 QQ 共存：若该账号已在线，需要先退出 QQ。
      if (packageKind === 'shell' && (await api.isAccountOnline(selectedAccount.uin))) {
        setSetupStep('warning');
        return;
      }
      const res = await api.quickLogin(selectedAccount.uin);
      if (!res.ok) {
        const err = res.error || '快速登录失败';
        // NapCat returns this when the account is already logged in via
        // desktop QQ — route to the kill-QQ confirmation instead of just
        // showing an error string. The WebUI backend replies with the English
        // "QQ Is Logined" while the shell core uses "当前账号(x)已登录".
        if (isAlreadyLoggedIn(err)) {
          setSetupStep('warning');
          return;
        }
        setLoginError(err);
        return;
      }
      startConfiguring();
    } catch (err) {
      const msg = String(err);
      if (isAlreadyLoggedIn(msg)) {
        setSetupStep('warning');
        return;
      }
      setLoginError(msg);
    } finally {
      setBusy(false);
    }
  }, [selectedAccount, packageKind]);

  const handleConfirmKillAndLogin = useCallback(async () => {
    if (!selectedAccount) return;
    setBusy(true);
    setLoginError('');
    try {
      await api.killQq();
      // Give NapCat a moment to detect the process exit before retrying.
      await new Promise((r) => setTimeout(r, 2000));
      const res = await api.quickLogin(selectedAccount.uin);
      if (!res.ok) {
        setLoginError(res.error || '快速登录失败');
        setSetupStep('login');
        return;
      }
      startConfiguring();
    } catch (err) {
      setLoginError(String(err));
      setSetupStep('login');
    } finally {
      setBusy(false);
    }
  }, [selectedAccount]);

  const startConfiguring = useCallback(() => {
    setSetupStep('configuring');
    setSetupProgress(8);
    let unlisten: (() => void) | null = null;
    api
      .onConfigureProgress((p) => {
        setSetupProgress(p.percent);
        if (p.message) setSetupHint(p.message);
      })
      .then((fn) => (unlisten = fn));
    // Poll QCE until it reports running, then advance.
    const poll = setInterval(async () => {
      try {
        const info = await api.isQceRunning();
        if (info.running) {
          clearInterval(poll);
          if (unlisten) unlisten();
          setSetupProgress(100);
          if (info.webuiUrl) setWebuiUrl(info.webuiUrl);
          setTimeout(() => setSetupStep('done'), 400);
        }
      } catch {
        /* keep polling */
      }
    }, 1500);
  }, []);

  const enterRunning = useCallback(async () => {
    setSetupStep('running');
    try {
      const url = webuiUrl || (await api.getWebuiUrl()) || '';
      setWebuiUrl(url);
    } catch {
      /* ignore */
    }
  }, [webuiUrl]);

  const handleExit = useCallback(async () => {
    try {
      await api.exitApp();
    } catch {
      await api.closeWindow();
    }
  }, []);

  const getAnimationClass = () => (step === 'welcome' ? '' : 'animate-fade-in');

  return (
    <div className="w-full h-full bg-[var(--color-bg)] flex flex-col overflow-hidden font-sans antialiased text-[var(--color-text)] relative">
      {/* Minimal Header (draggable) */}
      <div
        className="absolute top-0 left-0 w-full h-10 flex items-center justify-end px-5 z-20 select-none border-b border-transparent"
        data-tauri-drag-region
      >
        {!showAdvanced && (
          <button
            onClick={() => api.closeWindow()}
            className="text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors p-1 rounded-md hover:bg-[var(--color-hover)]"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Content Area */}
      <div key={step} className={`flex-1 flex flex-col p-8 ${getAnimationClass()}`}>
        {/* STEP: WELCOME */}
        {step === 'welcome' && (
          <div className="flex-1 flex flex-col relative">
            <div className="flex-1 flex flex-col justify-center items-center text-center">
              <h1 className="text-[22px] font-bold tracking-tight text-[var(--color-text)] mb-2">
                安装 QQ Chat Exporter
              </h1>
              <p className="text-[var(--color-text-secondary)] text-[14px] mb-8 font-medium">
                轻松导出、备份与搜索您的聊天记录
              </p>
              <div className="w-full max-w-[280px]">
                <Button fullWidth size="lg" onClick={() => navigate('installing')} className="h-10 font-medium">
                  开始安装
                </Button>
              </div>
            </div>

            <div className="mt-auto w-full flex flex-col items-center gap-2.5 pb-2">
              <span className="text-[11px] text-[var(--color-text-tertiary)]">
                本软件为完全免费的开源项目，严禁用于任何商业牟利
              </span>
              <div className="flex items-center justify-center gap-6 w-full text-[11px] font-medium text-[var(--color-text-tertiary)]">
                <span>v6.0.0 beta</span>
                <button
                  onClick={() => setShowAdvanced(true)}
                  className="hover:text-[var(--color-text)] transition-colors underline decoration-dotted underline-offset-2"
                >
                  自定义安装
                </button>
                <button
                  onClick={() => api.openUrl('https://github.com/shuakami/qq-chat-exporter')}
                  className="flex items-center gap-1.5 hover:text-[var(--color-text)] transition-colors cursor-pointer"
                >
                  <span>GitHub</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ADVANCED INSTALLATION (Overlay) */}
        {showAdvanced && step === 'welcome' && (
          <div className={`absolute inset-0 bg-[var(--color-bg)] z-30 flex flex-col p-8 ${isClosingAdvanced ? 'animate-fade-out' : 'animate-fade-in'}`}>
            <div className="absolute top-0 right-0 h-10 flex items-center px-5">
              <button
                onClick={() => {
                  setIsClosingAdvanced(true);
                  setTimeout(() => {
                    setShowAdvanced(false);
                    setIsClosingAdvanced(false);
                  }, 200);
                }}
                className="text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors p-1 rounded-md hover:bg-[var(--color-hover)]"
              >
                <X size={14} />
              </button>
            </div>

            <div className="flex-1 flex flex-col">
              <div className="mb-6 animate-fade-in delay-75 opacity-0 fill-mode-forwards">
                <h2 className="text-lg font-bold text-[var(--color-text)] mb-1">安装设置</h2>
                <p className="text-[var(--color-text-secondary)] text-[13px]">选择安装位置和配置选项</p>
              </div>

              <div className="flex-1 flex flex-col gap-5 animate-fade-in delay-100 opacity-0 fill-mode-forwards">
                <div>
                  <label className="block text-[12px] font-medium text-[var(--color-text)] mb-1.5 ml-1">安装路径</label>
                  <div className="group flex items-center bg-[var(--color-bg-secondary)] transition-colors rounded-md px-2 h-9 w-full focus-within:bg-[var(--color-input-bg)]">
                    <Folder size={14} className="text-[var(--color-text-tertiary)] ml-1 mr-2.5 shrink-0" />
                    <input
                      type="text"
                      value={installPath}
                      readOnly
                      className="flex-1 bg-transparent text-[13px] font-medium text-[var(--color-text)] outline-none w-full font-mono cursor-default min-w-0 truncate"
                    />
                    <button
                      onClick={handleChangePath}
                      className="text-[11px] font-semibold text-[#1E7AD4] hover:text-[#1665b0] px-2 py-1 rounded-md transition-colors ml-1 shrink-0"
                    >
                      更改
                    </button>
                  </div>
                  <p className="text-[11px] text-[var(--color-text-tertiary)] mt-1.5 ml-1">
                    可用空间：{freeSpace > 0 ? formatSpace(freeSpace) : '计算中...'}
                  </p>
                </div>

                <div>
                  <label className="block text-[12px] font-medium text-[var(--color-text)] mb-1.5 ml-1">安装选项</label>
                  <div className="space-y-0.5 ml-1">
                    <ModernCheckbox label="创建桌面快捷方式" checked={options.shortcut} onChange={() => setOptions((p) => ({ ...p, shortcut: !p.shortcut }))} />
                    <ModernCheckbox label="开机自动启动" checked={options.autoStart} onChange={() => setOptions((p) => ({ ...p, autoStart: !p.autoStart }))} />
                  </div>
                </div>
              </div>

              <div className="mt-auto flex items-center justify-between pt-2 animate-fade-in delay-200 opacity-0 fill-mode-forwards">
                <button
                  onClick={() => {
                    setIsClosingAdvanced(true);
                    setTimeout(() => {
                      setShowAdvanced(false);
                      setIsClosingAdvanced(false);
                    }, 200);
                  }}
                  className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors px-2 py-2"
                >
                  <ChevronLeft size={14} />
                  返回
                </button>
                <Button
                  onClick={() => {
                    setShowAdvanced(false);
                    setIsClosingAdvanced(false);
                    navigate('installing');
                  }}
                  size="lg"
                  className="h-9 px-6 font-medium"
                >
                  立即安装
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* STEP: INSTALLING */}
        {step === 'installing' && (
          <div className="flex-1 flex flex-col justify-center items-center max-w-sm mx-auto w-full">
            <div className="text-center w-full animate-fade-in delay-100 opacity-0 fill-mode-forwards">
              <h2 className="text-[15px] font-bold text-[var(--color-text)] mb-2">正在安装 QQ Chat Exporter...</h2>
              <div className="h-[20px] flex items-center justify-center mb-4">
                <span className="text-[13px] text-[var(--color-text-tertiary)] font-medium truncate px-4">{currentLog}</span>
              </div>
              <div className="w-full h-1 bg-[var(--color-bg-secondary)] rounded-full overflow-hidden mb-2">
                <motion.div
                  className="h-full bg-[#1E7AD4] rounded-full"
                  initial={{ width: '0%' }}
                  animate={{ width: `${progress}%` }}
                  transition={{ type: 'spring', stiffness: 90, damping: 20, mass: 1 }}
                />
              </div>
            </div>

            <div className="mt-2 w-full animate-fade-in delay-200 opacity-0 fill-mode-forwards">
              <div className="relative h-12 w-full overflow-hidden flex items-center justify-center">
                {INSTALL_TIPS.map((tip, idx) => (
                  <div
                    key={idx}
                    className={`absolute top-0 left-0 w-full h-full flex items-center justify-center transition-all duration-700 ease-in-out ${idx === activeTipIndex ? 'opacity-100 blur-0 z-10' : 'opacity-0 blur-sm z-0'}`}
                  >
                    <p className="text-[12px] text-[var(--color-text-secondary)] leading-relaxed text-center">{tip}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* STEP: COMPLETE */}
        {step === 'complete' && (
          <div className="flex-1 flex flex-col items-center justify-center text-center">
            <SuccessAnimation />
            <h2 className="text-xl font-bold text-[var(--color-text)] mb-2 animate-fade-in delay-100 opacity-0 fill-mode-forwards">安装完成</h2>
            <p className="text-[var(--color-text-secondary)] text-[13px] max-w-xs leading-relaxed mb-8 animate-fade-in delay-150 opacity-0 fill-mode-forwards">
              QQ Chat Exporter 已成功安装到您的计算机。
            </p>
            <div className="w-full max-w-[200px] space-y-3 animate-fade-in delay-200 opacity-0 fill-mode-forwards">
              <Button fullWidth size="lg" onClick={() => navigate('setup')} className="h-9 font-medium">
                立即体验
              </Button>
              <button onClick={() => api.closeWindow()} className="text-[12px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors py-1">
                关闭
              </button>
            </div>
          </div>
        )}

        {/* STEP: SETUP (Main Application Onboarding) */}
        {step === 'setup' && (
          <div key={setupStep} className="flex-1 flex flex-col justify-center items-center w-full mx-auto h-full px-4 animate-fade-in">
            {setupStep === 'intro' && (
              <div className="flex flex-col items-center justify-center text-center w-full mt-4">
                <h2 className="text-[20px] font-bold tracking-tight text-[var(--color-text)] mb-3">欢迎使用</h2>
                <p className="text-[var(--color-text-secondary)] text-[13px] leading-relaxed mb-8 px-2 max-w-[260px]">
                  在正式进入主界面前，我们需要连接并授权您的账号数据。
                </p>
                <div className="w-full max-w-[240px]">
                  <Button fullWidth size="lg" onClick={() => setSetupStep('login')} className="h-9 font-medium">
                    开始配置
                  </Button>
                </div>
              </div>
            )}

            {setupStep === 'login' && (
              <div className="flex flex-col items-center w-full h-full pt-8">
                <div className="text-center mb-6">
                  <h2 className="text-[18px] font-bold text-[var(--color-text)] mb-1.5 tracking-tight">账号登录</h2>
                  <p className="text-[var(--color-text-secondary)] text-[13px]">
                    {loginMethod === 'quick' ? '请选择需要登录的账号' : '请使用手机端扫码授权'}
                  </p>
                </div>

                {loginMethod === 'quick' ? (
                  <div ref={dropdownRef} className="w-[240px] mb-6 relative select-none">
                    <div
                      onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                      className="w-full flex items-center justify-between py-2 px-3 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] hover:bg-[var(--color-hover)] transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-3 overflow-hidden">
                        {selectedAccount?.faceUrl && (
                          <img src={selectedAccount.faceUrl} alt="avatar" className="w-6 h-6 rounded-full bg-[var(--color-bg-secondary)] shrink-0" />
                        )}
                        <span className="text-[13px] font-medium text-[var(--color-text)] truncate inline-flex items-center gap-1.5">
                          {busy && <Loader size={13} />}
                          {selectedAccount ? selectedAccount.nickName || '未命名' : busy ? '正在获取账号...' : '无可用账号'}
                          {selectedAccount && (
                            <span className="text-[12px] text-[var(--color-text-tertiary)] font-normal ml-1">({selectedAccount.uin})</span>
                          )}
                        </span>
                      </div>
                      <div className="text-[var(--color-text-tertiary)] shrink-0 transition-transform duration-200" style={{ transform: isDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>
                        <ChevronDown size={14} strokeWidth={2} />
                      </div>
                    </div>

                    <AnimatePresence>
                      {isDropdownOpen && accounts.length > 0 && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.96 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.1 } }}
                          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                          className="absolute top-[calc(100%+8px)] left-0 w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded-2xl shadow-[0_16px_40px_-8px_rgba(0,0,0,0.06)] z-50 flex flex-col p-1.5 max-h-[200px] overflow-y-auto"
                        >
                          {accounts.map((acc) => (
                            <div
                              key={acc.uin}
                              className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-[var(--color-hover)] cursor-pointer transition-colors"
                              onClick={() => {
                                setSelectedUin(acc.uin);
                                setIsDropdownOpen(false);
                              }}
                            >
                              {acc.faceUrl && <img src={acc.faceUrl} alt="avatar" className="w-6 h-6 rounded-full bg-[var(--color-bg-secondary)] shrink-0" />}
                              <span className="text-[13px] font-medium text-[var(--color-text)] truncate">
                                {acc.nickName || '未命名'}
                                <span className="text-[12px] text-[var(--color-text-tertiary)] font-normal ml-1">({acc.uin})</span>
                              </span>
                            </div>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                ) : (
                  <div className="w-full flex justify-center mb-6">
                    {qrDataUrl ? (
                      <img src={qrDataUrl} alt="QR Code" className="w-[140px] h-[140px]" />
                    ) : (
                      <div className="w-[140px] h-[140px] flex items-center justify-center text-[12px] text-[var(--color-text-tertiary)]">
                        正在生成二维码...
                      </div>
                    )}
                  </div>
                )}

                {loginError && <p className="text-[12px] text-[#E54D2E] mb-3 max-w-[260px] text-center">{loginError}</p>}

                <div className="flex items-center gap-4 text-[12px] font-medium text-[var(--color-text-secondary)]">
                  <button
                    onClick={() => setLoginMethod((prev) => (prev === 'quick' ? 'qrcode' : 'quick'))}
                    className="hover:text-[var(--color-text)] transition-colors underline decoration-dotted underline-offset-2"
                  >
                    {loginMethod === 'quick' ? '二维码登录' : '快速登录'}
                  </button>
                </div>

                {loginMethod === 'quick' && (
                  <div className="w-full mt-auto mb-4 max-w-[240px]">
                    <Button fullWidth size="lg" onClick={handleQuickAuthorize} disabled={!selectedAccount || busy} className="h-9 text-[13px] font-medium">
                      {busy ? <><Loader size={14} className="mr-1.5" /> 处理中...</> : '授权登录'}
                    </Button>
                  </div>
                )}
              </div>
            )}

            {setupStep === 'warning' && (
              <div className="flex-1 flex flex-col items-center justify-center text-center w-full px-6">
                <h2 className="text-[19px] font-bold tracking-tight text-[var(--color-text)] mb-3">环境冲突警告</h2>
                <p className="text-[var(--color-text-secondary)] text-[13px] leading-relaxed mb-6 max-w-[280px]">
                  检测到您安装的是 Shell 版本，且该账号的 QQ 正在运行中。为了保证导出数据的完整性，我们必须先退出您当前运行的 QQ。
                </p>
                <div className="text-[12px] text-[var(--color-text-tertiary)] mb-8 flex flex-col items-center gap-1.5">
                  <span>如果您需要两者同时运行，请下载</span>
                  <button
                    onClick={() => api.openUrl(FRAMEWORK_DOWNLOAD_URL)}
                    className="inline-flex items-center gap-1 mt-0.5 hover:text-[var(--color-text)] transition-colors underline decoration-dotted underline-offset-2 cursor-pointer font-medium"
                  >
                    <span>Framework 版本</span>
                    <ExternalLink size={11} strokeWidth={2.5} />
                  </button>
                </div>
                <div className="w-full max-w-[240px] flex flex-col gap-3">
                  <Button fullWidth size="lg" onClick={handleConfirmKillAndLogin} disabled={busy} className="h-9 font-medium">
                    {busy ? <><Loader size={14} className="mr-1.5" /> 处理中...</> : '同意退出 QQ 并继续'}
                  </Button>
                  <button onClick={() => setSetupStep('login')} className="text-[12px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors py-1">
                    返回上一步
                  </button>
                </div>
              </div>
            )}

            {setupStep === 'configuring' && (
              <div className="flex-1 flex flex-col justify-center items-center max-w-sm mx-auto w-full">
                <div className="text-center w-full animate-fade-in delay-100 opacity-0 fill-mode-forwards">
                  <h2 className="text-[15px] font-bold text-[var(--color-text)] mb-2">正在配置环境...</h2>
                  <div className="h-[20px] flex items-center justify-center mb-4">
                    <span className="text-[13px] text-[var(--color-text-tertiary)] font-medium truncate px-4">{setupHint}</span>
                  </div>
                  <div className="w-full h-1 bg-[var(--color-bg-secondary)] rounded-full overflow-hidden mb-2">
                    <motion.div
                      className="h-full bg-[#1E7AD4] rounded-full"
                      initial={{ width: '0%' }}
                      animate={{ width: `${setupProgress}%` }}
                      transition={{ type: 'spring', stiffness: 90, damping: 20, mass: 1 }}
                    />
                  </div>
                </div>
              </div>
            )}

            {setupStep === 'done' && (
              <div className="flex-1 flex flex-col items-center justify-center text-center">
                <SuccessAnimation />
                <h2 className="text-xl font-bold text-[var(--color-text)] mb-2">配置完成</h2>
                <p className="text-[var(--color-text-secondary)] text-[13px] max-w-xs leading-relaxed mb-8">
                  您可以开始导出与搜索聊天记录了。
                </p>
                <div className="w-full max-w-[200px] space-y-3">
                  <Button fullWidth size="lg" onClick={enterRunning} className="h-9 font-medium">
                    进入软件
                  </Button>
                  <button onClick={() => api.closeWindow()} className="text-[12px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors py-1">
                    关闭
                  </button>
                </div>
              </div>
            )}

            {setupStep === 'running' && (
              <div className="flex-1 flex flex-col items-center justify-center text-center w-full max-w-sm mx-auto animate-fade-in">
                <h2 className="text-[16px] font-bold text-[var(--color-text)] mb-1">服务运行中</h2>
                <p className="text-[var(--color-text-secondary)] text-[12px] mb-8">QQ Chat Exporter 正在后台运行</p>

                <div className="w-full bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-lg p-3 mb-8">
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-medium text-[var(--color-text-secondary)]">WebUI 链接</span>
                    <button
                      onClick={() => webuiUrl && api.openUrl(webuiUrl)}
                      className="text-[13px] font-medium text-[#1E7AD4] hover:text-[#1665b0] hover:underline flex items-center gap-1 max-w-[220px] truncate"
                    >
                      {webuiUrl || 'http://127.0.0.1:40653'} <ExternalLink size={12} />
                    </button>
                  </div>
                </div>

                <div className="w-full max-w-[200px] flex flex-col items-center space-y-3">
                  <Button fullWidth size="lg" onClick={() => webuiUrl && api.openUrl(webuiUrl)} className="h-9 font-medium">
                    打开 WebUI
                  </Button>
                  <Button fullWidth size="lg" variant="secondary" onClick={() => api.openLogFile()} className="h-9 font-medium">
                    查看运行日志
                  </Button>
                  <button onClick={() => setShowExitConfirm(true)} className="text-[12px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors py-1">
                    退出服务并关闭
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <AnimatePresence>
          {showExitConfirm && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/40 z-[100] flex items-center justify-center"
            >
              <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-[var(--color-bg)] rounded-[12px] border border-[var(--color-border)] shadow-xl w-[320px] overflow-hidden">
                <div className="p-6 text-center">
                  <h3 className="text-[16px] font-bold text-[var(--color-text)] mb-2">确认退出</h3>
                  <p className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed mb-6">
                    退出后后台服务将停止，无法继续导出与搜索聊天记录。确定要退出吗？
                  </p>
                  <div className="flex gap-3 justify-center">
                    <button onClick={() => setShowExitConfirm(false)} disabled={exiting} className="px-6 py-2 rounded-md bg-transparent hover:bg-[var(--color-hover)] text-[13px] font-medium text-[var(--color-text)] border border-[var(--color-border)] transition-colors disabled:opacity-50">
                      取消
                    </button>
                    <button
                      onClick={async () => { setExiting(true); await handleExit(); }}
                      disabled={exiting}
                      className="px-6 py-2 rounded-md text-[13px] font-medium text-white bg-[#E54D2E] hover:bg-[#ce4529] transition-colors inline-flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {exiting ? <><Loader size={14} /> 退出中...</> : '确认退出'}
                    </button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
