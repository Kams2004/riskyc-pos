//! Windows only: printers installed in Windows (the print spooler, winspool) and the device manager's descriptions of
//! COM ports (to recognise Bluetooth printers). USB thermal printers installed with a driver ("POS-58", "XP-80",
//! "Generic / Text Only") are reached through the spooler with RAW data — the bytes go to the printer untouched.

use super::spooler::{JobState, JobStatus, QueueProblems, SystemPrinter};
use std::ptr;
use windows_sys::Win32::Devices::DeviceAndDriverInstallation::{
    SetupDiDestroyDeviceInfoList, SetupDiEnumDeviceInfo, SetupDiGetClassDevsW, SetupDiGetDeviceInstanceIdW,
    SetupDiGetDeviceRegistryPropertyW, DIGCF_PRESENT, GUID_DEVCLASS_PORTS, SPDRP_FRIENDLYNAME, SP_DEVINFO_DATA,
};
use windows_sys::Win32::Foundation::{GetLastError, ERROR_INVALID_DATATYPE, ERROR_INVALID_PARAMETER, INVALID_HANDLE_VALUE};
use windows_sys::Win32::Graphics::Printing::*;
use windows_sys::Win32::System::Registry::{RegCloseKey, RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_LOCAL_MACHINE, KEY_READ};

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// A NUL-terminated UTF-16 string owned by Windows → String (None for a null pointer or an empty string).
unsafe fn from_wide(p: *const u16) -> Option<String> {
    if p.is_null() {
        return None;
    }
    let mut len = 0usize;
    while *p.add(len) != 0 {
        len += 1;
    }
    let s = String::from_utf16_lossy(std::slice::from_raw_parts(p, len));
    (!s.is_empty()).then_some(s)
}

fn last_error(what: &str) -> String {
    let code = unsafe { GetLastError() };
    format!("{what} failed (Windows error {code})")
}

/// An open printer handle, closed on drop.
struct Printer(PRINTER_HANDLE);

impl Printer {
    fn open(name: &str) -> Result<Self, String> {
        let name = wide(name);
        let mut handle = PRINTER_HANDLE { Value: ptr::null_mut() };
        if unsafe { OpenPrinterW(name.as_ptr(), &mut handle, ptr::null()) } == 0 {
            return Err(last_error("OpenPrinter"));
        }
        Ok(Self(handle))
    }
}

impl Drop for Printer {
    fn drop(&mut self) {
        unsafe { ClosePrinter(self.0) };
    }
}

/// Buffer for the Get*/Enum* calls: u64-aligned, since Windows writes structs with pointers into it.
fn aligned_buffer(bytes: u32) -> Vec<u64> {
    vec![0u64; (bytes as usize).div_ceil(8).max(1)]
}

// ── Status flags → plain problems ───────────────────────────────────────────────────────────────────────────────

fn printer_problems(status: u32, attributes: u32) -> QueueProblems {
    QueueProblems {
        offline: status & (PRINTER_STATUS_OFFLINE | PRINTER_STATUS_NOT_AVAILABLE | PRINTER_STATUS_SERVER_OFFLINE) != 0
            || attributes & PRINTER_ATTRIBUTE_WORK_OFFLINE != 0,
        paper_out: status & (PRINTER_STATUS_PAPER_OUT | PRINTER_STATUS_PAPER_PROBLEM) != 0,
        cover_open: status & PRINTER_STATUS_DOOR_OPEN != 0,
        error: status & (PRINTER_STATUS_ERROR | PRINTER_STATUS_PAPER_JAM) != 0,
        paused: status & PRINTER_STATUS_PAUSED != 0,
        needs_attention: status & PRINTER_STATUS_USER_INTERVENTION != 0,
        message: None,
    }
}

fn job_problems(status: u32) -> QueueProblems {
    QueueProblems {
        offline: status & JOB_STATUS_OFFLINE != 0,
        paper_out: status & JOB_STATUS_PAPEROUT != 0,
        cover_open: false,
        error: status & (JOB_STATUS_ERROR | JOB_STATUS_BLOCKED_DEVQ) != 0,
        paused: status & JOB_STATUS_PAUSED != 0,
        needs_attention: status & JOB_STATUS_USER_INTERVENTION != 0,
        message: None,
    }
}

