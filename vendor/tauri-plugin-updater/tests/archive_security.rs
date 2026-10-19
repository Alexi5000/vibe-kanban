use std::io::{Cursor, Write};

use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

fn file_archive(name: &str) -> Vec<u8> {
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    writer
        .start_file(name, SimpleFileOptions::default().unix_permissions(0o7777))
        .unwrap();
    writer.write_all(b"installer\0payload").unwrap();
    let mut bytes = writer.finish().unwrap().into_inner();
    let directory = bytes.windows(4).position(|w| w == b"PK\x01\x02").unwrap();
    bytes[directory + 38..directory + 42].copy_from_slice(&(0o107777u32 << 16).to_le_bytes());
    bytes
}

#[test]
fn extracts_both_windows_installer_formats_without_changing_bytes() {
    for name in ["setup.exe", "setup.msi"] {
        let dir = tempfile::tempdir().unwrap();
        let mut archive = ZipArchive::new(Cursor::new(file_archive(name))).unwrap();
        archive.extract(dir.path()).unwrap();
        assert_eq!(
            std::fs::read(dir.path().join(name)).unwrap(),
            b"installer\0payload"
        );
    }
}

#[test]
fn rejects_parent_traversal_without_writing_outside_destination() {
    let root = tempfile::tempdir().unwrap();
    let dest = root.path().join("destination");
    std::fs::create_dir(&dest).unwrap();
    let mut archive = ZipArchive::new(Cursor::new(file_archive("../escaped.exe"))).unwrap();
    let _ = archive.extract(&dest);
    assert!(!root.path().join("escaped.exe").exists());
}

#[test]
fn rejects_symlink_targets_outside_destination() {
    let root = tempfile::tempdir().unwrap();
    let outside = root.path().join("outside");
    std::fs::write(&outside, b"unchanged").unwrap();
    let dest = root.path().join("destination");
    std::fs::create_dir(&dest).unwrap();
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    writer
        .add_symlink("setup.exe", "../outside", SimpleFileOptions::default())
        .unwrap();
    let mut archive = ZipArchive::new(writer.finish().unwrap()).unwrap();
    assert!(archive.extract(&dest).is_err());
    assert!(std::fs::symlink_metadata(dest.join("setup.exe")).is_err());
    assert_eq!(std::fs::read(outside).unwrap(), b"unchanged");
}

#[test]
#[cfg(unix)]
fn strips_privileged_permission_bits() {
    use std::os::unix::fs::PermissionsExt;

    let dir = tempfile::tempdir().unwrap();
    let mut archive = ZipArchive::new(Cursor::new(file_archive("setup.exe"))).unwrap();
    archive.extract(dir.path()).unwrap();
    let mode = std::fs::metadata(dir.path().join("setup.exe"))
        .unwrap()
        .permissions()
        .mode();
    assert_eq!(mode & 0o7000, 0);
}

#[test]
#[cfg(unix)]
fn does_not_chmod_external_symlink_target() {
    use std::os::unix::fs::PermissionsExt;

    let root = tempfile::tempdir().unwrap();
    let outside = root.path().join("outside");
    std::fs::write(&outside, b"unchanged").unwrap();
    std::fs::set_permissions(&outside, std::fs::Permissions::from_mode(0o600)).unwrap();
    let dest = root.path().join("destination");
    std::fs::create_dir(&dest).unwrap();
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    writer
        .add_symlink(
            "setup.exe",
            "../outside",
            SimpleFileOptions::default().unix_permissions(0o777),
        )
        .unwrap();
    let mut archive = ZipArchive::new(writer.finish().unwrap()).unwrap();
    let _ = archive.extract(&dest);
    assert_eq!(
        std::fs::metadata(outside).unwrap().permissions().mode() & 0o777,
        0o600
    );
}
