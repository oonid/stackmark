use std::{fs, sync::mpsc, time::Duration};

use stackmark_desktop::workspace::{WorkspaceEventKind, WorkspaceService};
use tempfile::tempdir;

fn workspace() -> (tempfile::TempDir, WorkspaceService) {
    let directory = tempdir().expect("temporary workspace");
    let service = WorkspaceService::new(directory.path()).expect("workspace service");
    (directory, service)
}

#[test]
fn writes_and_reads_a_nested_markdown_file_with_hash_and_mtime() {
    let (_directory, service) = workspace();
    fs::create_dir_all(service.root().join("notes")).expect("nested directory");

    let saved = service
        .atomic_write_markdown("notes/proof.md", b"# proof\n")
        .expect("write markdown");

    assert_eq!(
        service
            .read_markdown("notes/proof.md")
            .expect("read markdown"),
        b"# proof\n"
    );
    assert_eq!(saved.path, "notes/proof.md");
    assert_eq!(
        saved.sha256,
        "74b0badc813a99f0b5de1df8e0b4fc733352c394d10527cadba420f33ac1d227"
    );
    assert!(saved.mtime_unix_ms > 0);
}

#[test]
fn rejects_non_relative_parent_and_non_markdown_paths_before_access() {
    let (_directory, service) = workspace();

    for path in [
        "/tmp/proof.md",
        "../proof.md",
        "notes/../../proof.md",
        "proof.txt",
    ] {
        assert!(
            service.atomic_write_markdown(path, b"blocked").is_err(),
            "{path} must be rejected"
        );
        assert!(
            service.read_markdown(path).is_err(),
            "{path} must be rejected"
        );
    }
}

#[cfg(target_os = "linux")]
#[test]
fn rejects_a_symlinked_directory_that_escapes_the_workspace() {
    use std::os::unix::fs::symlink;

    let (directory, service) = workspace();
    let outside = tempdir().expect("outside directory");
    symlink(outside.path(), directory.path().join("escape")).expect("escape symlink");

    assert!(service
        .atomic_write_markdown("escape/proof.md", b"blocked")
        .is_err());
    assert!(!outside.path().join("proof.md").exists());
}

#[test]
fn replacement_is_atomic_and_reports_the_new_metadata() {
    let (_directory, service) = workspace();
    fs::write(service.root().join("proof.md"), b"old bytes").expect("old file");
    let old_mtime = fs::metadata(service.root().join("proof.md"))
        .expect("old metadata")
        .modified()
        .expect("old mtime");

    let saved = service
        .atomic_write_markdown("proof.md", b"new bytes")
        .expect("replace file");

    assert_eq!(
        fs::read(service.root().join("proof.md")).expect("replaced file"),
        b"new bytes"
    );
    assert!(
        fs::metadata(service.root().join("proof.md"))
            .expect("new metadata")
            .modified()
            .expect("new mtime")
            >= old_mtime
    );
    assert_eq!(
        saved.sha256,
        "11e2defd59f47c7f2aac84d6a5d6747e98e785afffb72c8bb7b05ec74e1d663c"
    );
}

#[test]
fn interrupted_temporary_write_preserves_the_old_file_and_leaves_no_temp_file() {
    let (_directory, service) = workspace();
    fs::write(service.root().join("proof.md"), b"old bytes").expect("old file");

    let error = service.atomic_write_markdown_with("proof.md", |temporary| {
        use std::io::Write;
        temporary.write_all(b"partial bytes")?;
        Err(std::io::Error::other("simulated interrupted write"))
    });

    assert!(error.is_err());
    assert_eq!(
        fs::read(service.root().join("proof.md")).expect("old file"),
        b"old bytes"
    );
    let leftovers = fs::read_dir(service.root())
        .expect("workspace entries")
        .filter_map(Result::ok)
        .filter(|entry| entry.file_name().to_string_lossy().starts_with(".tmp"))
        .count();
    assert_eq!(leftovers, 0);
}

#[test]
fn watcher_reports_the_next_external_markdown_change_with_normalized_metadata() {
    let (_directory, service) = workspace();
    let (sender, receiver) = mpsc::channel();
    let _watch = service
        .start_workspace_watch(move |event| sender.send(event).expect("event receiver"))
        .expect("workspace watcher");

    fs::write(service.root().join("external.md"), b"externally changed").expect("external edit");
    let event = receiver
        .recv_timeout(Duration::from_secs(5))
        .expect("external watcher event");

    assert_eq!(event.kind, WorkspaceEventKind::Modified);
    assert_eq!(event.path, "external.md");
    assert_eq!(
        event.sha256,
        "777d52f823646fef531a25eea8d5531406c9a071fd9817a4993709c5d19ae0e1"
    );
    assert!(event.mtime_unix_ms > 0);
}

