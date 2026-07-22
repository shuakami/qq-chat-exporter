use std::ffi::OsString;
use std::path::{Component, Path, PathBuf};

fn has_unsafe_components(path: &Path) -> bool {
    path.components()
        .any(|component| matches!(component, Component::ParentDir | Component::CurDir))
}

fn canonical_roots(roots: &[PathBuf]) -> Vec<PathBuf> {
    roots
        .iter()
        .filter_map(|root| root.canonicalize().ok())
        .collect()
}

#[must_use]
pub fn resolve_existing_within(path: &Path, roots: &[PathBuf]) -> Option<PathBuf> {
    if !path.is_absolute() || has_unsafe_components(path) {
        return None;
    }
    let resolved = path.canonicalize().ok()?;
    canonical_roots(roots)
        .iter()
        .any(|root| resolved.starts_with(root))
        .then_some(resolved)
}

#[must_use]
pub fn resolve_existing_descendant_within(path: &Path, roots: &[PathBuf]) -> Option<PathBuf> {
    let resolved = resolve_existing_within(path, roots)?;
    canonical_roots(roots)
        .iter()
        .any(|root| resolved != *root && resolved.starts_with(root))
        .then_some(resolved)
}

#[must_use]
pub fn resolve_for_creation_within(path: &Path, roots: &[PathBuf]) -> Option<PathBuf> {
    if !path.is_absolute() || has_unsafe_components(path) {
        return None;
    }
    if path.exists() {
        return resolve_existing_within(path, roots);
    }

    let mut cursor = path;
    let mut missing: Vec<OsString> = Vec::new();
    while !cursor.exists() {
        missing.push(cursor.file_name()?.to_os_string());
        cursor = cursor.parent()?;
    }

    let mut resolved = cursor.canonicalize().ok()?;
    let canonical_roots = canonical_roots(roots);
    if !canonical_roots
        .iter()
        .any(|root| resolved.starts_with(root))
    {
        return None;
    }
    for component in missing.into_iter().rev() {
        resolved.push(component);
    }
    Some(resolved)
}

#[must_use]
pub fn valid_relative_resource_path(raw: &str) -> bool {
    !raw.is_empty()
        && !raw.contains(['\\', '\0', ':'])
        && raw
            .split('/')
            .all(|segment| !segment.is_empty() && segment != "." && segment != "..")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relative_resource_paths_reject_cross_platform_escape_forms() {
        assert!(valid_relative_resource_path("images/avatar.png"));
        for invalid in [
            "../secret.txt",
            "images/../secret.txt",
            "images\\secret.txt",
            "C:/secret.txt",
            "/absolute.txt",
            "images//avatar.png",
        ] {
            assert!(!valid_relative_resource_path(invalid), "{invalid}");
        }
    }

    #[test]
    fn existing_paths_must_remain_inside_allowed_roots() {
        let root = std::env::temp_dir().join(format!(
            "qce-path-security-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock")
                .as_nanos()
        ));
        let allowed = root.join("exports");
        let outside = root.join("outside");
        std::fs::create_dir_all(&allowed).expect("create allowed root");
        std::fs::create_dir_all(&outside).expect("create outside root");
        let inside_file = allowed.join("chat.json");
        let outside_file = outside.join("secret.json");
        std::fs::write(&inside_file, "{}").expect("write inside file");
        std::fs::write(&outside_file, "{}").expect("write outside file");

        assert!(resolve_existing_within(&inside_file, std::slice::from_ref(&allowed)).is_some());
        assert!(resolve_existing_within(&outside_file, std::slice::from_ref(&allowed)).is_none());
        assert!(
            resolve_existing_descendant_within(&allowed, std::slice::from_ref(&allowed)).is_none()
        );
        assert!(
            resolve_existing_descendant_within(&inside_file, std::slice::from_ref(&allowed))
                .is_some()
        );
        assert!(resolve_for_creation_within(
            &allowed.join("merged/new"),
            std::slice::from_ref(&allowed)
        )
        .is_some());
        assert!(resolve_for_creation_within(
            &outside.join("merged/new"),
            std::slice::from_ref(&allowed)
        )
        .is_none());

        std::fs::remove_dir_all(root).expect("remove test root");
    }
}
