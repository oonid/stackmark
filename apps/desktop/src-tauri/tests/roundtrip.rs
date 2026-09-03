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

/// The intermediary port, and the port it puts the native driver on.
///
/// tauri-driver defaults its native WebDriver to 4445, so an intermediary on
/// 4445 collides with the driver it spawns itself. Both are named explicitly
/// here, well away from the default, and the failure that taught us this was a
/// closed connection with no explanation.
const DRIVER_PORT: u16 = 4455;
const NATIVE_PORT: u16 = 4456;

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

struct Driver(Child);

impl Drop for Driver {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn start_driver() -> Driver {
    let child = Command::new("tauri-driver")
        .arg("--port")
        .arg(DRIVER_PORT.to_string())
        .arg("--native-port")
        .arg(NATIVE_PORT.to_string())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("tauri-driver is not on PATH; install it with `cargo install tauri-driver`");

    // Wait for the driver to answer rather than guessing at a delay. A fixed
    // sleep fails intermittently on a loaded machine, and an intermittent gate
    // gets ignored.
    let status = format!("http://127.0.0.1:{DRIVER_PORT}/status");
    for _ in 0..50 {
        if std::process::Command::new("curl")
            .args(["-sf", "-o", "/dev/null", &status])
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
        {
            return Driver(child);
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    panic!("tauri-driver did not become ready on port {DRIVER_PORT}");
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
    let _driver = start_driver();

    let client = ClientBuilder::native()
        .capabilities(capabilities(&application, workspace.path()))
        .connect(&format!("http://127.0.0.1:{DRIVER_PORT}"))
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