#[test]
fn watcher_suppresses_only_its_matching_write_and_reports_a_later_external_edit() {
    let (_directory, service) = workspace();
    let (sender, receiver) = mpsc::channel();
    let _watch = service
        .start_workspace_watch(move |event| sender.send(event).expect("event receiver"))
        .expect("workspace watcher");

    service
        .atomic_write_markdown("proof.md", b"written by service")
        .expect("service write");
    fs::write(
        service.root().join("proof.md"),
        b"changed outside the service",
    )
    .expect("external edit");

    let event = receiver
        .recv_timeout(Duration::from_secs(5))
        .expect("later external watcher event");
    assert_eq!(event.path, "proof.md");
    assert_eq!(
        event.sha256,
        "28cb76cc417151cd9d002d623f78b5c8aaf69a4365d46d412e159cf65183a063"
    );
}

#[cfg(target_os = "linux")]
#[test]
fn rejects_a_directory_symlink_swap_between_temporary_write_and_persist() {
    use std::io::Write;
    use std::os::unix::fs::symlink;

    let (directory, service) = workspace();
    let outside = tempdir().expect("outside directory");
    fs::create_dir(directory.path().join("notes")).expect("workspace directory");

    let result = service.atomic_write_markdown_with("notes/proof.md", |temporary| {
        temporary.write_all(b"must stay inside workspace")?;
        fs::rename(
            directory.path().join("notes"),
            directory.path().join("notes-moved"),
        )?;
        symlink(outside.path(), directory.path().join("notes"))?;
        Ok(())
    });

    assert!(result.is_err(), "a swapped parent must abort the save");
    assert!(
        !outside.path().join("proof.md").exists(),
        "persist must never follow the swapped symlink"
    );
}

#[test]
fn watcher_reports_a_same_content_external_save_when_its_mtime_differs() {
    let (_directory, service) = workspace();
    let (sender, receiver) = mpsc::channel();
    let _watch = service
        .start_workspace_watch(move |event| sender.send(event).expect("event receiver"))
        .expect("workspace watcher");

    let saved = service
        .atomic_write_markdown("proof.md", b"same bytes")
        .expect("service write");
    let deadline = std::time::Instant::now() + Duration::from_millis(60);
    let external_mtime = loop {
        std::thread::sleep(Duration::from_millis(2));
        fs::write(service.root().join("proof.md"), b"same bytes").expect("same-content edit");
        let mtime = fs::metadata(service.root().join("proof.md"))
            .expect("external metadata")
            .modified()
            .expect("external mtime")
            .duration_since(std::time::UNIX_EPOCH)
            .expect("mtime after epoch")
            .as_millis() as u64;
        if mtime != saved.mtime_unix_ms || std::time::Instant::now() >= deadline {
            break mtime;
        }
    };
    assert_ne!(
        external_mtime, saved.mtime_unix_ms,
        "fixture must change mtime"
    );

    let event = receiver
        .recv_timeout(Duration::from_secs(5))
        .expect("same-content external event");
    assert_eq!(event.path, "proof.md");
    assert_eq!(event.sha256, saved.sha256);
    assert_eq!(event.mtime_unix_ms, external_mtime);
}

#[test]
fn watcher_does_not_report_the_services_own_completed_write() {
    let (_directory, service) = workspace();
    let (sender, receiver) = mpsc::channel();
    let _watch = service
        .start_workspace_watch(move |event| sender.send(event).expect("event receiver"))
        .expect("workspace watcher");

    service
        .atomic_write_markdown("proof.md", b"written by service")
        .expect("service write");

    assert!(
        receiver.recv_timeout(Duration::from_millis(400)).is_err(),
        "the service's own matching write must be suppressed"
    );
}

#[test]
fn watcher_stops_on_drop_and_can_restart_cleanly() {
    let (_directory, service) = workspace();
    let (old_sender, old_receiver) = mpsc::channel();
    let old_watch = service
        .start_workspace_watch(move |event| old_sender.send(event).expect("old receiver"))
        .expect("first workspace watcher");
    drop(old_watch);

    fs::write(service.root().join("after-drop.md"), b"not observed").expect("post-drop edit");
    assert!(old_receiver
        .recv_timeout(Duration::from_millis(200))
        .is_err());

    let (new_sender, new_receiver) = mpsc::channel();
    let _new_watch = service
        .start_workspace_watch(move |event| new_sender.send(event).expect("new receiver"))
        .expect("restarted workspace watcher");
    fs::write(service.root().join("after-restart.md"), b"observed").expect("restart edit");

    let event = new_receiver
        .recv_timeout(Duration::from_secs(5))
        .expect("restarted watcher event");
    assert_eq!(event.path, "after-restart.md");
}

#[test]
fn watcher_does_not_retrigger_itself_by_reading_the_file_it_watches() {
    let (_directory, service) = workspace();
    let (sender, receiver) = mpsc::channel();
    let _watch = service
        .start_workspace_watch(move |event| {
            let _ = sender.send(event);
        })
        .expect("workspace watcher");

    service
        .atomic_write_markdown("proof.md", b"written by service")
        .expect("service write");

    // Describing a change means opening and hashing the file, which the watcher
    // itself observes. Waiting past the own-write window proves that read does
    // not feed back: otherwise the record expires and the unchanged file starts
    // being reported as an external change.
    assert!(
        receiver.recv_timeout(Duration::from_secs(3)).is_err(),
        "the watcher must not report a file that nothing has changed"
    );
}