/// "USB001" → usb, "COM3:" → serial, "IP_192.168.1.50" / "WSD-…" / "192.168.1.50" → network, PDF/XPS/file → virtual.
fn connection_of(port: &str, name: &str, driver: &str) -> &'static str {
    let p = port.to_uppercase();
    let label = format!("{name} {driver}").to_uppercase();
    if p.starts_with("USB") || p.starts_with("DOT4") {
        "usb"
    } else if p.starts_with("COM") {
        "serial"
    } else if p.starts_with("BTH") {
        "bluetooth"
    } else if p.starts_with("IP_") || p.starts_with("WSD") || p.starts_with("TCP") || p.contains("://") || p.chars().next().is_some_and(|c| c.is_ascii_digit()) {
        "network"
    } else if p.starts_with("PORTPROMPT") || p.starts_with("FILE") || p.starts_with("NUL") || p.starts_with("SHRFAX") || p.starts_with("XPS")
        || label.contains("PDF") || label.contains("XPS") || label.contains("ONENOTE") || label.contains("FAX")
    {
        "virtual"
    } else {
        "other"
    }
}

fn default_printer() -> Option<String> {
    let mut len = 0u32;
    unsafe { GetDefaultPrinterW(ptr::null_mut(), &mut len) };
    if len == 0 {
        return None;
    }
    let mut buf = vec![0u16; len as usize];
    if unsafe { GetDefaultPrinterW(buf.as_mut_ptr(), &mut len) } == 0 {
        return None;
    }
    unsafe { from_wide(buf.as_ptr()) }
}

pub fn list_printers() -> Result<Vec<SystemPrinter>, String> {
    let flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
    let (mut needed, mut count) = (0u32, 0u32);
    unsafe { EnumPrintersW(flags, ptr::null(), 2, ptr::null_mut(), 0, &mut needed, &mut count) };
    if needed == 0 {
        return Ok(Vec::new());
    }
    let mut buf = aligned_buffer(needed);
    let size = (buf.len() * 8) as u32;
    if unsafe { EnumPrintersW(flags, ptr::null(), 2, buf.as_mut_ptr() as *mut u8, size, &mut needed, &mut count) } == 0 {
        return Err(last_error("EnumPrinters"));
    }
    let default = default_printer();
    let infos = unsafe { std::slice::from_raw_parts(buf.as_ptr() as *const PRINTER_INFO_2W, count as usize) };
    Ok(infos
        .iter()
        .filter_map(|info| unsafe {
            let name = from_wide(info.pPrinterName)?;
            let port = from_wide(info.pPortName);
            let driver = from_wide(info.pDriverName);
            let connection = connection_of(port.as_deref().unwrap_or(""), &name, driver.as_deref().unwrap_or(""));
            Some(SystemPrinter {
                is_default: default.as_deref() == Some(name.as_str()),
                problems: printer_problems(info.Status, info.Attributes),
                connection: connection.into(),
                name,
                port,
                driver,
            })
        })
        .collect())
}

pub fn printer_status(name: &str) -> Result<QueueProblems, String> {
    let printer = Printer::open(name)?;
    let mut needed = 0u32;
    unsafe { GetPrinterW(printer.0, 2, ptr::null_mut(), 0, &mut needed) };
    if needed == 0 {
        return Err(last_error("GetPrinter"));
    }
    let mut buf = aligned_buffer(needed);
    let size = (buf.len() * 8) as u32;
    if unsafe { GetPrinterW(printer.0, 2, buf.as_mut_ptr() as *mut u8, size, &mut needed) } == 0 {
        return Err(last_error("GetPrinter"));
    }
    let info = unsafe { &*(buf.as_ptr() as *const PRINTER_INFO_2W) };
    Ok(printer_problems(info.Status, info.Attributes))
}

/// Sends `bytes` as one RAW job and returns the job id. Drivers that refuse RAW (some v4 / XPS drivers) get
/// "XPS_PASS", which passes the data through to the printer just the same.
pub fn print_raw(name: &str, bytes: &[u8]) -> Result<String, String> {
    let printer = Printer::open(name)?;
    let mut doc_name = wide("Riskyc POS ticket");
    let mut job = 0u32;
    for datatype in ["RAW", "XPS_PASS"] {
        let mut dt = wide(datatype);
        let info = DOC_INFO_1W { pDocName: doc_name.as_mut_ptr(), pOutputFile: ptr::null_mut(), pDatatype: dt.as_mut_ptr() };
        job = unsafe { StartDocPrinterW(printer.0, 1, &info) };
        if job != 0 || unsafe { GetLastError() } != ERROR_INVALID_DATATYPE {
            break;
        }
    }
    if job == 0 {
        return Err(last_error("StartDocPrinter"));
    }
    let result = (|| {
        if unsafe { StartPagePrinter(printer.0) } == 0 {
            return Err(last_error("StartPagePrinter"));
        }
        let mut rest = bytes;
        while !rest.is_empty() {
            let mut written = 0u32;
            let len = rest.len().min(u32::MAX as usize) as u32;
            if unsafe { WritePrinter(printer.0, rest.as_ptr().cast(), len, &mut written) } == 0 || written == 0 {
                return Err(last_error("WritePrinter"));
            }
            rest = &rest[written as usize..];
        }
        if unsafe { EndPagePrinter(printer.0) } == 0 {
            return Err(last_error("EndPagePrinter"));
        }
        Ok(())
    })();
    // Always end the document, even after a failed write, so no half job is left open in the queue.
    let ended = unsafe { EndDocPrinter(printer.0) } != 0;
    result?;
    if !ended {
        return Err(last_error("EndDocPrinter"));
    }
    Ok(job.to_string())
}

