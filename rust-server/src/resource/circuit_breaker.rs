//! 智能熔断器。
//!
//! 与 TS 侧 `CircuitBreaker` 语义对齐：区分业务错误与系统故障，只有严重错误
//! 才计入熔断统计，避免 404 等正常错误触发熔断。

use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tokio::sync::Mutex;

/// 熔断器状态。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CircuitBreakerState {
    /// 正常状态。
    Closed,
    /// 熔断状态。
    Open,
    /// 半开状态。
    HalfOpen,
}

impl CircuitBreakerState {
    fn as_str(self) -> &'static str {
        match self {
            Self::Closed => "closed",
            Self::Open => "open",
            Self::HalfOpen => "half_open",
        }
    }
}

/// 内部可变状态。
#[derive(Debug)]
struct BreakerState {
    state: CircuitBreakerState,
    failure_count: u32,
    last_failure_time: Option<Instant>,
}

/// 智能熔断器。
#[derive(Debug)]
pub struct CircuitBreaker {
    threshold: u32,
    recovery_time: Duration,
    inner: Mutex<BreakerState>,
}

impl CircuitBreaker {
    /// 创建熔断器。
    #[must_use]
    pub fn new(threshold: u32, recovery_time_ms: u64) -> Self {
        Self {
            threshold,
            recovery_time: Duration::from_millis(recovery_time_ms),
            inner: Mutex::new(BreakerState {
                state: CircuitBreakerState::Closed,
                failure_count: 0,
                last_failure_time: None,
            }),
        }
    }

    /// 进入操作前的准入检查。熔断开启且未到恢复时间时返回 Err（含剩余秒数提示）。
    pub async fn before_execute(&self) -> Result<(), String> {
        let mut inner = self.inner.lock().await;
        if inner.state == CircuitBreakerState::Open {
            let elapsed = inner
                .last_failure_time
                .map_or(Duration::MAX, |t| t.elapsed());
            if elapsed >= self.recovery_time {
                inner.state = CircuitBreakerState::HalfOpen;
            } else {
                let remaining = self.recovery_time.saturating_sub(elapsed);
                return Err(format!(
                    "熔断器已开启，预计 {} 秒后恢复",
                    remaining.as_secs().saturating_add(1)
                ));
            }
        }
        Ok(())
    }

    /// 成功回调：重置计数并关闭熔断。
    pub async fn on_success(&self) {
        let mut inner = self.inner.lock().await;
        inner.failure_count = 0;
        inner.state = CircuitBreakerState::Closed;
    }

    /// 失败回调：只有严重错误才计入熔断统计。
    pub async fn on_failure(&self, error_message: &str) {
        if !should_count_as_failure(error_message) {
            return;
        }
        let mut inner = self.inner.lock().await;
        inner.failure_count += 1;
        inner.last_failure_time = Some(Instant::now());
        if inner.failure_count >= self.threshold {
            inner.state = CircuitBreakerState::Open;
        }
    }

    /// 获取状态信息（供统计接口）。
    pub async fn status(&self) -> Value {
        let inner = self.inner.lock().await;
        json!({
            "state": inner.state.as_str(),
            "failureCount": inner.failure_count,
        })
    }
}

/// 判断错误是否应计入熔断（业务错误不计入）。
fn should_count_as_failure(error_message: &str) -> bool {
    const IGNORED_ERRORS: [&str; 11] = [
        "404",
        "not found",
        "forbidden",
        "unauthorized",
        "file exists",
        "disk quota",
        "api返回空路径",
        "空路径",
        "文件不存在",
        "权限问题",
        "无法找到有效的下载文件",
    ];
    let lower = error_message.to_lowercase();
    !IGNORED_ERRORS.iter().any(|ignored| lower.contains(ignored))
}
