import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import api, { type UninstallProgress } from './tauri';

type Step = 'loading' | 'confirm' | 'uninstalling' | 'complete' | 'not-found';

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

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'danger' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
}

const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'danger',
  size = 'md',
  fullWidth = false,
  className = '',
  disabled,
  ...props
}) => {
  const baseStyles =
    'inline-flex items-center justify-center font-medium transition-colors duration-200 select-none focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed rounded-md';

  const variants = {
    danger:
      'bg-[var(--color-danger)] text-white hover:bg-[var(--color-danger-hover)] active:bg-[#b83a20] border border-transparent',
    secondary:
      'bg-[var(--color-card-bg)] text-[var(--color-text)] border border-[var(--color-border)] hover:bg-[var(--color-hover)] active:bg-[var(--color-bg-secondary)]',
    ghost:
      'bg-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-hover)]',
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
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: () => void;
}) => (
  <div
    onClick={onChange}
    className="group flex items-start gap-2.5 py-2 cursor-pointer transition-colors select-none"
  >
    <div
      className={`
      w-3.5 h-3.5 rounded-[4px] border flex items-center justify-center transition-all duration-200 ease-out shrink-0 mt-0.5
      ${
        checked
          ? 'bg-[var(--color-danger)] border-[var(--color-danger)]'
          : 'bg-[var(--color-card-bg)] border-[var(--color-border)] group-hover:border-[var(--color-text-secondary)]'
      }
    `}
    >
      <svg
        width="9"
        height="9"
        viewBox="0 0 24 24"
        fill="none"
        stroke="white"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`transition-transform duration-200 ${checked ? 'scale-100' : 'scale-0'}`}
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </div>
    <div className="flex flex-col">
      <div className="text-[12px] font-medium text-[var(--color-text)]">{label}</div>
      {description && (
        <div className="text-[11px] text-[var(--color-text-tertiary)] mt-0.5">{description}</div>
      )}
    </div>
  </div>
);

