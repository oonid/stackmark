//! Drives the built binary through real inter-process communication.
//!
//! This is the only check in the project that sees the capability list. The
//! generated bindings prove the names and shapes agree; they cannot prove a
//! command is permitted. Both defects that reached a build already recorded as
//! passing were configuration of exactly this kind, and neither reproduced in
//! Chromium.
//!
//! The client is Rust rather than Node because the toolchain constraint keeps
//! JavaScript inside Docker, while the driver, the display and the binary are
//! all on the host. A Rust client needs no container to reach them.
//!
//! The test drives the interface rather than calling `invoke` from page
//! context: `withGlobalTauri` is false, so there is no global to call, and a
//! bundled frontend cannot resolve a workspace package at runtime. Clicking is
//! also what a user does.
//!
//! Ignored by default because it needs `tauri-driver`, `WebKitWebDriver`, a
//! display and a release build. Run it with:
//!
//! ```text
//! cargo build --release
//! xvfb-run -a cargo test --test roundtrip -- --ignored --test-threads=1
//! ```

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::Duration;

use fantoccini::{ClientBuilder, Locator};
use serde_json::{json, Map, Value};

/// The base of the port pair each test uses.
///
/// tauri-driver defaults its native WebDriver to 4445, so an intermediary on
/// 4445 collides with the driver it spawns itself; both are named explicitly,
/// well away from the default. Each test then takes its own pair, because the
/// native driver serves one session at a time and a session outliving its test
/// makes the next one fail with "maximum number of active sessions" -- a
/// message that says nothing about ports.
const DRIVER_BASE: u16 = 4455;
const SLOT_0: u16 = 0;
const SLOT_1: u16 = 1;
const SLOT_2: u16 = 2;

/// The release binary.
///
/// `cargo build` names it after the package; the Tauri CLI renames it to
/// `mainBinaryName` when it bundles. Accept either, so the test drives whichever
/// build produced it rather than silently looking for one that is not there.
fn binary() -> PathBuf {
    let release = Path::new(env!("CARGO_MANIFEST_DIR")).join("target/release");
    let bundled = release.join("stackmark");
    if bundled.exists() {
        return bundled;
    }
    release.join(env!("CARGO_PKG_NAME"))
}

struct Driver(Child, u16);

impl Driver {
    fn port(&self) -> u16 {
        self.1
    }
}

impl Drop for Driver {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn start_driver(slot: u16) -> Driver {
    let port = DRIVER_BASE + slot * 2;
    let native = port + 1;
    let child = Command::new("tauri-driver")
        .arg("--port")
        .arg(port.to_string())
        .arg("--native-port")
        .arg(native.to_string())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("tauri-driver is not on PATH; install it with `cargo install tauri-driver`");

