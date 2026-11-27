//! Finding receipt printers: on the local network (anything answering on the raw printing port 9100), serial ports
//! (USB-serial adapters and paired Bluetooth printers) and, on Linux, USB printer-class devices.

use serde::Serialize;
use std::collections::BTreeSet;
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4};
use std::sync::Arc;
use std::time::Duration;

/// The raw ("JetDirect") printing port every network receipt printer listens on.
pub const RAW_PRINT_PORT: u16 = 9100;
const PROBE_TIMEOUT: Duration = Duration::from_millis(500);
/// Connections attempted at the same time: a /24 is covered in about two rounds of PROBE_TIMEOUT.
const PROBE_CONCURRENCY: usize = 192;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NetworkPrinter {
    pub host: String,
    pub port: u16,
    /// The computer's network card it was found through ("Wi-Fi", "eth0").
    pub interface: String,
}

/// Network cards that lead to the shop's network — not loopback, VPNs, virtual machines or containers.
fn is_shop_network(name: &str, ip: Ipv4Addr) -> bool {
    if ip.is_loopback() || ip.is_link_local() || ip.is_unspecified() || ip.is_multicast() {
        return false;
    }
    let lower = name.to_lowercase();
    const VIRTUAL: [&str; 18] = [
        "docker", "br-", "veth", "virbr", "vmnet", "vboxnet", "virtualbox", "vmware", "vethernet", "hyper-v", "wsl",
        "loopback", "tun", "tap", "wg", "zt", "tailscale", "utun",
    ];
    !VIRTUAL.iter().any(|v| lower.starts_with(v) || (v.len() > 3 && lower.contains(v)))
}

/// The /24 networks this computer is on (one per qualifying network card), with the card's name and own address.
pub fn local_subnets() -> Vec<(String, Ipv4Addr)> {
    let mut seen = BTreeSet::new();
    let mut out = Vec::new();
    let Ok(interfaces) = if_addrs::get_if_addrs() else { return out };
    for iface in interfaces {
        let if_addrs::IfAddr::V4(v4) = &iface.addr else { continue };
        if !iface.is_oper_up() || iface.is_p2p() || !is_shop_network(&iface.name, v4.ip) {
            continue;
        }
        let [a, b, c, _] = v4.ip.octets();
        if seen.insert((a, b, c)) {
            out.push((iface.name.clone(), v4.ip));
        }
    }
    out
}

/// Every other host of `own`'s /24 on `port`.
pub fn subnet_hosts(own: Ipv4Addr, port: u16) -> Vec<SocketAddr> {
    let [a, b, c, d] = own.octets();
    (1..=254u8)
        .filter(|&h| h != d)
        .map(|h| SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::new(a, b, c, h), port)))
        .collect()
}

/// Tries all `addrs` at once (at most PROBE_CONCURRENCY in flight); returns the ones that accepted a connection.
/// The connection is closed straight away — nothing is sent, so an office printer on 9100 doesn't print anything.
pub async fn probe(addrs: Vec<SocketAddr>, timeout: Duration) -> Vec<SocketAddr> {
    let limit = Arc::new(tokio::sync::Semaphore::new(PROBE_CONCURRENCY));
    let mut tasks = tokio::task::JoinSet::new();
    for addr in addrs {
        let limit = limit.clone();
        tasks.spawn(async move {
            let _permit = limit.acquire_owned().await.ok()?;
            match tokio::time::timeout(timeout, tokio::net::TcpStream::connect(addr)).await {
                Ok(Ok(stream)) => {
                    drop(stream);
                    Some(addr)
                }
                _ => None,
            }
        });
    }
    let mut found = Vec::new();
    while let Some(done) = tasks.join_next().await {
        if let Ok(Some(addr)) = done {
            found.push(addr);
        }
    }
    found.sort();
    found
}

pub async fn scan_network() -> Vec<NetworkPrinter> {
    let subnets = local_subnets();
    let mut addrs = Vec::new();
    let mut via = std::collections::HashMap::new();
    for (name, ip) in &subnets {
        let [a, b, c, _] = ip.octets();
        via.insert((a, b, c), name.clone());
        addrs.extend(subnet_hosts(*ip, RAW_PRINT_PORT));
    }
    probe(addrs, PROBE_TIMEOUT)
        .await
        .into_iter()
        .filter_map(|addr| match addr {
            SocketAddr::V4(v4) => {
                let [a, b, c, _] = v4.ip().octets();
                Some(NetworkPrinter {
                    host: v4.ip().to_string(),
                    port: v4.port(),
                    interface: via.get(&(a, b, c)).cloned().unwrap_or_default(),
                })
            }
            SocketAddr::V6(_) => None,
        })
        .collect()
}