const SuccessAnimation = () => (
  <div className="flex flex-col items-center gap-4 mb-6">
    <motion.div
      initial={{ scale: 0.85, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className="relative flex items-center justify-center text-[var(--color-danger)]"
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

export default function App() {
  const [step, setStep] = useState<Step>('loading');
  const [keepData, setKeepData] = useState(true);
  const [progress, setProgress] = useState(0);
  const [currentLog, setCurrentLog] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const info = await api.getInstallInfo();
        if (info) {
          setStep('confirm');
        } else {
          setStep('not-found');
        }
      } catch {
        setStep('not-found');
      }
    })();
  }, []);

  const handleUninstall = async () => {
    setStep('uninstalling');
    setProgress(0);
    setCurrentLog('正在停止运行中的服务...');
    setError(null);

    const unlisten = await api.onUninstallProgress((data: UninstallProgress) => {
      setProgress(data.percent);
      setCurrentLog(data.message);
      if (data.phase === 'Done') {
        setTimeout(() => setStep('complete'), 600);
      }
      if (data.phase === 'Error') {
        setError(data.message);
      }
    });

    try {
      await api.startUninstall(keepData);
    } catch (err) {
      setError(String(err));
      setCurrentLog(`卸载失败：${String(err)}`);
    }

    return () => unlisten();
  };

  return (
    <div className="w-full h-full bg-[var(--color-bg)] flex flex-col overflow-hidden font-sans antialiased text-[var(--color-text)] relative">
      {/* Header (draggable) */}
      <div
        className="absolute top-0 left-0 w-full h-10 flex items-center justify-end px-5 z-20 select-none"
        data-tauri-drag-region
      >
        <button
          onClick={() => api.closeWindow()}
          className="text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors p-1 rounded-md hover:bg-[var(--color-hover)]"
        >
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 flex flex-col p-8">
        {/* LOADING */}
        {step === 'loading' && (
          <div className="flex-1 flex flex-col justify-center items-center">
            <Loader size={24} className="text-[var(--color-text-secondary)]" />
            <p className="text-[13px] text-[var(--color-text-secondary)] mt-4">
              正在检测安装信息...
            </p>
          </div>
        )}

        {/* NOT FOUND */}
        {step === 'not-found' && (
          <div className="flex-1 flex flex-col justify-center items-center text-center animate-fade-in">
            <h1 className="text-[20px] font-bold tracking-tight text-[var(--color-text)] mb-3">
              未检测到安装
            </h1>
            <p className="text-[var(--color-text-secondary)] text-[13px] leading-relaxed mb-8 max-w-[260px]">
              未在此计算机上找到 QQ Chat Exporter 的安装记录。可能已被手动删除。
            </p>
            <Button variant="secondary" size="lg" onClick={() => api.closeWindow()}>
              关闭
            </Button>
          </div>
        )}

        {/* CONFIRM */}
        {step === 'confirm' && (
          <div className="flex-1 flex flex-col relative animate-fade-in">
            <div className="flex-1 flex flex-col justify-center items-center text-center">
              <h1 className="text-[22px] font-bold tracking-tight text-[var(--color-text)] mb-2">
                卸载 QQ Chat Exporter
              </h1>
              <p className="text-[var(--color-text-secondary)] text-[14px] mb-6 font-medium">
                即将从您的计算机中移除此软件
              </p>

              {/* Options */}
              <div className="w-full max-w-[300px] mb-6 text-left animate-fade-in delay-100 opacity-0 fill-mode-forwards">
                <ModernCheckbox
                  label="保留导出的聊天记录"
                  description="卸载软件但保留已导出的数据文件"
                  checked={keepData}
                  onChange={() => setKeepData(!keepData)}
                />
              </div>

              <div className="w-full max-w-[280px] animate-fade-in delay-150 opacity-0 fill-mode-forwards">
                <Button
                  fullWidth
                  size="lg"
                  variant="danger"
                  onClick={handleUninstall}
                  className="h-10 font-medium"
                >
                  确认卸载
                </Button>
              </div>
            </div>

            <div className="mt-auto w-full flex justify-center pb-2">
              <button
                onClick={() => api.closeWindow()}
                className="text-[12px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors py-1"
              >
                取消
              </button>
            </div>
          </div>
        )}

        {/* UNINSTALLING */}
        {step === 'uninstalling' && (
          <div className="flex-1 flex flex-col justify-center items-center max-w-sm mx-auto w-full animate-fade-in">
            <div className="text-center w-full">
              <h2 className="text-[15px] font-bold text-[var(--color-text)] mb-2">
                正在卸载...
              </h2>
              <div className="h-[20px] flex items-center justify-center mb-4">
                <span className="text-[13px] text-[var(--color-text-tertiary)] font-medium truncate px-4">
                  {currentLog}
                </span>
              </div>
              <div className="w-full h-1 bg-[var(--color-bg-secondary)] rounded-full overflow-hidden mb-2">
                <motion.div
                  className="h-full bg-[var(--color-danger)] rounded-full"
                  initial={{ width: '0%' }}
                  animate={{ width: `${progress}%` }}
                  transition={{
                    type: 'spring',
                    stiffness: 90,
                    damping: 20,
                    mass: 1,
                  }}
                />
              </div>
              {error && (
                <p className="text-[12px] text-[var(--color-danger)] mt-4 max-w-[280px] mx-auto">
                  {error}
                </p>
              )}
            </div>
          </div>
        )}

        {/* COMPLETE */}
        {step === 'complete' && (
          <div className="flex-1 flex flex-col items-center justify-center text-center animate-fade-in">
            <SuccessAnimation />
            <h2 className="text-xl font-bold text-[var(--color-text)] mb-2 animate-fade-in delay-100 opacity-0 fill-mode-forwards">
              卸载完成
            </h2>
            <p className="text-[var(--color-text-secondary)] text-[13px] max-w-[300px] leading-relaxed mb-8 animate-fade-in delay-150 opacity-0 fill-mode-forwards">
              QQ Chat Exporter 已从电脑中移除。根据您的选择，我们
              {keepData ? '没有清理' : '已一并清理了'}导出的聊天记录。如果您是因为某些原因卸载了这个软件，可以在
              <a
                href="https://github.com/shuakami/qq-chat-exporter/issues/new/choose"
                target="_blank"
                rel="noreferrer"
                onClick={(e) => {
                  e.preventDefault()
                  void api.openUrl('https://github.com/shuakami/qq-chat-exporter/issues/new/choose')
                }}
                className="text-[var(--color-text)] underline underline-offset-2 hover:opacity-80 transition-opacity"
              >
                这里
              </a>
              告诉我们，或者提提建议。再次感谢您的使用~
            </p>
            <div className="w-full max-w-[200px] animate-fade-in delay-200 opacity-0 fill-mode-forwards">
              <Button
                fullWidth
                size="lg"
                variant="secondary"
                onClick={() => api.closeWindow()}
                className="h-9 font-medium"
              >
                关闭
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Exit confirmation overlay (only during uninstall) */}
      <AnimatePresence>
        {step === 'uninstalling' && error && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute bottom-4 left-4 right-4 z-50"
          >
            <div className="bg-[var(--color-card-bg)] border border-[var(--color-border)] rounded-lg p-4 shadow-lg text-center">
              <p className="text-[13px] text-[var(--color-text)] mb-3">
                卸载过程中遇到错误，是否强制关闭？
              </p>
              <div className="flex gap-3 justify-center">
                <Button
                  variant="secondary"
                  size="md"
                  onClick={() => setError(null)}
                >
                  重试
                </Button>
                <Button
                  variant="danger"
                  size="md"
                  onClick={() => api.closeWindow()}
                >
                  关闭
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
