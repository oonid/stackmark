//! Carried finding 4: a poisoned lock made every later workspace operation
//! fatal.
//!
//! A panic anywhere inside a critical section would poison the mutex, and every
//! subsequent call would then fail with "workspace state is unavailable" for
//! the rest of the process's life. One fault became a permanently broken
//! application, and nothing short of a restart recovered it.

use std::sync::Arc;
use std::thread;

use stackmark_desktop::DesktopState;

#[test]
fn a_panic_while_holding_the_lock_does_not_disable_later_operations() {
    let state = Arc::new(DesktopState::default());

    let poisoner = Arc::clone(&state);
    let panicked = thread::spawn(move || {
        let _guard = poisoner.workspace_guard();
        panic!("a fault inside the critical section");
    })
    .join();
    assert!(panicked.is_err(), "the thread was supposed to panic");

    // The data behind the lock is still perfectly usable: it is no less valid
    // because an unrelated call panicked while holding it.
    let guard = state.workspace_guard();
    assert!(guard.is_none(), "no workspace was ever adopted");
}

#[test]
fn the_watch_lock_recovers_too() {
    let state = Arc::new(DesktopState::default());

    let poisoner = Arc::clone(&state);
    let _ = thread::spawn(move || {
        let _guard = poisoner.watch_guard();
        panic!("a fault inside the critical section");
    })
    .join();

    assert!(state.watch_guard().is_none());
}
