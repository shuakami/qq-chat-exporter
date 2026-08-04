// issue #634：超大导出使用磁盘分块流水线。拆分为同一模块内的若干完整 item，
// 便于单独审阅抓取、任务生命周期、输出和隐私清理逻辑。
include!("streaming_parts/types_and_writer.inc.rs");
include!("streaming_parts/task_lifecycle.inc.rs");
include!("streaming_parts/pipeline.inc.rs");
include!("streaming_parts/task_state.inc.rs");
include!("streaming_parts/helpers_and_viewer.inc.rs");
include!("streaming_parts/tests.inc.rs");
