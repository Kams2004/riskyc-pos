//! Receipt printers, for lib/printer/desktopTransport.ts: finding them (network, serial/Bluetooth, USB, installed in
//! the OS), two-way sessions to talk ESC/POS with them (open / write / read / close), and one-way printing through
//! the system's print queue with job tracking. The ESC/POS logic itself (what to send, how to read the answers) lives
//! in TypeScript (lib/printer/escpos.ts, printJob.ts); this side only moves bytes.

mod discovery;
mod link;
mod spooler;
#[cfg(windows)]
mod windows;

use link::{Link, LinkTarget};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::State;

pub use discovery::{NetworkPrinter, SerialPrinter, UsbDevicePrinter};
pub use spooler::{JobStatus, QueueProblems, SystemPrinter};

/// A session nobody used for this long was forgotten by the app (page closed mid-print): it's closed so the
/// printer — which often accepts a single connection — is free again.
const IDLE_SESSION: Duration = Duration::from_secs(60);
/// Longest a single read may wait, whatever the app asks.
const MAX_READ_WAIT: Duration = Duration::from_secs(30);

struct Session {
    identity: String,
    link: Arc<Mutex<Box<dyn Link>>>,
    last_used: Instant,
}

/// The open two-way printer links, by handle.
#[derive(Default, Clone)]
pub struct PrinterSessions {
    inner: Arc<Mutex<SessionTable>>,
}

#[derive(Default)]
struct SessionTable {
    next: u32,
    sessions: HashMap<u32, Session>,
}

impl PrinterSessions {
    fn insert(&self, identity: String, link: Box<dyn Link>) -> u32 {
        let mut table = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        table.next = table.next.wrapping_add(1).max(1);
        let handle = table.next;
        table.sessions.insert(handle, Session { identity, link: Arc::new(Mutex::new(link)), last_used: Instant::now() });
        handle
    }

    /// Closes sessions to the same printer and long-idle ones, before a new one opens.
    fn evict(&self, identity: &str) {
        let mut table = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        table.sessions.retain(|_, s| s.identity != identity && s.last_used.elapsed() < IDLE_SESSION);
    }

    fn get(&self, handle: u32) -> Result<Arc<Mutex<Box<dyn Link>>>, String> {
        let mut table = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let session = table.sessions.get_mut(&handle).ok_or("the printer connection is closed")?;
        session.last_used = Instant::now();
        Ok(session.link.clone())
    }

    fn remove(&self, handle: u32) {
        // Dropping the link closes it — once any read/write still running on it finishes.
        self.inner.lock().unwrap_or_else(|e| e.into_inner()).sessions.remove(&handle);
    }

    pub fn open(&self, target: &LinkTarget) -> Result<OpenedPrinter, String> {
        let identity = target.identity();
        self.evict(&identity);
        let opened = link::open(target).map_err(|e| e.to_string())?;
        let handle = self.insert(identity, opened.link);
        Ok(OpenedPrinter { handle, baud: opened.baud, baud_confirmed: opened.baud_confirmed })
    }

    pub fn write(&self, handle: u32, bytes: &[u8]) -> Result<(), String> {
        let link = self.get(handle)?;
        let mut link = link.lock().unwrap_or_else(|e| e.into_inner());
        link.write_all_bytes(bytes).map_err(|e| e.to_string())
    }

    pub fn read(&self, handle: u32, timeout: Duration) -> Result<Vec<u8>, String> {
        let link = self.get(handle)?;
        let mut link = link.lock().unwrap_or_else(|e| e.into_inner());
        link.read_some(timeout.min(MAX_READ_WAIT)).map_err(|e| e.to_string())
    }

