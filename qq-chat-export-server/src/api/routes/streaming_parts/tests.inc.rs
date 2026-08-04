#[cfg(test)]
mod tests {
    use super::{replace_local_paths, sanitize_component};
    use serde_json::json;
    use std::collections::HashMap;

    #[test]
    fn sanitizes_output_components() {
        assert_eq!(sanitize_component("A<>:/\\|?* B"), "A_ B");
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
}
