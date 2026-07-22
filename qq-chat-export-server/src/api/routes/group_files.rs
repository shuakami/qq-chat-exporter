use std::collections::HashMap;

use axum::extract::{Extension, Query, State};
use axum::response::Response;
use serde_json::json;

use crate::api::response::{self, RequestId};
use crate::api::state::SharedState;

use super::files::load_records;

/// `GET /api/group-files/export-records` — 群文件导出记录。
pub async fn group_files_export_records(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let limit = params
        .get("limit")
        .and_then(|v| v.parse::<usize>().ok())
        .filter(|l| *l >= 1)
        .map_or(50, |l| l.min(100));
    let mut records = load_records(&state).await;
    records.truncate(limit);
    response::success(
        json!({
            "records": records,
            "totalCount": records.len(),
        }),
        &request_id,
    )
}