// ── Serial ports ────────────────────────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SerialPrinter {
    /// What to open: "COM5", "/dev/rfcomm0", "/dev/ttyUSB0".
    pub path: String,
    /// "bluetooth", "usb", "cable" (a built-in RS-232 port) or "unknown".
    pub connection: String,
    /// Best human name known: the Bluetooth device's name, the USB product, or Windows' port description.
    pub name: Option<String>,
    pub manufacturer: Option<String>,
    pub vid: Option<u16>,
    pub pid: Option<u16>,
}

pub fn list_serial() -> Vec<SerialPrinter> {
    let mut out: Vec<SerialPrinter> = serialport::available_ports()
        .unwrap_or_default()
        .into_iter()
        .map(|p| {
            let (connection, name, manufacturer, vid, pid) = match p.port_type {
                serialport::SerialPortType::UsbPort(info) => ("usb", info.product, info.manufacturer, Some(info.vid), Some(info.pid)),
                serialport::SerialPortType::BluetoothPort => ("bluetooth", None, None, None, None),
                serialport::SerialPortType::PciPort => ("cable", None, None, None, None),
                serialport::SerialPortType::Unknown => ("unknown", None, None, None, None),
            };
            SerialPrinter { path: p.port_name, connection: connection.into(), name, manufacturer, vid, pid }
        })
        .collect();

    // Windows: serialport can't tell Bluetooth ports apart; the device manager's own description can.
    #[cfg(windows)]
    {
        let described = super::windows::describe_com_ports();
        out.retain(|p| !described.iter().any(|d| d.port.eq_ignore_ascii_case(&p.path) && d.incoming_bluetooth));
        for p in &mut out {
            if let Some(d) = described.iter().find(|d| d.port.eq_ignore_ascii_case(&p.path)) {
                if d.bluetooth {
                    p.connection = "bluetooth".into();
                    p.name = d.device_name.clone().or_else(|| d.friendly_name.clone());
                } else if p.name.is_none() {
                    p.name = d.friendly_name.clone();
                }
            }
        }
    }

    // Linux: built-in ttyS ports are listed for every possible UART; only keep those with real hardware behind them.
    #[cfg(target_os = "linux")]
    out.retain(|p| !(p.path.starts_with("/dev/ttyS") && p.connection == "unknown"));

    out.sort_by(|a, b| a.path.cmp(&b.path));
    out
}

// ── Linux USB printer class ─────────────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UsbDevicePrinter {
    pub path: String,
    pub name: Option<String>,
    /// False when this user isn't allowed to open it (not in the `lp` group).
    pub accessible: bool,
}

/// `MFG:Xprinter;MDL:XP-80;CMD:ESC/POS;` → "Xprinter XP-80".
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn ieee1284_name(id: &str) -> Option<String> {
    let field = |keys: &[&str]| {
        id.split(';').find_map(|kv| {
            let (k, v) = kv.split_once(':')?;
            keys.iter().any(|key| k.trim().eq_ignore_ascii_case(key)).then(|| v.trim().to_string()).filter(|v| !v.is_empty())
        })
    };
    let mfg = field(&["MFG", "MANUFACTURER"]);
    let mdl = field(&["MDL", "MODEL"]);
    match (mfg, mdl) {
        (Some(m), Some(d)) if d.to_lowercase().starts_with(&m.to_lowercase()) => Some(d),
        (Some(m), Some(d)) => Some(format!("{m} {d}")),
        (None, Some(d)) => Some(d),
        (Some(m), None) => Some(m),
        (None, None) => None,
    }
}

#[cfg(target_os = "linux")]
pub fn list_usb_devices() -> Vec<UsbDevicePrinter> {
    let Ok(entries) = std::fs::read_dir("/dev/usb") else { return Vec::new() };
    let mut out: Vec<UsbDevicePrinter> = entries
        .flatten()
        .filter_map(|e| {
            let file = e.file_name().to_string_lossy().to_string();
            if !file.starts_with("lp") {
                return None;
            }
            let path = format!("/dev/usb/{file}");
            let sys = format!("/sys/class/usbmisc/{file}/device");
            let name = std::fs::read_to_string(format!("{sys}/ieee1284_id"))
                .ok()
                .and_then(|id| ieee1284_name(&id))
                .or_else(|| std::fs::read_to_string(format!("{sys}/../product")).ok().map(|s| s.trim().to_string()))
                .filter(|s| !s.is_empty());
            let c_path = std::ffi::CString::new(path.clone()).ok()?;
            let accessible = unsafe { libc::access(c_path.as_ptr(), libc::R_OK | libc::W_OK) } == 0;
            Some(UsbDevicePrinter { path, name, accessible })
        })
        .collect();
    out.sort_by(|a, b| a.path.cmp(&b.path));
    out
}