pub fn job_status(name: &str, job: &str) -> Result<JobStatus, String> {
    let job: u32 = job.parse().map_err(|_| format!("not a Windows job id: {job}"))?;
    let printer = Printer::open(name)?;
    let queue = printer_status(name).unwrap_or_default();
    let mut needed = 0u32;
    let ok = unsafe { GetJobW(printer.0, job, 1, ptr::null_mut(), 0, &mut needed) };
    if ok == 0 && needed == 0 {
        // ERROR_INVALID_PARAMETER: no such job any more — it left the queue.
        if unsafe { GetLastError() } == ERROR_INVALID_PARAMETER {
            return Ok(JobStatus { state: JobState::Done, problems: queue });
        }
        return Err(last_error("GetJob"));
    }
    let mut buf = aligned_buffer(needed.max(1));
    let size = (buf.len() * 8) as u32;
    if unsafe { GetJobW(printer.0, job, 1, buf.as_mut_ptr() as *mut u8, size, &mut needed) } == 0 {
        if unsafe { GetLastError() } == ERROR_INVALID_PARAMETER {
            return Ok(JobStatus { state: JobState::Done, problems: queue });
        }
        return Err(last_error("GetJob"));
    }
    let info = unsafe { &*(buf.as_ptr() as *const JOB_INFO_1W) };
    let status = info.Status;
    let mut problems = job_problems(status).merge(queue);
    problems.message = unsafe { from_wide(info.pStatus) };
    let state = if status & (JOB_STATUS_PRINTED | JOB_STATUS_COMPLETE) != 0 {
        JobState::Done
    } else if status & (JOB_STATUS_DELETED | JOB_STATUS_DELETING) != 0 {
        JobState::Deleted
    } else if status & JOB_STATUS_PRINTING != 0 {
        JobState::Printing
    } else {
        JobState::Queued
    };
    Ok(JobStatus { state, problems })
}

pub fn cancel_job(name: &str, job: &str) -> Result<(), String> {
    let job: u32 = job.parse().map_err(|_| format!("not a Windows job id: {job}"))?;
    let printer = Printer::open(name)?;
    if unsafe { SetJobW(printer.0, job, 0, ptr::null(), JOB_CONTROL_DELETE) } == 0 {
        // Already gone is fine.
        if unsafe { GetLastError() } == ERROR_INVALID_PARAMETER {
            return Ok(());
        }
        return Err(last_error("SetJob"));
    }
    Ok(())
}

// ── COM ports, as the device manager describes them ────────────────────────────────────────────────────────────

pub struct ComPortDescription {
    pub port: String,
    /// "Standard Serial over Bluetooth link (COM5)", "USB-SERIAL CH340 (COM3)".
    pub friendly_name: Option<String>,
    pub bluetooth: bool,
    /// Windows makes an "incoming" COM port for every paired device, for the device to call the PC. Printers are
    /// reached through the outgoing one — the incoming one is useless here and only confuses.
    pub incoming_bluetooth: bool,
    /// The paired Bluetooth device's own name ("Printer001", "MTP-II"), when Windows remembers it.
    pub device_name: Option<String>,
}

/// "Standard Serial over Bluetooth link (COM5)" → "COM5".
fn port_from_friendly_name(name: &str) -> Option<String> {
    let start = name.rfind("(COM")? + 1;
    let end = start + name[start..].find(')')?;
    Some(name[start..end].to_string())
}

/// `BTHENUM\{00001101-…}_LOCALMFG&0002\7&1A2B&0&DC0D30123456_C00000000` → "DC0D30123456" (all zeros = incoming).
fn bluetooth_address(instance_id: &str) -> Option<String> {
    let last = instance_id.rsplit('\\').next()?;
    let before = last.split('_').next()?;
    let addr = before.rsplit('&').next()?;
    (addr.len() == 12 && addr.chars().all(|c| c.is_ascii_hexdigit())).then(|| addr.to_uppercase())
}

