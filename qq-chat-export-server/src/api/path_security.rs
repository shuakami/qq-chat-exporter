use std::ffi::OsString;
use std::fs::{File, OpenOptions};
use std::io;
use std::path::{Component, Path, PathBuf};

fn has_unsafe_components(path: &Path) -> bool {
    path.components()
        .any(|component| matches!(component, Component::ParentDir | Component::CurDir))
}

fn resolve_for_creation(path: &Path) -> Option<PathBuf> {
    if !path.is_absolute() || has_unsafe_components(path) {
        return None;
    }
    if path.exists() {
        return path.canonicalize().ok();
    }

    let mut cursor = path;
    let mut missing: Vec<OsString> = Vec::new();
    while !cursor.exists() {
        missing.push(cursor.file_name()?.to_os_string());
        cursor = cursor.parent()?;
    }

    let mut resolved = cursor.canonicalize().ok()?;
    for component in missing.into_iter().rev() {
        resolved.push(component);
    }
    Some(resolved)
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

/// Resolve an existing path only when its canonical identity is exactly one of
/// the registered paths. Registered paths must already be canonical: keeping
/// their stored lexical identity prevents a later symlink swap from changing
/// what the task authorized. This is used for task-level custom export
/// destinations, where registering one completed export must not authorize
/// neighboring files in that folder.
#[must_use]
pub fn resolve_existing_exact(path: &Path, registered_paths: &[PathBuf]) -> Option<PathBuf> {
    if !path.is_absolute() || has_unsafe_components(path) {
        return None;
    }
    let resolved = path.canonicalize().ok()?;
    registered_paths
        .iter()
        .filter(|registered| registered.is_absolute() && !has_unsafe_components(registered))
        .any(|registered| registered == &resolved)
        .then_some(resolved)
}

fn changed_during_validation() -> io::Error {
    io::Error::new(
        io::ErrorKind::PermissionDenied,
        "path changed while its file identity was being validated",
    )
}

#[cfg(unix)]
fn same_file_identity(left: &std::fs::Metadata, right: &std::fs::Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;

    left.dev() == right.dev() && left.ino() == right.ino()
}

/// Open an already-authorized canonical path and bind subsequent reads to the
/// same file identity. On Unix, the final component may not be a symlink.
/// Revalidation on both sides of `open` also detects ancestor replacement and
/// regular-file swaps during the validation window.
pub fn open_verified_file(path: &Path) -> io::Result<File> {
    if !path.is_absolute() || has_unsafe_components(path) {
        return Err(changed_during_validation());
    }

    let expected_path = path.canonicalize()?;
    if expected_path != path {
        return Err(changed_during_validation());
    }
    #[cfg(unix)]
    let expected_metadata = std::fs::metadata(&expected_path)?;

    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;

        options.custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW);
    }
    let file = options.open(&expected_path).map_err(|error| {
        #[cfg(unix)]
        if error.raw_os_error() == Some(libc::ELOOP) {
            return changed_during_validation();
        }
        error
    })?;
    #[cfg(unix)]
    let opened_metadata = file.metadata()?;

    let revalidated_path = path.canonicalize()?;
    if revalidated_path != expected_path {
        return Err(changed_during_validation());
    }
    #[cfg(unix)]
    {
        let revalidated_metadata = std::fs::metadata(&revalidated_path)?;
        if !same_file_identity(&expected_metadata, &opened_metadata)
            || !same_file_identity(&opened_metadata, &revalidated_metadata)
        {
            return Err(changed_during_validation());
        }
    }

    Ok(file)
}

