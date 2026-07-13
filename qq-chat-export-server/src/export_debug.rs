use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{json, Value};
use tokio::io::AsyncWriteExt;
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;

enum DebugCommand {
    Event(String),
    Finish(oneshot::Sender<Result<(), String>>),
}

#[derive(Clone)]
pub struct ExportDebugTrace {
    sender: mpsc::Sender<DebugCommand>,
}

impl ExportDebugTrace {
    pub async fn record(&self, event: Value) {
        let payload = json!({
            "timestamp": chrono::Utc::now().to_rfc3339(),
            "event": event,
        });
        let _ = self
            .sender
            .send(DebugCommand::Event(payload.to_string()))
            .await;
    }
}

pub struct ExportDebugSession {
    directory: PathBuf,
    trace: ExportDebugTrace,
    writer: JoinHandle<()>,
}

impl ExportDebugSession {
    pub async fn start(output_dir: &Path, export_name: &str) -> Result<Self, String> {
        tokio::fs::create_dir_all(output_dir)
            .await
            .map_err(|error| format!("创建调试导出目录失败: {error}"))?;
        let base_name = Path::new(export_name)
            .file_stem()
            .and_then(|value| value.to_str())
            .filter(|value| !value.is_empty())
            .unwrap_or("export");
        let mut directory = output_dir.join(format!("{base_name}.debug"));
        let mut suffix = 2;
        while tokio::fs::try_exists(&directory).await.unwrap_or(false) {
            directory = output_dir.join(format!("{base_name}.debug-{suffix}"));
            suffix += 1;
        }
        tokio::fs::create_dir(&directory)
            .await
            .map_err(|error| format!("创建调试导出目录失败: {error}"))?;

        let (sender, mut receiver) = mpsc::channel(1024);
        let event_path = directory.join("04-events.jsonl");
        let writer = tokio::spawn(async move {
            let result = async {
                let mut file = tokio::fs::File::create(&event_path)
                    .await
                    .map_err(|error| error.to_string())?;
                while let Some(command) = receiver.recv().await {
                    match command {
                        DebugCommand::Event(line) => {
                            file.write_all(line.as_bytes())
                                .await
                                .map_err(|error| error.to_string())?;
                            file.write_all(b"\n")
                                .await
                                .map_err(|error| error.to_string())?;
                        }
                        DebugCommand::Finish(reply) => {
                            let result = file.flush().await.map_err(|error| error.to_string());
                            let _ = reply.send(result);
                            return Ok::<(), String>(());
                        }
                    }
                }
                Ok(())
            }
            .await;
            if let Err(error) = result {
                tracing::warn!("写入调试导出事件失败: {error}");
            }
        });

        Ok(Self {
            directory,
            trace: ExportDebugTrace { sender },
            writer,
        })
    }

    #[must_use]
    pub fn trace(&self) -> ExportDebugTrace {
        self.trace.clone()
    }

    #[must_use]
    pub fn directory(&self) -> &Path {
        &self.directory
    }

    pub async fn write_jsonl<T: Serialize>(
        &self,
        file_name: &str,
        values: &[T],
    ) -> Result<(), String> {
        let mut file = tokio::fs::File::create(self.directory.join(file_name))
            .await
            .map_err(|error| error.to_string())?;
        for value in values {
            let line = serde_json::to_vec(value).map_err(|error| error.to_string())?;
            file.write_all(&line)
                .await
                .map_err(|error| error.to_string())?;
            file.write_all(b"\n")
                .await
                .map_err(|error| error.to_string())?;
        }
        file.flush().await.map_err(|error| error.to_string())
    }

    pub async fn write_json<T: Serialize>(&self, file_name: &str, value: &T) -> Result<(), String> {
        let bytes = serde_json::to_vec_pretty(value).map_err(|error| error.to_string())?;
        tokio::fs::write(self.directory.join(file_name), bytes)
            .await
            .map_err(|error| error.to_string())
    }

    pub async fn finish(self) -> Result<PathBuf, String> {
        let (reply, result) = oneshot::channel();
        self.trace
            .sender
            .send(DebugCommand::Finish(reply))
            .await
            .map_err(|_| "调试导出事件写入器已关闭".to_string())?;
        result
            .await
            .map_err(|_| "调试导出事件写入器未返回结果".to_string())??;
        self.writer
            .await
            .map_err(|error| format!("等待调试导出事件写入器失败: {error}"))?;
        Ok(self.directory)
    }
}
