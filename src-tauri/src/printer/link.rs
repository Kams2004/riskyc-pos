//! Two-way connections to a receipt printer: network (raw TCP, port 9100), serial (USB-serial adapters and
//! Bluetooth SPP, which both appear as serial ports) and, on Linux, the USB printer-class device /dev/usb/lp*.
//! All of it is blocking I/O — callers run it on a blocking thread, never on the UI thread.

use serde::Deserialize;
use std::io::{self, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::{Duration, Instant};

/// Gives up connecting after this long: a printer on the shop's network answers in well under a second.
const TCP_CONNECT_TIMEOUT: Duration = Duration::from_secs(4);
/// A write that takes longer than this means the printer stopped accepting data (off, jammed, unplugged).
const WRITE_TIMEOUT: Duration = Duration::from_secs(15);
/// Serial speeds tried, in this order, when the printer's speed isn't known yet (USB-serial adapters only:
/// Bluetooth and USB CDC links ignore the speed).
const SERIAL_BAUDS: [u32; 4] = [9600, 19200, 38400, 115200];

/// Where a two-way printer link goes. Mirrors `PrinterTarget` in lib/printer/desktopTransport.ts.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum LinkTarget {
    Network { host: String, port: u16 },
    Serial { path: String, baud: Option<u32> },
    UsbDevice { path: String },
}

impl LinkTarget {
    /// Same printer, whatever the settings — used to close a forgotten earlier session before opening a new one
    /// (most network printers accept a single connection at a time).
    pub fn identity(&self) -> String {
        match self {
            LinkTarget::Network { host, port } => format!("net:{}:{}", host.trim().to_lowercase(), port),
            LinkTarget::Serial { path, .. } => format!("serial:{path}"),
            LinkTarget::UsbDevice { path } => format!("usb:{path}"),
        }
    }
}

pub trait Link: Send {
    fn write_all_bytes(&mut self, bytes: &[u8]) -> io::Result<()>;
    /// What arrived since the last read; waits up to `timeout` for the first byte. Empty on timeout.
    fn read_some(&mut self, timeout: Duration) -> io::Result<Vec<u8>>;
}

/// The opened link, plus the serial speed it settled on (and whether the printer answered at that speed).
pub struct Opened {
    pub link: Box<dyn Link>,
    pub baud: Option<u32>,
    pub baud_confirmed: bool,
}

pub fn open(target: &LinkTarget) -> io::Result<Opened> {
    match target {
        LinkTarget::Network { host, port } => {
            let link = TcpLink::connect(host, *port)?;
            Ok(Opened { link: Box::new(link), baud: None, baud_confirmed: false })
        }
        LinkTarget::Serial { path, baud } => open_serial(path, *baud),
        LinkTarget::UsbDevice { path } => {
            #[cfg(unix)]
            {
                let link = UsbLpLink::open(path)?;
                Ok(Opened { link: Box::new(link), baud: None, baud_confirmed: false })
            }
            #[cfg(not(unix))]
            {
                let _ = path;
                Err(io::Error::new(io::ErrorKind::Unsupported, "direct USB devices are only available on Linux"))
            }
        }
    }
}

fn is_timeout(e: &io::Error) -> bool {
    matches!(e.kind(), io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock)
}

fn closed_by_printer() -> io::Error {
    io::Error::new(io::ErrorKind::ConnectionAborted, "the printer closed the connection")
}

// ── Network ─────────────────────────────────────────────────────────────────────────────────────────────────────

pub struct TcpLink {
    stream: TcpStream,
}

impl TcpLink {
    pub fn connect(host: &str, port: u16) -> io::Result<Self> {
        let host = host.trim();
        let addrs: Vec<_> = (host, port).to_socket_addrs()?.collect();
        let mut last = io::Error::new(io::ErrorKind::NotFound, format!("no address for {host}"));
        for addr in addrs {
            match TcpStream::connect_timeout(&addr, TCP_CONNECT_TIMEOUT) {
                Ok(stream) => {
                    stream.set_nodelay(true)?;
                    stream.set_write_timeout(Some(WRITE_TIMEOUT))?;
                    return Ok(Self { stream });
                }
                Err(e) => last = e,
            }
        }
        Err(last)
    }
}

impl Link for TcpLink {
    fn write_all_bytes(&mut self, bytes: &[u8]) -> io::Result<()> {
        self.stream.write_all(bytes)?;
        self.stream.flush()
    }

    fn read_some(&mut self, timeout: Duration) -> io::Result<Vec<u8>> {
        let mut buf = [0u8; 512];
        self.stream.set_read_timeout(Some(timeout.max(Duration::from_millis(1))))?;
        let n = match self.stream.read(&mut buf) {
            Ok(0) => return Err(closed_by_printer()),
            Ok(n) => n,
            Err(e) if is_timeout(&e) => return Ok(Vec::new()),
            Err(e) => return Err(e),
        };
        let mut out = buf[..n].to_vec();
        // Take whatever else is already waiting, without waiting for more.
        self.stream.set_nonblocking(true)?;
        loop {
            match self.stream.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => out.extend_from_slice(&buf[..n]),
                Err(_) => break,
            }
        }
        self.stream.set_nonblocking(false)?;
        Ok(out)
    }
}