/// The name Windows stored when the Bluetooth device was paired.
fn bluetooth_device_name(address: &str) -> Option<String> {
    let key_path = wide(&format!("SYSTEM\\CurrentControlSet\\Services\\BTHPORT\\Parameters\\Devices\\{}", address.to_lowercase()));
    let mut key: HKEY = ptr::null_mut();
    if unsafe { RegOpenKeyExW(HKEY_LOCAL_MACHINE, key_path.as_ptr(), 0, KEY_READ, &mut key) } != 0 {
        return None;
    }
    let value = wide("Name");
    let mut buf = [0u8; 256];
    let mut len = buf.len() as u32;
    let r = unsafe { RegQueryValueExW(key, value.as_ptr(), ptr::null(), ptr::null_mut(), buf.as_mut_ptr(), &mut len) };
    unsafe { RegCloseKey(key) };
    if r != 0 {
        return None;
    }
    // REG_BINARY: the name as UTF-8, NUL-terminated.
    let bytes = &buf[..(len as usize).min(buf.len())];
    let end = bytes.iter().position(|&b| b == 0).unwrap_or(bytes.len());
    let name = String::from_utf8_lossy(&bytes[..end]).trim().to_string();
    (!name.is_empty()).then_some(name)
}

pub fn describe_com_ports() -> Vec<ComPortDescription> {
    let mut out = Vec::new();
    let set = unsafe { SetupDiGetClassDevsW(&GUID_DEVCLASS_PORTS, ptr::null(), ptr::null_mut(), DIGCF_PRESENT) };
    if set == INVALID_HANDLE_VALUE as isize || set == 0 {
        return out;
    }
    let mut index = 0u32;
    loop {
        let mut data = SP_DEVINFO_DATA { cbSize: std::mem::size_of::<SP_DEVINFO_DATA>() as u32, ..Default::default() };
        if unsafe { SetupDiEnumDeviceInfo(set, index, &mut data) } == 0 {
            break;
        }
        index += 1;

        let mut name_buf = [0u16; 260];
        let mut kind = 0u32;
        let friendly = if unsafe {
            SetupDiGetDeviceRegistryPropertyW(
                set,
                &data,
                SPDRP_FRIENDLYNAME,
                &mut kind,
                name_buf.as_mut_ptr() as *mut u8,
                (name_buf.len() * 2) as u32,
                ptr::null_mut(),
            )
        } != 0
        {
            unsafe { from_wide(name_buf.as_ptr()) }
        } else {
            None
        };
        let Some(port) = friendly.as_deref().and_then(port_from_friendly_name) else { continue };

        let mut id_buf = [0u16; 512];
        let instance_id = if unsafe { SetupDiGetDeviceInstanceIdW(set, &data, id_buf.as_mut_ptr(), id_buf.len() as u32, ptr::null_mut()) } != 0 {
            unsafe { from_wide(id_buf.as_ptr()) }.unwrap_or_default()
        } else {
            String::new()
        };
        let bluetooth = instance_id.to_uppercase().starts_with("BTHENUM\\");
        let address = if bluetooth { bluetooth_address(&instance_id) } else { None };
        let incoming_bluetooth = bluetooth && address.as_deref().map_or(true, |a| a.chars().all(|c| c == '0'));
        let device_name = address.as_deref().filter(|_| !incoming_bluetooth).and_then(bluetooth_device_name);
        out.push(ComPortDescription { port, friendly_name: friendly, bluetooth, incoming_bluetooth, device_name });
    }
    unsafe { SetupDiDestroyDeviceInfoList(set) };
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_com_port_and_bluetooth_address() {
        assert_eq!(port_from_friendly_name("Standard Serial over Bluetooth link (COM5)").as_deref(), Some("COM5"));
        assert_eq!(port_from_friendly_name("USB-SERIAL CH340 (COM12)").as_deref(), Some("COM12"));
        assert_eq!(
            bluetooth_address(r"BTHENUM\{00001101-0000-1000-8000-00805F9B34FB}_LOCALMFG&0002\7&1A2B3C&0&DC0D30123456_C00000000").as_deref(),
            Some("DC0D30123456")
        );
        assert_eq!(
            bluetooth_address(r"BTHENUM\{00001101-0000-1000-8000-00805F9B34FB}_LOCALMFG&0000\7&1A2B3C&0&000000000000_00000003").as_deref(),
            Some("000000000000")
        );
    }

    #[test]
    fn classifies_ports() {
        assert_eq!(connection_of("USB001", "POS-58", "POS-58"), "usb");
        assert_eq!(connection_of("IP_192.168.1.50", "XP-80", "Generic / Text Only"), "network");
        assert_eq!(connection_of("PORTPROMPT:", "Microsoft Print to PDF", "Microsoft Print To PDF"), "virtual");
        assert_eq!(connection_of("COM3:", "Thermal", "Generic / Text Only"), "serial");
    }
}
