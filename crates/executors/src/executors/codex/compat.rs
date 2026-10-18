// The CLI stays on 0.124; project only fields consumed by Vibe rather than
// requiring identities and approval enums added or removed by newer protocols.
use std::path::PathBuf;

use codex_protocol::openai_models::ReasoningEffort;
use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadInfo {
    pub id: String,
    pub name: Option<String>,
    pub cwd: PathBuf,
    pub cli_version: String,
    pub source: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadSessionResponse {
    pub thread: ThreadInfo,
    pub model: String,
    pub reasoning_effort: Option<ReasoningEffort>,
}

#[derive(Debug, Deserialize)]
pub struct ThreadReadResponse {
    pub thread: ThreadInfo,
}

#[derive(Debug, Deserialize)]
pub struct ConfigReadResponse {
    pub config: ConfigInfo,
}

#[derive(Debug, Deserialize)]
pub struct ConfigInfo {
    pub model: Option<String>,
    pub model_provider: Option<String>,
    pub approval_policy: Option<Value>,
    pub sandbox_mode: Option<Value>,
    pub model_reasoning_effort: Option<String>,
    pub model_reasoning_summary: Option<Value>,
    pub service_tier: Option<String>,
}

pub fn adapt_params(method: &str, params: &mut Value) {
    let timestamp = match method {
        "item/started"
        | "item/commandExecution/requestApproval"
        | "item/fileChange/requestApproval" => Some("startedAtMs"),
        "item/completed" => Some("completedAtMs"),
        _ => None,
    };
    if let Some(key) = timestamp
        && let Some(object) = params.as_object_mut()
    {
        // Old runtimes omit timing. The adapter never displays or persists this sentinel.
        object.entry(key).or_insert(Value::from(0));
    }
}

#[cfg(test)]
mod tests {
    use codex_app_server_protocol::{JSONRPCRequest, ServerRequest};
    use serde_json::json;

    use super::*;

    #[test]
    fn reads_captured_0124_thread_responses_without_new_session_identity() {
        let start: ThreadSessionResponse =
            serde_json::from_str(include_str!("fixtures/thread-start-0.124.json")).unwrap();
        let read: ThreadReadResponse =
            serde_json::from_str(include_str!("fixtures/thread-read-0.124.json")).unwrap();
        let fork: ThreadSessionResponse =
            serde_json::from_str(include_str!("fixtures/thread-fork-0.124.json")).unwrap();
        assert_ne!(fork.thread.id, start.thread.id);
        assert_eq!(fork.model, start.model);
        assert_eq!(start.thread.id, read.thread.id);
        assert_eq!(start.model, "gpt-5.4");
        assert_eq!(read.thread.cli_version, "0.124.0");
    }

    #[test]
    fn preserves_legacy_config_approval_policy() {
        let response: ConfigReadResponse = serde_json::from_value(json!({"config": {
            "approval_policy": "on-failure", "service_tier": "fast"
        }}))
        .unwrap();
        assert_eq!(response.config.approval_policy, Some(json!("on-failure")));
        assert_eq!(response.config.service_tier.as_deref(), Some("fast"));
    }

    #[test]
    fn accepts_legacy_direct_approvals_without_timing() {
        for method in [
            "item/commandExecution/requestApproval",
            "item/fileChange/requestApproval",
        ] {
            let mut request: JSONRPCRequest = serde_json::from_value(json!({
                "id": "approval-1", "method": method,
                "params": {"threadId": "thread-1", "turnId": "turn-1", "itemId": "item-1"}
            }))
            .unwrap();
            adapt_params(method, request.params.as_mut().unwrap());
            let parsed = ServerRequest::try_from(request).unwrap();
            assert!(matches!(
                parsed,
                ServerRequest::CommandExecutionRequestApproval { .. }
                    | ServerRequest::FileChangeRequestApproval { .. }
            ));
        }
    }
}