#[cfg(not(target_os = "linux"))]
pub fn list_usb_devices() -> Vec<UsbDevicePrinter> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    #[test]
    fn skips_loopback_virtual_and_link_local() {
        assert!(!is_shop_network("lo", Ipv4Addr::new(127, 0, 0, 1)));
        assert!(!is_shop_network("docker0", Ipv4Addr::new(172, 17, 0, 1)));
        assert!(!is_shop_network("vEthernet (WSL)", Ipv4Addr::new(172, 28, 0, 1)));
        assert!(!is_shop_network("VirtualBox Host-Only Network", Ipv4Addr::new(192, 168, 56, 1)));
        assert!(!is_shop_network("Ethernet", Ipv4Addr::new(169, 254, 3, 4)));
        assert!(!is_shop_network("tailscale0", Ipv4Addr::new(100, 64, 0, 2)));
        assert!(is_shop_network("Wi-Fi", Ipv4Addr::new(192, 168, 1, 20)));
        assert!(is_shop_network("wlp2s0", Ipv4Addr::new(192, 168, 1, 20)));
        assert!(is_shop_network("eth0", Ipv4Addr::new(10, 0, 0, 5)));
        assert!(is_shop_network("enp3s0", Ipv4Addr::new(10, 0, 0, 5)));
    }

    #[test]
    fn local_subnets_never_include_loopback() {
        assert!(local_subnets().iter().all(|(_, ip)| !ip.is_loopback()));
    }

    #[test]
    fn subnet_covers_the_24_without_this_computer() {
        let hosts = subnet_hosts(Ipv4Addr::new(192, 168, 1, 20), 9100);
        assert_eq!(hosts.len(), 253);
        assert!(!hosts.contains(&"192.168.1.20:9100".parse().unwrap()));
        assert!(hosts.contains(&"192.168.1.1:9100".parse().unwrap()));
        assert!(hosts.contains(&"192.168.1.254:9100".parse().unwrap()));
    }

    #[tokio::test]
    async fn probe_finds_the_listening_printer_only_and_is_quick() {
        let printer = TcpListener::bind("127.0.0.1:0").unwrap();
        let open = printer.local_addr().unwrap();
        let closed = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap();
        // 127.0.0.0/8 all loops back: hosts .2–.254 on the printer's port refuse; together that's a full /24 probe.
        let mut addrs: Vec<SocketAddr> = (2..=254u8).map(|h| SocketAddr::from(([127, 0, 0, h], closed.port()))).collect();
        addrs.push(open);
        let started = std::time::Instant::now();
        let found = probe(addrs, Duration::from_millis(400)).await;
        assert_eq!(found, vec![open]);
        assert!(started.elapsed() < Duration::from_secs(3), "took {:?}", started.elapsed());
    }

    /// Scans this computer's real network: `cargo test real_network_scan -- --ignored --nocapture`.
    #[tokio::test]
    #[ignore]
    async fn real_network_scan_finishes_in_a_few_seconds() {
        let started = std::time::Instant::now();
        let found = scan_network().await;
        println!("subnets: {:?}", local_subnets());
        println!("found on port 9100: {found:?} in {:?}", started.elapsed());
        assert!(started.elapsed() < Duration::from_secs(8));
    }

    #[test]
    fn printer_names_from_ieee1284_ids() {
        assert_eq!(ieee1284_name("MFG:Xprinter;MDL:XP-80;CMD:ESC/POS;").as_deref(), Some("Xprinter XP-80"));
        assert_eq!(ieee1284_name("MANUFACTURER:EPSON;MODEL:EPSON TM-T20II;").as_deref(), Some("EPSON TM-T20II"));
        assert_eq!(ieee1284_name("CLS:PRINTER;"), None);
    }

    #[test]
    fn listing_ports_and_devices_does_not_fail() {
        let _ = list_serial();
        let _ = list_usb_devices();
    }
}
