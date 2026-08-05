#[cfg(test)]
mod tests {
    use super::{
        extract_history_messages, next_safe_group_batch_size, raw_message_matches_fetch_filter,
        replace_local_paths, sanitize_component,
    };
    use serde_json::json;
    use std::collections::HashMap;

    #[test]
    fn sanitizes_output_components() {
        // 每个 Windows 非法字符都必须被替换，不能遗漏任何一个字符或重新引入路径分隔符。
        assert_eq!(sanitize_component("A<>:/\\|?* B"), "A________ B");
    }

    #[test]
    fn rewrites_nested_local_paths() {
        let mut value = json!({
            "content": {
                "resources": [{"localPath": "C:/secret/a.png"}],
                "elements": [{"data": {"localPath": "C:/secret/a.png"}}]
            }
        });
        replace_local_paths(
            &mut value,
            &HashMap::from([("C:/secret/a.png".to_string(), "resources/a.png".to_string())]),
        );
        assert_eq!(
            value.pointer("/content/resources/0/localPath"),
            Some(&json!("resources/a.png"))
        );
        assert_eq!(
            value.pointer("/content/elements/0/data/localPath"),
            Some(&json!("resources/a.png"))
        );
    }

    #[test]
    fn extracts_history_messages_without_duplicate_rpc_fallbacks() {
        let message = json!({"msgId": "1", "msgSeq": "9"});
        assert_eq!(
            extract_history_messages(&json!({"msgList": [message.clone()]})),
            vec![message.clone()]
        );
        assert_eq!(
            extract_history_messages(&json!({"result": {"msgList": [message.clone()]}})),
            vec![message.clone()]
        );
        assert_eq!(
            extract_history_messages(&json!({"data": {"msgList": [message.clone()]}})),
            vec![message]
        );
    }

    #[test]
    fn ramps_safe_group_pages_but_never_exceeds_two_hundred() {
        assert_eq!(next_safe_group_batch_size(20, 2), 20);
        assert_eq!(next_safe_group_batch_size(20, 3), 50);
        assert_eq!(next_safe_group_batch_size(50, 3), 100);
        assert_eq!(next_safe_group_batch_size(100, 3), 200);
        assert_eq!(next_safe_group_batch_size(200, 99), 200);
    }

    #[test]
    fn applies_time_and_keyword_filter_before_spooling() {
        let message = json!({
            "msgTime": 1_700_000_000,
            "elements": [{"textElement": {"content": "hello world"}}]
        });
        let filter = json!({
            "startTime": 1_699_999_000_000_i64,
            "endTime": 1_700_001_000_000_i64,
            "keywords": ["WORLD"]
        });
        assert!(raw_message_matches_fetch_filter(&message, &filter));
        assert!(!raw_message_matches_fetch_filter(
            &message,
            &json!({
                "startTime": 1_700_002_000_000_i64,
                "endTime": 1_700_003_000_000_i64
            })
        ));
    }
}