// ── Serial (USB-serial, Bluetooth SPP) ──────────────────────────────────────────────────────────────────────────

pub struct SerialLink {
    port: Box<dyn serialport::SerialPort>,
}

impl SerialLink {
    fn open(path: &str, baud: u32) -> io::Result<Self> {
        let port = serialport::new(path, baud)
            .timeout(WRITE_TIMEOUT)
            .open()
            .map_err(|e| io::Error::new(serial_error_kind(&e), format!("{path}: {e}")))?;
        Ok(Self { port })
    }
}

fn serial_error_kind(e: &serialport::Error) -> io::ErrorKind {
    match e.kind() {
        serialport::ErrorKind::NoDevice => io::ErrorKind::NotFound,
        serialport::ErrorKind::Io(kind) => kind,
        _ => io::ErrorKind::Other,
    }
}

impl Link for SerialLink {
    fn write_all_bytes(&mut self, bytes: &[u8]) -> io::Result<()> {
        self.port.set_timeout(WRITE_TIMEOUT).map_err(io::Error::from)?;
        self.port.write_all(bytes)?;
        self.port.flush()
    }

    fn read_some(&mut self, timeout: Duration) -> io::Result<Vec<u8>> {
        let mut buf = [0u8; 512];
        self.port.set_timeout(timeout.max(Duration::from_millis(1))).map_err(io::Error::from)?;
        let n = match self.port.read(&mut buf) {
            Ok(0) => return Ok(Vec::new()),
            Ok(n) => n,
            Err(e) if is_timeout(&e) => return Ok(Vec::new()),
            Err(e) => return Err(e),
        };
        let mut out = buf[..n].to_vec();
        while let Ok(waiting) = self.port.bytes_to_read() {
            if waiting == 0 {
                break;
            }
            match self.port.read(&mut buf) {
                Ok(n) if n > 0 => out.extend_from_slice(&buf[..n]),
                _ => break,
            }
        }
        Ok(out)
    }
}

/// A USB-serial adapter (FTDI, Prolific, CH340, CP210x): the printer's speed matters and isn't known.
/// Bluetooth, USB CDC (ttyACM) and others ignore the speed.
fn speed_matters(path: &str) -> bool {
    if path.contains("ttyUSB") {
        return true;
    }
    if cfg!(windows) {
        if let Ok(ports) = serialport::available_ports() {
            return ports.iter().any(|p| {
                p.port_name.eq_ignore_ascii_case(path)
                    && matches!(&p.port_type, serialport::SerialPortType::UsbPort(info)
                        if matches!(info.vid, 0x0403 | 0x067b | 0x1a86 | 0x10c4))
            });
        }
    }
    false
}

/// Does something answer DLE EOT 1 at this speed with a well-formed status byte?
fn answers_status(link: &mut SerialLink) -> bool {
    let _ = link.port.clear(serialport::ClearBuffer::Input);
    if link.write_all_bytes(&[0x10, 0x04, 0x01]).is_err() {
        return false;
    }
    let deadline = Instant::now() + Duration::from_millis(500);
    while Instant::now() < deadline {
        match link.read_some(deadline.saturating_duration_since(Instant::now())) {
            Ok(bytes) if bytes.is_empty() => return false,
            Ok(bytes) => {
                if bytes.iter().any(|b| b & 0x93 == 0x12) {
                    return true;
                }
            }
            Err(_) => return false,
        }
    }
    false
}

fn open_serial(path: &str, baud: Option<u32>) -> io::Result<Opened> {
    if let Some(baud) = baud {
        let link = SerialLink::open(path, baud)?;
        return Ok(Opened { link: Box::new(link), baud: Some(baud), baud_confirmed: false });
    }
    if !speed_matters(path) {
        let link = SerialLink::open(path, SERIAL_BAUDS[0])?;
        return Ok(Opened { link: Box::new(link), baud: Some(SERIAL_BAUDS[0]), baud_confirmed: false });
    }
    // Unknown speed on an adapter: the speed the printer answers at is the right one.
    for baud in SERIAL_BAUDS {
        let mut link = SerialLink::open(path, baud)?;
        if answers_status(&mut link) {
            return Ok(Opened { link: Box::new(link), baud: Some(baud), baud_confirmed: true });
        }
    }
    let link = SerialLink::open(path, SERIAL_BAUDS[0])?;
    Ok(Opened { link: Box::new(link), baud: Some(SERIAL_BAUDS[0]), baud_confirmed: false })
}

// ── Linux USB printer class (/dev/usb/lp*) ──────────────────────────────────────────────────────────────────────

#[cfg(unix)]
pub struct UsbLpLink {
    file: std::fs::File,
}

