//! Printers installed in the operating system, used one-way: the ticket's bytes go through the system's print queue
//! untouched (RAW), and the queue tells whether the job left it cleanly or got stuck on an error. Windows: winspool
//! (see windows.rs). Linux: CUPS through `lpstat`, `lp -o raw` and `cancel`.

use serde::Serialize;

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QueueProblems {
    pub offline: bool,
    pub paper_out: bool,
    pub cover_open: bool,
    pub error: bool,
    pub paused: bool,
    pub needs_attention: bool,
    /// What the driver or the queue says, in its own words (may be in English only).
    pub message: Option<String>,
}

impl QueueProblems {
    #[allow(dead_code)] // used by the Windows build
    pub fn merge(self, other: QueueProblems) -> QueueProblems {
        QueueProblems {
            offline: self.offline || other.offline,
            paper_out: self.paper_out || other.paper_out,
            cover_open: self.cover_open || other.cover_open,
            error: self.error || other.error,
            paused: self.paused || other.paused,
            needs_attention: self.needs_attention || other.needs_attention,
            message: self.message.or(other.message),
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SystemPrinter {
    pub name: String,
    pub driver: Option<String>,
    /// Windows port ("USB001", "IP_192.168.1.50") or CUPS device URI ("usb://…", "socket://…").
    pub port: Option<String>,
    /// "usb", "network", "serial", "bluetooth", "virtual" (PDF, fax, file) or "other".
    pub connection: String,
    pub is_default: bool,
    pub problems: QueueProblems,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum JobState {
    /// Waiting in the queue (or being spooled).
    Queued,
    /// Being sent to the printer.
    Printing,
    /// Left the queue: handed over to the printer.
    Done,
    /// Cancelled (by someone, or by the system). Only Windows reports it; CUPS just drops the job from the queue.
    #[cfg_attr(not(windows), allow(dead_code))]
    Deleted,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct JobStatus {
    pub state: JobState,
    /// Problems on the job or on its printer.
    pub problems: QueueProblems,
}

#[cfg(windows)]
pub use super::windows::{cancel_job, job_status, list_printers, print_raw, printer_status};

#[cfg(not(windows))]
pub use cups::{cancel_job, job_status, list_printers, print_raw, printer_status};

#[cfg(not(windows))]
mod cups {
    use super::*;
    use std::io::Write;
    use std::process::{Command, Stdio};

    fn run(program: &str, args: &[&str]) -> Result<String, String> {
        let out = Command::new(program)
            .args(args)
            .env("LC_ALL", "C")
            .env("LANG", "C")
            .stdin(Stdio::null())
            .output()
            .map_err(|e| format!("{program}: {e}"))?;
        let stdout = String::from_utf8_lossy(&out.stdout).to_string();
        if !out.status.success() && stdout.trim().is_empty() {
            return Err(format!("{program}: {}", String::from_utf8_lossy(&out.stderr).trim()));
        }
        Ok(stdout)
    }

    /// One block of `lpstat -p`: "printer NAME is idle. enabled since …" followed by tab-indented messages.
    #[derive(Debug, Default, PartialEq, Eq)]
    pub(super) struct PrinterState {
        pub name: String,
        pub disabled: bool,
        pub printing_job: Option<String>,
        pub messages: Vec<String>,
    }

    pub(super) fn parse_lpstat_p(text: &str) -> Vec<PrinterState> {
        let mut out: Vec<PrinterState> = Vec::new();
        for line in text.lines() {
            if let Some(rest) = line.strip_prefix("printer ") {
                let name = rest.split_whitespace().next().unwrap_or_default().to_string();
                let after = &rest[name.len()..];
                let printing_job = after
                    .find("now printing ")
                    .and_then(|i| after[i + "now printing ".len()..].split_whitespace().next())
                    .map(|job| job.trim_end_matches('.').to_string());
                out.push(PrinterState { name, disabled: after.contains("disabled"), printing_job, messages: Vec::new() });
            } else if line.starts_with(char::is_whitespace) {
                if let Some(last) = out.last_mut() {
                    let msg = line.trim();
                    if !msg.is_empty() {
                        last.messages.push(msg.to_string());
                    }
                }
            }
        }
        out
    }

    pub(super) fn problems_of(state: &PrinterState) -> QueueProblems {
        let message = state.messages.iter().find(|m| !m.to_lowercase().starts_with("form mounted")).cloned();
        let lower = message.clone().unwrap_or_default().to_lowercase();
        QueueProblems {
            offline: lower.contains("waiting for printer")
                || lower.contains("not connected")
                || lower.contains("unable to")
                || lower.contains("offline")
                || lower.contains("not responding"),
            paper_out: lower.contains("media-empty") || lower.contains("media empty") || lower.contains("out of paper"),
            cover_open: lower.contains("door-open") || lower.contains("cover-open") || lower.contains("cover open"),
            error: lower.contains("error"),
            paused: state.disabled,
            needs_attention: state.disabled,
            message,
        }
    }

    fn state_of(name: &str) -> PrinterState {
        run("lpstat", &["-p", name])
            .ok()
            .and_then(|out| parse_lpstat_p(&out).into_iter().find(|p| p.name == name))
            .unwrap_or_default()
    }

    pub(super) fn connection_of_uri(uri: &str) -> &'static str {
        let scheme = uri.split(':').next().unwrap_or_default().to_lowercase();
        match scheme.as_str() {
            "usb" | "parallel" | "hp" => "usb",
            "socket" | "ipp" | "ipps" | "lpd" | "dnssd" | "http" | "https" | "smb" | "implicitclass" => "network",
            "serial" => "serial",
            "bluetooth" | "bluez" => "bluetooth",
            "cups-pdf" | "file" | "cups-brf" => "virtual",
            _ => "other",
        }
    }

    pub fn list_printers() -> Result<Vec<SystemPrinter>, String> {
        // No CUPS (or no lpstat) is not an error: there are just no system printers.
        let Ok(devices) = run("lpstat", &["-v"]) else { return Ok(Vec::new()) };
        let default = run("lpstat", &["-d"]).ok().and_then(|d| d.split_once(':').map(|(_, n)| n.trim().to_string()));
        let states = run("lpstat", &["-p"]).map(|s| parse_lpstat_p(&s)).unwrap_or_default();
        Ok(devices
            .lines()
            .filter_map(|line| {
                // "device for POS58: usb://Xprinter/XP-58?serial=…"
                let rest = line.strip_prefix("device for ")?;
                let (name, uri) = rest.split_once(": ")?;
                let state = states.iter().find(|s| s.name == name);
                Some(SystemPrinter {
                    name: name.to_string(),
                    driver: None,
                    port: Some(uri.trim().to_string()),
                    connection: connection_of_uri(uri.trim()).into(),
                    is_default: default.as_deref() == Some(name),
                    problems: state.map(problems_of).unwrap_or_default(),
                })
            })
            .collect())
    }

    pub fn printer_status(name: &str) -> Result<QueueProblems, String> {
        let state = state_of(name);
        if state.name.is_empty() {
            return Err(format!("{name}: no such printer"));
        }
        Ok(problems_of(&state))
    }

    /// "request id is POS58-12 (1 file(s))" → "POS58-12".
    pub(super) fn parse_request_id(out: &str) -> Option<String> {
        let i = out.find("request id is ")?;
        out[i + "request id is ".len()..].split_whitespace().next().map(str::to_string)
    }

    pub fn print_raw(name: &str, bytes: &[u8]) -> Result<String, String> {
        let mut child = Command::new("lp")
            .args(["-d", name, "-o", "raw", "-t", "Riskyc POS ticket"])
            .env("LC_ALL", "C")
            .env("LANG", "C")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("lp: {e}"))?;
        child.stdin.take().ok_or("lp: no input")?.write_all(bytes).map_err(|e| format!("lp: {e}"))?;
        let out = child.wait_with_output().map_err(|e| format!("lp: {e}"))?;
        let stdout = String::from_utf8_lossy(&out.stdout);
        if !out.status.success() {
            return Err(format!("lp: {}", String::from_utf8_lossy(&out.stderr).trim()));
        }
        parse_request_id(&stdout).ok_or_else(|| format!("lp: unexpected answer: {}", stdout.trim()))
    }

    pub fn job_status(name: &str, job: &str) -> Result<JobStatus, String> {
        // Without -W, lpstat -o lists the jobs not completed yet.
        let pending = run("lpstat", &["-o", name])?;
        let queued = pending.lines().any(|l| l.split_whitespace().next() == Some(job));
        let state = state_of(name);
        let problems = problems_of(&state);
        let job_state = if !queued {
            JobState::Done
        } else if state.printing_job.as_deref() == Some(job) {
            JobState::Printing
        } else {
            JobState::Queued
        };
        Ok(JobStatus { state: job_state, problems })
    }

    pub fn cancel_job(_name: &str, job: &str) -> Result<(), String> {
        run("cancel", &[job]).map(|_| ())
    }
}

#[cfg(all(test, not(windows)))]
mod tests {
    use super::cups::*;

    #[test]
    fn parses_cups_printer_states() {
        let text = "printer POS58 is idle.  enabled since Fri 27 Nov 2026 10:00:00\n\
                    printer XP80 now printing XP80-41.  enabled since Fri 27 Nov 2026 10:01:00\n\
                    \tWaiting for printer to become available.\n\
                    printer Office disabled since Fri 27 Nov 2026 09:00:00 -\n\
                    \tPaused\n";
        let states = parse_lpstat_p(text);
        assert_eq!(states.len(), 3);
        assert_eq!(states[0].name, "POS58");
        assert!(!problems_of(&states[0]).offline);
        assert_eq!(states[1].printing_job.as_deref(), Some("XP80-41"));
        assert!(problems_of(&states[1]).offline, "waiting for printer = not reachable");
        assert!(states[2].disabled);
        assert!(problems_of(&states[2]).paused);
    }

    #[test]
    fn parses_lp_answer_and_uris() {
        assert_eq!(parse_request_id("request id is POS58-12 (1 file(s))\n").as_deref(), Some("POS58-12"));
        assert_eq!(parse_request_id("nope"), None);
        assert_eq!(connection_of_uri("usb://Xprinter/XP-58?serial=123"), "usb");
        assert_eq!(connection_of_uri("socket://192.168.1.50:9100"), "network");
        assert_eq!(connection_of_uri("cups-pdf:/"), "virtual");
    }

    #[test]
    fn listing_system_printers_does_not_fail() {
        assert!(list_printers().is_ok());
    }
}