#[must_use]
pub fn resolve_for_creation_within(path: &Path, roots: &[PathBuf]) -> Option<PathBuf> {
    let resolved = resolve_for_creation(path)?;
    roots
        .iter()
        .filter_map(|root| resolve_for_creation(root))
        .any(|root| resolved.starts_with(root))
        .then_some(resolved)
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
        let canonical_inside_file = inside_file.canonicalize().expect("canonical inside file");
        assert!(
            resolve_existing_exact(&inside_file, std::slice::from_ref(&canonical_inside_file))
                .is_some()
        );
        assert!(resolve_existing_exact(
            &outside_file,
            std::slice::from_ref(&canonical_inside_file)
        )
        .is_none());
        assert!(
            resolve_existing_exact(&allowed, std::slice::from_ref(&canonical_inside_file))
                .is_none()
        );
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

    #[cfg(unix)]
    #[test]
    fn exact_registered_path_rejects_a_post_registration_symlink_swap() {
        use std::os::unix::fs::symlink;

        let root = std::env::temp_dir().join(format!(
            "qce-exact-path-security-{}-{}",
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
        let registered = allowed.join("chat.json");
        let outside_file = outside.join("secret.json");
        std::fs::write(&registered, "{}").expect("write registered file");
        std::fs::write(&outside_file, "{}").expect("write outside file");
        let canonical_registered = registered
            .canonicalize()
            .expect("canonical registered path");

        assert_eq!(
            resolve_existing_exact(&registered, std::slice::from_ref(&canonical_registered)),
            Some(canonical_registered.clone())
        );

        std::fs::remove_file(&registered).expect("remove registered file");
        symlink(&outside_file, &registered).expect("replace registered path with symlink");

        assert!(
            resolve_existing_exact(&registered, std::slice::from_ref(&canonical_registered))
                .is_none()
        );
        std::fs::remove_dir_all(root).expect("remove test root");
    }

    #[cfg(unix)]
    #[test]
    fn verified_open_rejects_a_symlink_swap_after_path_resolution() {
        use std::os::unix::fs::symlink;

        let root = std::env::temp_dir().join(format!(
            "qce-verified-open-swap-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock")
                .as_nanos()
        ));
        let registered = root.join("registered.json");
        let outside = root.join("outside.json");
        std::fs::create_dir_all(&root).expect("create test root");
        std::fs::write(&registered, "registered").expect("write registered file");
        std::fs::write(&outside, "outside").expect("write outside file");
        let canonical_registered = registered
            .canonicalize()
            .expect("canonical registered path");
        let resolved =
            resolve_existing_exact(&registered, std::slice::from_ref(&canonical_registered))
                .expect("resolve registered file before swap");

        std::fs::remove_file(&registered).expect("remove registered file");
        symlink(&outside, &registered).expect("replace registered path with symlink");

        let error = open_verified_file(&resolved)
            .expect_err("a final-component symlink introduced after resolution must be rejected");
        assert_eq!(error.kind(), io::ErrorKind::PermissionDenied);
        std::fs::remove_dir_all(root).expect("remove test root");
    }

    #[cfg(unix)]
    #[test]
    fn verified_open_keeps_reading_the_opened_file_identity_after_path_replacement() {
        use std::io::Read as _;

        let root = std::env::temp_dir().join(format!(
            "qce-verified-open-identity-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock")
                .as_nanos()
        ));
        let registered = root.join("registered.json");
        std::fs::create_dir_all(&root).expect("create test root");
        std::fs::write(&registered, "original").expect("write registered file");
        let canonical_registered = registered
            .canonicalize()
            .expect("canonical registered path");
        let resolved =
            resolve_existing_exact(&registered, std::slice::from_ref(&canonical_registered))
                .expect("resolve registered file");
        let mut opened = open_verified_file(&resolved).expect("open verified file");
        let opened_metadata = opened.metadata().expect("opened metadata");

        std::fs::remove_file(&registered).expect("unlink registered path");
        std::fs::write(&registered, "replacement").expect("replace registered path");
        let replacement_metadata = std::fs::metadata(&registered).expect("replacement metadata");
        assert!(!same_file_identity(&opened_metadata, &replacement_metadata));

        let mut contents = String::new();
        opened
            .read_to_string(&mut contents)
            .expect("read the already-opened file");
        assert_eq!(contents, "original");

        drop(opened);
        std::fs::remove_dir_all(root).expect("remove test root");
    }

    #[test]
    fn creation_paths_allow_missing_allowed_roots() {
        let root = std::env::temp_dir().join(format!(
            "qce-missing-path-security-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock")
                .as_nanos()
        ));
        let allowed = root.join("QQChatExporter/exports");
        let outside = root.join("outside");
        std::fs::create_dir_all(&root).expect("create test root");

        assert!(!allowed.exists());
        let canonical_root = root.canonicalize().expect("canonicalize test root");
        let canonical_allowed = canonical_root.join("QQChatExporter/exports");
        assert_eq!(
            resolve_for_creation_within(&allowed, std::slice::from_ref(&allowed)),
            Some(canonical_allowed.clone())
        );
        assert_eq!(
            resolve_for_creation_within(
                &allowed.join("group/export.json"),
                std::slice::from_ref(&allowed)
            ),
            Some(canonical_allowed.join("group/export.json"))
        );
        assert!(resolve_for_creation_within(&outside, std::slice::from_ref(&allowed)).is_none());

        std::fs::remove_dir_all(root).expect("remove test root");
    }
}