#[cfg(unix)]
impl UsbLpLink {
    fn open(path: &str) -> io::Result<Self> {
        let file = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(path)
            .map_err(|e| io::Error::new(e.kind(), format!("{path}: {e}")))?;
        Ok(Self { file })
    }

    /// Waits until the device is ready for `events`; false on timeout.
    fn wait_for(&self, events: libc::c_short, timeout: Duration) -> io::Result<bool> {
        use std::os::fd::AsRawFd;
        let mut fds = libc::pollfd { fd: self.file.as_raw_fd(), events, revents: 0 };
        let ms = timeout.as_millis().clamp(1, i32::MAX as u128) as libc::c_int;
        loop {
            let r = unsafe { libc::poll(&mut fds, 1, ms) };
            if r < 0 {
                let e = io::Error::last_os_error();
                if e.kind() == io::ErrorKind::Interrupted {
                    continue;
                }
                return Err(e);
            }
            if r > 0 && fds.revents & (libc::POLLERR | libc::POLLHUP | libc::POLLNVAL) != 0 && fds.revents & events == 0 {
                return Err(io::Error::new(io::ErrorKind::BrokenPipe, "the USB printer was disconnected"));
            }
            return Ok(r > 0);
        }
    }
}

#[cfg(unix)]
impl Link for UsbLpLink {
    fn write_all_bytes(&mut self, bytes: &[u8]) -> io::Result<()> {
        for chunk in bytes.chunks(4096) {
            let mut rest = chunk;
            while !rest.is_empty() {
                if !self.wait_for(libc::POLLOUT, WRITE_TIMEOUT)? {
                    return Err(io::Error::new(io::ErrorKind::TimedOut, "the printer stopped accepting data"));
                }
                let n = self.file.write(rest)?;
                if n == 0 {
                    return Err(io::Error::new(io::ErrorKind::WriteZero, "the printer stopped accepting data"));
                }
                rest = &rest[n..];
            }
        }
        Ok(())
    }

    fn read_some(&mut self, timeout: Duration) -> io::Result<Vec<u8>> {
        if !self.wait_for(libc::POLLIN, timeout)? {
            return Ok(Vec::new());
        }
        let mut buf = [0u8; 512];
        let n = self.file.read(&mut buf)?;
        Ok(buf[..n].to_vec())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    #[test]
    fn target_json_matches_the_typescript_shape() {
        let net: LinkTarget = serde_json::from_str(r#"{"kind":"network","host":"192.168.1.50","port":9100}"#).unwrap();
        assert_eq!(net, LinkTarget::Network { host: "192.168.1.50".into(), port: 9100 });
        let serial: LinkTarget = serde_json::from_str(r#"{"kind":"serial","path":"COM5"}"#).unwrap();
        assert_eq!(serial, LinkTarget::Serial { path: "COM5".into(), baud: None });
        let serial: LinkTarget = serde_json::from_str(r#"{"kind":"serial","path":"/dev/ttyUSB0","baud":19200}"#).unwrap();
        assert_eq!(serial, LinkTarget::Serial { path: "/dev/ttyUSB0".into(), baud: Some(19200) });
        let usb: LinkTarget = serde_json::from_str(r#"{"kind":"usbDevice","path":"/dev/usb/lp0"}"#).unwrap();
        assert_eq!(usb, LinkTarget::UsbDevice { path: "/dev/usb/lp0".into() });
    }

    #[test]
    fn tcp_round_trip_and_timeout() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let (mut s, _) = listener.accept().unwrap();
            let mut buf = [0u8; 3];
            s.read_exact(&mut buf).unwrap();
            assert_eq!(buf, [0x10, 0x04, 0x01]);
            s.write_all(&[0x12]).unwrap();
            // Then hold the connection open, silent, until the client is done.
            let mut rest = Vec::new();
            let _ = s.read_to_end(&mut rest);
        });
        let mut link = TcpLink::connect("127.0.0.1", port).unwrap();
        link.write_all_bytes(&[0x10, 0x04, 0x01]).unwrap();
        assert_eq!(link.read_some(Duration::from_secs(2)).unwrap(), vec![0x12]);
        let started = Instant::now();
        assert!(link.read_some(Duration::from_millis(150)).unwrap().is_empty(), "silence = empty read");
        assert!(started.elapsed() >= Duration::from_millis(100));
        drop(link);
        server.join().unwrap();
    }

    #[test]
    fn tcp_reports_a_closed_connection() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || drop(listener.accept().unwrap()));
        let mut link = TcpLink::connect("127.0.0.1", port).unwrap();
        server.join().unwrap();
        assert!(link.read_some(Duration::from_secs(2)).is_err());
    }

    #[test]
    fn unreachable_network_printer_fails_to_open() {
        // Bind then drop: nothing listens on that port any more.
        let port = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        assert!(open(&LinkTarget::Network { host: "127.0.0.1".into(), port }).is_err());
    }

    #[test]
    fn missing_serial_port_fails_to_open() {
        assert!(open(&LinkTarget::Serial { path: "/dev/riskyc-no-such-port".into(), baud: Some(9600) }).is_err());
    }
}