    pub fn close(&self, handle: u32) {
        self.remove(handle);
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedPrinter {
    pub handle: u32,
    /// Serial links: the speed used. `baudConfirmed`: the printer answered at that speed (worth remembering).
    pub baud: Option<u32>,
    pub baud_confirmed: bool,
}

/// Runs blocking printer I/O on a worker thread, off the app's main thread.
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

// ── Commands ────────────────────────────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn printer_scan_network() -> Result<Vec<NetworkPrinter>, String> {
    Ok(discovery::scan_network().await)
}

#[tauri::command]
pub async fn printer_list_serial() -> Result<Vec<SerialPrinter>, String> {
    blocking(|| Ok(discovery::list_serial())).await
}

#[tauri::command]
pub async fn printer_list_usb_devices() -> Result<Vec<UsbDevicePrinter>, String> {
    blocking(|| Ok(discovery::list_usb_devices())).await
}

#[tauri::command]
pub async fn printer_list_system() -> Result<Vec<SystemPrinter>, String> {
    blocking(spooler::list_printers).await
}

#[tauri::command]
pub async fn printer_system_status(name: String) -> Result<QueueProblems, String> {
    blocking(move || spooler::printer_status(&name)).await
}

#[tauri::command]
pub async fn printer_open(sessions: State<'_, PrinterSessions>, target: LinkTarget) -> Result<OpenedPrinter, String> {
    let sessions = sessions.inner().clone();
    blocking(move || sessions.open(&target)).await
}

#[tauri::command]
pub async fn printer_write(sessions: State<'_, PrinterSessions>, handle: u32, bytes: Vec<u8>) -> Result<(), String> {
    let sessions = sessions.inner().clone();
    blocking(move || sessions.write(handle, &bytes)).await
}

#[tauri::command]
pub async fn printer_read(sessions: State<'_, PrinterSessions>, handle: u32, timeout_ms: u64) -> Result<Vec<u8>, String> {
    let sessions = sessions.inner().clone();
    blocking(move || sessions.read(handle, Duration::from_millis(timeout_ms))).await
}

#[tauri::command]
pub async fn printer_close(sessions: State<'_, PrinterSessions>, handle: u32) -> Result<(), String> {
    let sessions = sessions.inner().clone();
    blocking(move || {
        sessions.close(handle);
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn printer_print_system(name: String, bytes: Vec<u8>) -> Result<String, String> {
    blocking(move || spooler::print_raw(&name, &bytes)).await
}

#[tauri::command]
pub async fn printer_system_job_status(name: String, job: String) -> Result<JobStatus, String> {
    blocking(move || spooler::job_status(&name, &job)).await
}

#[tauri::command]
pub async fn printer_system_cancel(name: String, job: String) -> Result<(), String> {
    blocking(move || spooler::cancel_job(&name, &job)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    /// A tiny ESC/POS printer on localhost: answers DLE EOT n with "all fine" and GS r 1 with "paper OK".
    fn fake_printer() -> (u16, std::thread::JoinHandle<Vec<u8>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = std::thread::spawn(move || {
            let (mut s, _) = listener.accept().unwrap();
            let mut received = Vec::new();
            let mut buf = [0u8; 256];
            loop {
                let n = match s.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => n,
                };
                received.extend_from_slice(&buf[..n]);
                // Answer every complete query seen so far (simple: scan the tail of what arrived).
                let chunk = &buf[..n];
                for w in chunk.windows(3) {
                    match w {
                        [0x10, 0x04, 1 | 2 | 4] => s.write_all(&[0x12]).unwrap(),
                        [0x1d, 0x72, 0x01] => s.write_all(&[0x00]).unwrap(),
                        _ => {}
                    }
                }
            }
            received
        });
        (port, handle)
    }

    #[test]
    fn session_round_trip_through_the_command_layer() {
        let (port, printer) = fake_printer();
        let sessions = PrinterSessions::default();
        let opened = sessions.open(&LinkTarget::Network { host: "127.0.0.1".into(), port }).unwrap();
        assert!(opened.handle > 0);
        assert_eq!(opened.baud, None);

        sessions.write(opened.handle, &[0x10, 0x04, 0x01]).unwrap();
        assert_eq!(sessions.read(opened.handle, Duration::from_secs(2)).unwrap(), vec![0x12]);
        sessions.write(opened.handle, b"\x1b@Hello\n\x1dr\x01").unwrap();
        assert_eq!(sessions.read(opened.handle, Duration::from_secs(2)).unwrap(), vec![0x00]);
        assert!(sessions.read(opened.handle, Duration::from_millis(100)).unwrap().is_empty());

        sessions.close(opened.handle);
        assert!(sessions.write(opened.handle, b"x").is_err(), "closed handle is refused");
        let received = printer.join().unwrap();
        assert!(received.windows(5).any(|w| w == b"Hello"));
    }

    #[test]
    fn opening_the_same_printer_again_replaces_the_old_session() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let accepter = std::thread::spawn(move || {
            let mut conns = Vec::new();
            for _ in 0..2 {
                conns.push(listener.accept().unwrap().0);
            }
            // First connection must have been closed by the client: reading it hits EOF.
            let mut buf = [0u8; 8];
            conns[0].set_read_timeout(Some(Duration::from_secs(2))).unwrap();
            conns[0].read(&mut buf).unwrap()
        });
        let sessions = PrinterSessions::default();
        let target = LinkTarget::Network { host: "127.0.0.1".into(), port };
        let first = sessions.open(&target).unwrap();
        let second = sessions.open(&target).unwrap();
        assert_ne!(first.handle, second.handle);
        assert!(sessions.read(first.handle, Duration::from_millis(10)).is_err());
        assert_eq!(accepter.join().unwrap(), 0, "old connection closed");
        sessions.close(second.handle);
    }

    /// Full path against scripts/fake-escpos-printer.mjs (the same fake printer used by hand), when Node is around.
    #[test]
    fn talks_to_the_node_fake_printer() {
        use std::process::{Command, Stdio};
        let script = concat!(env!("CARGO_MANIFEST_DIR"), "/../scripts/fake-escpos-printer.mjs");
        let port = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        let Ok(mut child) = Command::new("node")
            .args([script, &port.to_string(), "--paper-near-end"])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
        else {
            eprintln!("node not found — skipping the fake printer round trip");
            return;
        };
        // Wait for it to listen.
        let sessions = PrinterSessions::default();
        let target = LinkTarget::Network { host: "127.0.0.1".into(), port };
        let deadline = Instant::now() + Duration::from_secs(10);
        let opened = loop {
            match sessions.open(&target) {
                Ok(o) => break o,
                Err(_) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(100)),
                Err(e) => {
                    let _ = child.kill();
                    panic!("fake printer never came up: {e}");
                }
            }
        };
        let h = opened.handle;
        let ask = |n: u8| {
            sessions.write(h, &[0x10, 0x04, n]).unwrap();
            sessions.read(h, Duration::from_secs(2)).unwrap()
        };
        assert_eq!(ask(1), vec![0x12], "printer online");
        assert_eq!(ask(2), vec![0x12], "cover closed");
        assert_eq!(ask(4), vec![0x1e], "paper near end (bits 2–3)");
        sessions.write(h, b"\x1b@\x1bt\x10RISKYC TEST\nTicket \xe9t\xe9\n\x1bd\x04\x1dVB\x03\x1dr\x01").unwrap();
        assert_eq!(sessions.read(h, Duration::from_secs(5)).unwrap(), vec![0x03], "confirmation: paper near end");
        sessions.close(h);
        std::thread::sleep(Duration::from_millis(300));
        let _ = child.kill();
        let mut out = String::new();
        child.stdout.take().unwrap().read_to_string(&mut out).unwrap();
        assert!(out.contains("RISKYC TEST"), "fake printer printed the ticket: {out}");
        assert!(out.contains("Ticket été"), "Windows-1252 accents decoded: {out}");
    }
}