    // Wait for the driver to answer rather than guessing at a delay. A fixed
    // sleep fails intermittently on a loaded machine, and an intermittent gate
    // gets ignored.
    let status = format!("http://127.0.0.1:{port}/status");
    for _ in 0..50 {
        if std::process::Command::new("curl")
            .args(["-sf", "-o", "/dev/null", &status])
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
        {
            return Driver(child, port);
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    panic!("tauri-driver did not become ready on port {port}");
}

fn capabilities(application: &Path, workspace: &Path) -> Map<String, Value> {
    let mut map = Map::new();
    map.insert(
        "tauri:options".to_string(),
        json!({
            "application": application.to_string_lossy(),
            "args": [workspace.to_string_lossy()],
        }),
    );
    map.insert("browserName".to_string(), json!("wry"));
    map
}

#[tokio::test(flavor = "current_thread")]
#[ignore = "needs tauri-driver, a display and a release build"]
async fn writes_a_document_through_the_real_command_channel() {
    let application = binary();
    assert!(
        application.exists(),
        "release binary missing at {}; run `cargo build --release` first",
        application.display()
    );

    let workspace = tempfile::tempdir().expect("temporary workspace");
    let _driver = start_driver(SLOT_0);

    let client = ClientBuilder::native()
        .capabilities(capabilities(&application, workspace.path()))
        .connect(&format!("http://127.0.0.1:{}", _driver.port()))
        .await
        .expect("could not start a session against the built binary");

    let editor = client
        .wait()
        .for_element(Locator::Css("[data-testid='markdown-source']"))
        .await
        .expect("the editor never appeared");
    editor.clear().await.expect("clearing the editor");
    editor
        .send_keys("# round trip\n")
        .await
        .expect("typing into the editor");

    client
        .find(Locator::Css("[data-testid='desktop-proof-action']"))
        .await
        .expect("the save control is missing")
        .click()
        .await
        .expect("clicking save");

    // The metadata card only renders once the command returned successfully, so
    // waiting for it is waiting for the whole round trip.
    client
        .wait()
        .for_element(Locator::Css("[data-testid='desktop-save-metadata']"))
        .await
        .expect("the save reported no metadata, so the command did not succeed");

    let written = std::fs::read_to_string(workspace.path().join("stage-zero-proof.md"))
        .expect("the command reported success but wrote no file");
    assert!(
        written.contains("# round trip"),
        "the file on disk does not contain what the editor sent: {written:?}"
    );

    client.close().await.expect("closing the session");
}

/// Every remaining command, and the watcher event, in one session.
///
/// One session rather than one per command: each costs a build, a driver and a
/// window, and the point is that the channel carries every command, not that
/// each is independent.
#[tokio::test(flavor = "current_thread")]
#[ignore = "needs tauri-driver, a display and a release build"]
async fn every_command_crosses_the_channel() {
    let application = binary();
    assert!(application.exists(), "run `cargo build --release` first");

    let workspace = tempfile::tempdir().expect("temporary workspace");
    let _driver = start_driver(SLOT_1);

    let client = ClientBuilder::native()
        .capabilities(capabilities(&application, workspace.path()))
        .connect(&format!("http://127.0.0.1:{}", _driver.port()))
        .await
        .expect("could not start a session against the built binary");

    client
        .wait()
        .for_element(Locator::Css("[data-testid='create-document']"))
        .await
        .expect("the document controls never appeared");

    // create_document, then list_documents through the refresh that follows it.
    press(&client, "create-document").await;
    let status = status_of(&client).await;
    assert!(status.starts_with("Created"), "create reported: {status}");
    assert!(
        workspace.path().join("round-trip.md").exists(),
        "the command reported success but wrote no file"
    );

    press(&client, "list-documents").await;
    assert!(status_of(&client).await.contains("1 documents"));

    // write_document, which the save action never reaches on a fresh workspace
    // because there is nothing to write to yet. Leaving it uncovered made the
    // capability check pass with its permission removed.
    press(&client, "write-document").await;
    let status = status_of(&client).await;
    assert!(status.starts_with("Wrote"), "write reported: {status}");

    press(&client, "read-document").await;
    assert!(status_of(&client).await.starts_with("Read"));

    set_path(&client, "renamed.md").await;
    press(&client, "rename-document").await;
    let status = status_of(&client).await;
    assert!(status.contains("renamed.md"), "rename reported: {status}");

    press(&client, "remove-document").await;
    assert!(status_of(&client).await.starts_with("Removed"));

    press(&client, "list-documents").await;
    assert!(status_of(&client).await.contains("0 documents"));

    client.close().await.expect("closing the session");
}

/// A change made outside the application reaches the interface.
#[tokio::test(flavor = "current_thread")]
#[ignore = "needs tauri-driver, a display and a release build"]
async fn an_external_change_reaches_the_interface() {
    let application = binary();
    assert!(application.exists(), "run `cargo build --release` first");

    let workspace = tempfile::tempdir().expect("temporary workspace");
    let _driver = start_driver(SLOT_2);

    let client = ClientBuilder::native()
        .capabilities(capabilities(&application, workspace.path()))
        .connect(&format!("http://127.0.0.1:{}", _driver.port()))
        .await
        .expect("could not start a session against the built binary");

    // Saving starts the watcher, so the proof action has to run first.
    client
        .wait()
        .for_element(Locator::Css("[data-testid='desktop-proof-action']"))
        .await
        .expect("the save control never appeared");
    press(&client, "desktop-proof-action").await;
    client
        .wait()
        .for_element(Locator::Css("[data-testid='desktop-save-metadata']"))
        .await
        .expect("the save did not complete");

    std::fs::write(
        workspace.path().join("stage-zero-proof.md"),
        "# changed by something else\n",
    )
    .expect("writing outside the application");

    let card = client
        .wait()
        .for_element(Locator::Css("[data-testid='desktop-external-change']"))
        .await
        .expect("the watcher never reported the external change");
    assert!(card.text().await.unwrap().contains("stage-zero-proof.md"));

    client.close().await.expect("closing the session");
}

async fn press(client: &fantoccini::Client, test_id: &str) {
    client
        .wait()
        .for_element(Locator::Css(&format!("[data-testid='{test_id}']")))
        .await
        .unwrap_or_else(|_| panic!("control `{test_id}` is missing"))
        .click()
        .await
        .unwrap_or_else(|_| panic!("clicking `{test_id}`"));
}

async fn set_path(client: &fantoccini::Client, path: &str) {
    let field = client
        .find(Locator::Css("[data-testid='document-path']"))
        .await
        .expect("the path field is missing");
    field.clear().await.expect("clearing the path field");
    field.send_keys(path).await.expect("typing a path");
}

async fn status_of(client: &fantoccini::Client) -> String {
    // The status only changes once the command has returned, so polling it is
    // waiting for the round trip rather than for a fixed delay.
    for _ in 0..50 {
        let text = client
            .find(Locator::Css("[data-testid='document-status']"))
            .await
            .expect("the status line is missing")
            .text()
            .await
            .unwrap_or_default();
        if !text.is_empty() {
            return text;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    panic!("the status line stayed empty");
}
