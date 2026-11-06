//! Which app opened each client connection. The client's end of a connection to the engine is a
//! loopback TCP socket whose local port is the client's ephemeral port and whose foreign port is
//! the engine's, so the app behind it is the process holding that socket. On macOS one worker
//! thread finds it through `libproc`, once per connection, checking the processes that opened
//! recent connections before scanning them all. Other platforms report nothing.

use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::time::Duration;
use ts_rs::TS;

/// The app behind a client connection.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct ClientApp {
    pub pid: i32,
    /// The app's name ("Google Chrome"), or the executable's for a process outside an app ("curl").
    pub name: String,
    /// The outermost `.app` bundle's CFBundleIdentifier, if any.
    pub bundle_id: Option<String>,
    /// The outermost `.app` bundle's path, or the executable's path when there is no bundle.
    pub path: String,
}

/// Finds the app behind each client connection, once per connection, off the caller's thread.
/// Cheap to clone.
#[derive(Clone)]
pub struct Attribution {
    lookups: Option<imp::Lookups>,
}

impl Attribution {
    /// For an engine listening on `proxy_port`. On platforms without a lookup this does nothing
    /// and spawns nothing.
    pub fn new(proxy_port: u16) -> Self {
        Self { lookups: imp::Lookups::start(proxy_port) }
    }

    /// Starts finding the app behind `connection`, whose client end is `client_addr`. Called on
    /// each request; only the first call per connection does anything. Returns immediately.
    pub fn begin(&self, connection: u64, client_addr: SocketAddr) {
        if let Some(lookups) = &self.lookups {
            lookups.begin(connection, client_addr);
        }
    }

    /// The app behind `connection`, waiting up to `wait` for a lookup still in progress. None
    /// when unknown, not found, or not supported.
    pub fn get(&self, connection: u64, wait: Duration) -> Option<ClientApp> {
        self.lookups.as_ref().and_then(|l| l.get(connection, wait))
    }
}

/// The icon of the app or executable at `path` (a ClientApp's `path`) as a PNG, 64 by 64
/// pixels, cached in memory by path. `Ok(None)` on platforms without icons. Blocks.
#[cfg(target_os = "macos")]
pub fn app_icon_png(path: &str) -> Result<Option<Vec<u8>>, String> {
    icon::png(path).map(Some)
}

#[cfg(not(target_os = "macos"))]
pub fn app_icon_png(_path: &str) -> Result<Option<Vec<u8>>, String> {
    Ok(None)
}

/// A map that keeps only its `cap` most recently inserted keys.
#[cfg(target_os = "macos")]
struct Bounded<K, V> {
    map: std::collections::HashMap<K, V>,
    order: std::collections::VecDeque<K>,
    cap: usize,
}

#[cfg(target_os = "macos")]
impl<K: std::hash::Hash + Eq + Clone, V> Bounded<K, V> {
    fn new(cap: usize) -> Self {
        Self { map: Default::default(), order: Default::default(), cap }
    }

    fn get<Q>(&self, key: &Q) -> Option<&V>
    where
        K: std::borrow::Borrow<Q>,
        Q: std::hash::Hash + Eq + ?Sized,
    {
        self.map.get(key)
    }

    fn get_mut(&mut self, key: &K) -> Option<&mut V> {
        self.map.get_mut(key)
    }

    fn insert(&mut self, key: K, value: V) {
        if self.map.insert(key.clone(), value).is_none() {
            self.order.push_back(key);
        }
        while self.order.len() > self.cap {
            if let Some(oldest) = self.order.pop_front() {
                self.map.remove(&oldest);
            }
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    use super::ClientApp;
    use std::net::SocketAddr;
    use std::time::Duration;

    /// No lookup on this platform.
    #[derive(Clone)]
    pub enum Lookups {}

    impl Lookups {
        pub fn start(_proxy_port: u16) -> Option<Self> {
            None
        }

        pub fn begin(&self, _connection: u64, _client_addr: SocketAddr) {
            match *self {}
        }

        pub fn get(&self, _connection: u64, _wait: Duration) -> Option<ClientApp> {
            match *self {}
        }
    }
}

#[cfg(target_os = "macos")]
mod imp {
    use super::{Bounded, ClientApp, proc};
    use log::warn;
    use std::collections::{HashMap, HashSet};
    use std::net::SocketAddr;
    use std::path::Path;
    use std::sync::mpsc::{Receiver, Sender, channel};
    use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError, Weak};
    use std::time::{Duration, Instant};

    /// Connections whose lookups are remembered, the most recently begun.
    const CONNECTIONS: usize = 4096;
    /// Pids that recently owned client sockets, checked before a full scan.
    const RECENT_PIDS: usize = 256;
    /// Apps remembered by pid and start time.
    const APPS: usize = 512;

    /// The lookup state shared by every clone of an `Attribution`, and its worker's sender.
    /// The worker stops once the last sender is dropped.
    #[derive(Clone)]
    pub struct Lookups {
        shared: Arc<Shared>,
        jobs: Sender<Job>,
    }

    struct Shared {
        connections: Mutex<Bounded<u64, Slot>>,
        done: Condvar,
    }

    enum Slot {
        Pending,
        Done(Option<ClientApp>),
    }

    struct Job {
        connection: u64,
        client_port: u16,
    }

    impl Shared {
        fn lock(&self) -> MutexGuard<'_, Bounded<u64, Slot>> {
            self.connections.lock().unwrap_or_else(PoisonError::into_inner)
        }
    }

    impl Lookups {
        /// Spawns the worker, or returns None (and logs) when the thread cannot start.
        pub fn start(proxy_port: u16) -> Option<Self> {
            let shared = Arc::new(Shared {
                connections: Mutex::new(Bounded::new(CONNECTIONS)),
                done: Condvar::new(),
            });
            let (jobs, rx) = channel();
            let weak = Arc::downgrade(&shared);
            let spawned = std::thread::Builder::new()
                .name("yaak-proxy-attribution".into())
                .spawn(move || work(weak, rx, proxy_port));
            match spawned {
                Ok(_) => Some(Self { shared, jobs }),
                Err(e) => {
                    warn!("Failed to start the client app lookup thread: {e}");
                    None
                }
            }
        }

        pub fn begin(&self, connection: u64, client_addr: SocketAddr) {
            let mut connections = self.shared.lock();
            if connections.get(&connection).is_some() {
                return;
            }
            // A client on another host has no process here.
            if !is_loopback(client_addr) {
                connections.insert(connection, Slot::Done(None));
                return;
            }
            connections.insert(connection, Slot::Pending);
            let job = Job { connection, client_port: client_addr.port() };
            // The worker is gone only if it panicked; nobody should wait on it then.
            if self.jobs.send(job).is_err() {
                connections.insert(connection, Slot::Done(None));
            }
        }

        pub fn get(&self, connection: u64, wait: Duration) -> Option<ClientApp> {
            let deadline = Instant::now() + wait;
            let mut connections = self.shared.lock();
            loop {
                match connections.get(&connection)? {
                    Slot::Done(app) => return app.clone(),
                    Slot::Pending => {}
                }
                let left = deadline.saturating_duration_since(Instant::now());
                if left.is_zero() {
                    return None;
                }
                connections = match self.shared.done.wait_timeout(connections, left) {
                    Ok((guard, _)) => guard,
                    Err(e) => e.into_inner().0,
                };
            }
        }
    }

    fn is_loopback(addr: SocketAddr) -> bool {
        match addr {
            SocketAddr::V4(a) => a.ip().is_loopback(),
            SocketAddr::V6(a) => {
                a.ip().is_loopback() || a.ip().to_ipv4_mapped().is_some_and(|v4| v4.is_loopback())
            }
        }
    }

    /// Resolves every job queued by the time it wakes in one pass, so a burst of short-lived
    /// clients costs one scan rather than one each, and their sockets are still open for it.
    fn work(shared: Weak<Shared>, jobs: Receiver<Job>, proxy_port: u16) {
        let mut finder = Finder::new(proxy_port);
        while let Ok(first) = jobs.recv() {
            let mut batch = vec![first];
            while let Ok(job) = jobs.try_recv() {
                batch.push(job);
            }
            let Some(shared) = shared.upgrade() else {
                return;
            };
            // Some may be forgotten already, under a burst of newer connections.
            batch.retain(|job| shared.lock().get(&job.connection).is_some());
            if batch.is_empty() {
                continue;
            }
            let ports: Vec<u16> = batch.iter().map(|job| job.client_port).collect();
            let apps = finder.find_all(&ports);
            let mut connections = shared.lock();
            for job in batch {
                if let Some(slot) = connections.get_mut(&job.connection) {
                    *slot = Slot::Done(apps.get(&job.client_port).cloned().flatten());
                }
            }
            drop(connections);
            shared.done.notify_all();
        }
    }

    /// Finds the processes holding client sockets and the apps they belong to, with the caches
    /// and buffers kept between lookups.
    pub(super) struct Finder {
        proxy_port: u16,
        own_pid: i32,
        /// Most recent first.
        recent: Vec<i32>,
        apps: Bounded<(i32, u64, u64), Option<ClientApp>>,
        pids: Vec<i32>,
        fds: Vec<libc::proc_fdinfo>,
        held: Vec<u16>,
    }

    impl Finder {
        pub fn new(proxy_port: u16) -> Self {
            Self {
                proxy_port,
                own_pid: std::process::id() as i32,
                recent: Vec::new(),
                apps: Bounded::new(APPS),
                pids: Vec::new(),
                fds: Vec::new(),
                held: Vec::new(),
            }
        }

        /// The app behind each of the connections from `client_ports`, None for those not found.
        pub fn find_all(&mut self, client_ports: &[u16]) -> HashMap<u16, Option<ClientApp>> {
            self.find_pids(client_ports)
                .into_iter()
                .map(|(port, pid)| (port, self.app(pid)))
                .collect()
        }

        /// The pids holding the client ends of connections from `client_ports`: first among the
        /// pids that held recent ones, then in one scan of every other pid, stopping once all
        /// are found.
        pub fn find_pids(&mut self, client_ports: &[u16]) -> HashMap<u16, i32> {
            let mut pending: HashSet<u16> = client_ports.iter().copied().collect();
            let mut found = HashMap::with_capacity(pending.len());
            let mut hits = Vec::new();

            let mut i = 0;
            while i < self.recent.len() && !pending.is_empty() {
                let pid = self.recent[i];
                let before = pending.len();
                if !self.check(pid, &mut pending, &mut found) {
                    self.recent.remove(i);
                    continue;
                }
                if pending.len() < before {
                    hits.push(pid);
                }
                i += 1;
            }

            if !pending.is_empty() {
                let recent: HashSet<i32> = self.recent.iter().copied().collect();
                let mut pids = std::mem::take(&mut self.pids);
                proc::all_pids(&mut pids);
                for &pid in &pids {
                    if pending.is_empty() {
                        break;
                    }
                    if pid <= 0 || pid == self.own_pid || recent.contains(&pid) {
                        continue;
                    }
                    let before = pending.len();
                    self.check(pid, &mut pending, &mut found);
                    if pending.len() < before {
                        hits.push(pid);
                    }
                }
                self.pids = pids;
            }

            self.recent.retain(|pid| !hits.contains(pid));
            self.recent.splice(0..0, hits);
            self.recent.truncate(RECENT_PIDS);
            found
        }

        /// Moves the ports in `pending` that `pid` holds into `found`. False when `pid` cannot
        /// be read.
        fn check(
            &mut self,
            pid: i32,
            pending: &mut HashSet<u16>,
            found: &mut HashMap<u16, i32>,
        ) -> bool {
            let readable =
                proc::held_ports(pid, self.proxy_port, pending, &mut self.fds, &mut self.held);
            for port in self.held.drain(..) {
                if pending.remove(&port) {
                    found.insert(port, pid);
                }
            }
            readable
        }

        fn app(&mut self, pid: i32) -> Option<ClientApp> {
            let key = proc::start_time(pid).map(|(sec, usec)| (pid, sec, usec));
            if let Some(key) = key
                && let Some(app) = self.apps.get(&key)
            {
                return app.clone();
            }
            let app = proc::executable(pid).map(|exe| describe(pid, &exe));
            if let Some(key) = key {
                self.apps.insert(key, app.clone());
            }
            app
        }
    }

    /// The app that `exe`, the executable of `pid`, belongs to.
    pub(super) fn describe(pid: i32, exe: &Path) -> ClientApp {
        match outermost_bundle(exe) {
            Some(bundle) => {
                let (name, bundle_id) = bundle_info(bundle);
                ClientApp { pid, name, bundle_id, path: bundle.to_string_lossy().into_owned() }
            }
            None => ClientApp {
                pid,
                name: exe
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_else(|| exe.to_string_lossy().into_owned()),
                bundle_id: None,
                path: exe.to_string_lossy().into_owned(),
            },
        }
    }

    /// The outermost ancestor directory of `exe` whose name ends in `.app`, so a helper app
    /// nested inside another app resolves to the app the user launched.
    pub(super) fn outermost_bundle(exe: &Path) -> Option<&Path> {
        exe.ancestors()
            .skip(1)
            .filter(|dir| dir.file_name().is_some_and(|n| n.to_string_lossy().ends_with(".app")))
            .last()
    }

    /// The name and bundle identifier of the app bundle at `bundle`, from its `Info.plist`:
    /// `CFBundleDisplayName`, then `CFBundleName`, then the bundle's file stem.
    pub(super) fn bundle_info(bundle: &Path) -> (String, Option<String>) {
        let info = plist::Value::from_file(bundle.join("Contents").join("Info.plist"))
            .ok()
            .and_then(plist::Value::into_dictionary);
        let string = |key: &str| {
            info.as_ref()
                .and_then(|d| d.get(key))
                .and_then(plist::Value::as_string)
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
        };
        let name =
            string("CFBundleDisplayName").or_else(|| string("CFBundleName")).unwrap_or_else(|| {
                bundle.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default()
            });
        (name, string("CFBundleIdentifier"))
    }
}

/// The `libproc` calls and the `<sys/proc_info.h>` structs `libc` does not have, named as the
/// header names them, with every field so the layouts match.
#[cfg(target_os = "macos")]
#[allow(non_camel_case_types, dead_code)]
mod proc {
    use libc::{c_char, c_int, c_void};
    use std::collections::HashSet;
    use std::ffi::OsStr;
    use std::mem::size_of;
    use std::net::{Ipv4Addr, Ipv6Addr};
    use std::os::unix::ffi::OsStrExt;
    use std::path::PathBuf;

    pub const PROC_PIDFDSOCKETINFO: c_int = 3;
    pub const SOCKINFO_TCP: c_int = 2;
    pub const INI_IPV4: u8 = 0x1;

    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct proc_fileinfo {
        pub fi_openflags: u32,
        pub fi_status: u32,
        pub fi_offset: i64,
        pub fi_type: i32,
        pub fi_guardflags: u32,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct sockbuf_info {
        pub sbi_cc: u32,
        pub sbi_hiwat: u32,
        pub sbi_mbcnt: u32,
        pub sbi_mbmax: u32,
        pub sbi_lowat: u32,
        pub sbi_flags: i16,
        pub sbi_timeo: i16,
    }

    /// The `in4in6_addr` / `in6_addr` union: an IPv4 address is the last four bytes.
    #[repr(C, align(4))]
    #[derive(Clone, Copy)]
    pub struct in_addr_46 {
        pub bytes: [u8; 16],
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct insi_v6 {
        pub in6_hlim: u8,
        pub in6_cksum: c_int,
        pub in6_ifindex: u16,
        pub in6_hops: i16,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct in_sockinfo {
        /// The foreign port, network byte order in the low 16 bits.
        pub insi_fport: c_int,
        /// The local port, network byte order in the low 16 bits.
        pub insi_lport: c_int,
        pub insi_gencnt: u64,
        pub insi_flags: u32,
        pub insi_flow: u32,
        pub insi_vflag: u8,
        pub insi_ip_ttl: u8,
        pub rfu_1: u32,
        pub insi_faddr: in_addr_46,
        pub insi_laddr: in_addr_46,
        pub insi_v4: u8,
        pub insi_v6: insi_v6,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct tcp_sockinfo {
        pub tcpsi_ini: in_sockinfo,
        pub tcpsi_state: c_int,
        pub tcpsi_timer: [c_int; 4],
        pub tcpsi_mss: c_int,
        pub tcpsi_flags: u32,
        pub rfu_1: u32,
        pub tcpsi_tp: u64,
    }

    /// Only here so `soi_proto` has the size of its largest member.
    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct un_sockinfo {
        pub unsi_conn_so: u64,
        pub unsi_conn_pcb: u64,
        pub unsi_addr: [c_char; 255],
        pub unsi_caddr: [c_char; 255],
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    pub union soi_proto {
        pub pri_in: in_sockinfo,
        pub pri_tcp: tcp_sockinfo,
        pub pri_un: un_sockinfo,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct socket_info {
        pub soi_stat: libc::vinfo_stat,
        pub soi_so: u64,
        pub soi_pcb: u64,
        pub soi_type: c_int,
        pub soi_protocol: c_int,
        pub soi_family: c_int,
        pub soi_options: i16,
        pub soi_linger: i16,
        pub soi_state: i16,
        pub soi_qlen: i16,
        pub soi_incqlen: i16,
        pub soi_qlimit: i16,
        pub soi_timeo: i16,
        pub soi_error: u16,
        pub soi_oobmark: u32,
        pub soi_rcv: sockbuf_info,
        pub soi_snd: sockbuf_info,
        pub soi_kind: c_int,
        pub rfu_1: u32,
        pub soi_proto: soi_proto,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct socket_fdinfo {
        pub pfi: proc_fileinfo,
        pub psi: socket_info,
    }

    /// Fills `pids` with every pid on the system.
    pub fn all_pids(pids: &mut Vec<i32>) {
        pids.clear();
        // With no buffer this returns about how many pids there are.
        let count = unsafe { libc::proc_listallpids(std::ptr::null_mut(), 0) };
        if count <= 0 {
            return;
        }
        pids.resize(count as usize + 64, 0);
        let bytes = (pids.len() * size_of::<i32>()) as c_int;
        let count = unsafe { libc::proc_listallpids(pids.as_mut_ptr().cast::<c_void>(), bytes) };
        pids.truncate(count.max(0) as usize);
    }

    /// Fills `fds` with the open fds of `pid`. False when the process is gone or not ours to read.
    fn list_fds(pid: i32, fds: &mut Vec<libc::proc_fdinfo>) -> bool {
        fds.clear();
        let entry = size_of::<libc::proc_fdinfo>();
        // With no buffer this returns the bytes needed for the fd table.
        let bytes =
            unsafe { libc::proc_pidinfo(pid, libc::PROC_PIDLISTFDS, 0, std::ptr::null_mut(), 0) };
        if bytes <= 0 {
            return false;
        }
        fds.resize(bytes as usize / entry + 16, libc::proc_fdinfo { proc_fd: 0, proc_fdtype: 0 });
        let bytes = unsafe {
            libc::proc_pidinfo(
                pid,
                libc::PROC_PIDLISTFDS,
                0,
                fds.as_mut_ptr().cast::<c_void>(),
                (fds.len() * entry) as c_int,
            )
        };
        if bytes <= 0 {
            fds.clear();
            return false;
        }
        fds.truncate(bytes as usize / entry);
        true
    }

    /// Fills `held` with the ports of `wanted` that `pid` holds the client end of: a loopback
    /// TCP socket from that port to `proxy_port`. False when its fds cannot be read.
    pub fn held_ports(
        pid: i32,
        proxy_port: u16,
        wanted: &HashSet<u16>,
        fds: &mut Vec<libc::proc_fdinfo>,
        held: &mut Vec<u16>,
    ) -> bool {
        held.clear();
        if !list_fds(pid, fds) {
            return false;
        }
        let size = size_of::<socket_fdinfo>();
        for fd in fds.iter().filter(|fd| fd.proc_fdtype == libc::PROX_FDTYPE_SOCKET as u32) {
            let mut info = std::mem::MaybeUninit::<socket_fdinfo>::zeroed();
            let written = unsafe {
                libc::proc_pidfdinfo(
                    pid,
                    fd.proc_fd,
                    PROC_PIDFDSOCKETINFO,
                    info.as_mut_ptr().cast::<c_void>(),
                    size as c_int,
                )
            };
            if written as usize != size {
                continue;
            }
            // Zeroed and then filled by the kernel, so every field holds a valid value.
            let info = unsafe { info.assume_init() };
            if info.psi.soi_kind != SOCKINFO_TCP {
                continue;
            }
            // soi_kind says the union holds a tcp_sockinfo.
            let ini = unsafe { info.psi.soi_proto.pri_tcp.tcpsi_ini };
            let local = port(ini.insi_lport);
            if port(ini.insi_fport) == proxy_port
                && wanted.contains(&local)
                && is_loopback(ini.insi_vflag, &ini.insi_laddr)
                && is_loopback(ini.insi_vflag, &ini.insi_faddr)
            {
                held.push(local);
                if held.len() == wanted.len() {
                    break;
                }
            }
        }
        true
    }

    pub fn port(raw: c_int) -> u16 {
        u16::from_be(raw as u16)
    }

    pub fn is_loopback(vflag: u8, addr: &in_addr_46) -> bool {
        let b = addr.bytes;
        if vflag & INI_IPV4 != 0 {
            return Ipv4Addr::new(b[12], b[13], b[14], b[15]).is_loopback();
        }
        let v6 = Ipv6Addr::from(b);
        v6.is_loopback() || v6.to_ipv4_mapped().is_some_and(|v4| v4.is_loopback())
    }

    /// When `pid` started, in seconds and microseconds, which tells a reused pid apart.
    pub fn start_time(pid: i32) -> Option<(u64, u64)> {
        let mut info = std::mem::MaybeUninit::<libc::proc_bsdinfo>::zeroed();
        let size = size_of::<libc::proc_bsdinfo>();
        let written = unsafe {
            libc::proc_pidinfo(
                pid,
                libc::PROC_PIDTBSDINFO,
                0,
                info.as_mut_ptr().cast::<c_void>(),
                size as c_int,
            )
        };
        if written as usize != size {
            return None;
        }
        let info = unsafe { info.assume_init() };
        Some((info.pbi_start_tvsec, info.pbi_start_tvusec))
    }

    /// The path of the executable `pid` runs.
    pub fn executable(pid: i32) -> Option<PathBuf> {
        let mut buf = vec![0u8; libc::PROC_PIDPATHINFO_MAXSIZE as usize];
        let len =
            unsafe { libc::proc_pidpath(pid, buf.as_mut_ptr().cast::<c_void>(), buf.len() as u32) };
        if len <= 0 {
            return None;
        }
        buf.truncate(len as usize);
        Some(PathBuf::from(OsStr::from_bytes(&buf)))
    }
}

/// App icons drawn with AppKit.
#[cfg(target_os = "macos")]
mod icon {
    use super::Bounded;
    use objc2::AllocAnyThread;
    use objc2::rc::autoreleasepool;
    use objc2_app_kit::{
        NSBitmapImageFileType, NSBitmapImageRep, NSCompositingOperation, NSDeviceRGBColorSpace,
        NSGraphicsContext, NSWorkspace,
    };
    use objc2_foundation::{NSDictionary, NSPoint, NSRect, NSSize, NSString};
    use std::path::Path;
    use std::sync::{LazyLock, Mutex, PoisonError};

    const SIZE: isize = 64;
    const CACHED: usize = 256;

    static ICONS: LazyLock<Mutex<Bounded<String, Vec<u8>>>> =
        LazyLock::new(|| Mutex::new(Bounded::new(CACHED)));

    pub fn png(path: &str) -> Result<Vec<u8>, String> {
        if let Some(png) = ICONS.lock().unwrap_or_else(PoisonError::into_inner).get(path) {
            return Ok(png.clone());
        }
        if !Path::new(path).exists() {
            return Err(format!("No app at {path}"));
        }
        let png = autoreleasepool(|_| draw(path))?;
        ICONS.lock().unwrap_or_else(PoisonError::into_inner).insert(path.to_string(), png.clone());
        Ok(png)
    }

    fn draw(path: &str) -> Result<Vec<u8>, String> {
        let image = NSWorkspace::sharedWorkspace().iconForFile(&NSString::from_str(path));
        // A null planes pointer has the rep allocate its own pixels.
        let rep = unsafe {
            NSBitmapImageRep::initWithBitmapDataPlanes_pixelsWide_pixelsHigh_bitsPerSample_samplesPerPixel_hasAlpha_isPlanar_colorSpaceName_bytesPerRow_bitsPerPixel(
                NSBitmapImageRep::alloc(),
                std::ptr::null_mut(),
                SIZE,
                SIZE,
                8,
                4,
                true,
                false,
                NSDeviceRGBColorSpace,
                0,
                0,
            )
        }
        .ok_or("Failed to create a bitmap for the icon")?;
        let size = NSSize::new(SIZE as f64, SIZE as f64);
        rep.setSize(size);
        let context = NSGraphicsContext::graphicsContextWithBitmapImageRep(&rep)
            .ok_or("Failed to create a graphics context for the icon")?;
        NSGraphicsContext::saveGraphicsState_class();
        NSGraphicsContext::setCurrentContext(Some(&context));
        image.drawInRect_fromRect_operation_fraction(
            NSRect::new(NSPoint::ZERO, size),
            NSRect::ZERO,
            NSCompositingOperation::Copy,
            1.0,
        );
        context.flushGraphics();
        NSGraphicsContext::restoreGraphicsState_class();
        // An empty properties dictionary is the right type for any key.
        let data = unsafe {
            rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new())
        }
        .ok_or("Failed to encode the icon as PNG")?;
        Ok(data.to_vec())
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::imp::{Finder, bundle_info, describe, outermost_bundle};
    use super::proc::*;
    use super::*;
    use std::mem::{offset_of, size_of};
    use std::net::{Ipv4Addr, Ipv6Addr, TcpListener};
    use std::path::Path;
    use std::process::{Child, Command, Stdio};
    use std::time::Instant;

    #[test]
    fn struct_layouts_match_the_sdk() {
        // sizeof and offsetof from <sys/proc_info.h> in the macOS SDK.
        assert_eq!(size_of::<proc_fileinfo>(), 24);
        assert_eq!(size_of::<libc::vinfo_stat>(), 136);
        assert_eq!(size_of::<sockbuf_info>(), 24);
        assert_eq!(size_of::<in_sockinfo>(), 80);
        assert_eq!(size_of::<tcp_sockinfo>(), 120);
        assert_eq!(size_of::<un_sockinfo>(), 528);
        assert_eq!(size_of::<socket_info>(), 768);
        assert_eq!(size_of::<socket_fdinfo>(), 792);
        assert_eq!(offset_of!(in_sockinfo, insi_lport), 4);
        assert_eq!(offset_of!(in_sockinfo, insi_vflag), 24);
        assert_eq!(offset_of!(in_sockinfo, insi_faddr), 32);
        assert_eq!(offset_of!(in_sockinfo, insi_laddr), 48);
        assert_eq!(offset_of!(in_sockinfo, insi_v6), 68);
        assert_eq!(offset_of!(socket_info, soi_kind), 232);
        assert_eq!(offset_of!(socket_info, soi_proto), 240);
        assert_eq!(offset_of!(socket_fdinfo, psi), 24);
    }

    #[test]
    fn reads_ports_and_loopback() {
        assert_eq!(port(i32::from(9090u16.to_be())), 9090);
        let mut v4 = in_addr_46 { bytes: [0; 16] };
        v4.bytes[12..].copy_from_slice(&[127, 0, 0, 1]);
        assert!(is_loopback(INI_IPV4, &v4));
        let v6 = in_addr_46 { bytes: Ipv6Addr::LOCALHOST.octets() };
        assert!(is_loopback(2, &v6));
        let mapped = in_addr_46 { bytes: Ipv4Addr::new(127, 0, 0, 1).to_ipv6_mapped().octets() };
        assert!(is_loopback(2, &mapped));
        let remote = in_addr_46 { bytes: Ipv4Addr::new(10, 0, 0, 1).to_ipv6_mapped().octets() };
        assert!(!is_loopback(2, &remote));
    }

    fn fake_app(dir: &Path, rel: &str, plist: Option<&str>) {
        let bundle = dir.join(rel);
        std::fs::create_dir_all(bundle.join("Contents/MacOS")).unwrap();
        if let Some(plist) = plist {
            std::fs::write(bundle.join("Contents/Info.plist"), plist).unwrap();
        }
    }

    fn plist_xml(entries: &[(&str, &str)]) -> String {
        let body: String =
            entries.iter().map(|(k, v)| format!("<key>{k}</key><string>{v}</string>")).collect();
        format!(
            r#"<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>{body}</dict></plist>"#
        )
    }

    #[test]
    fn resolves_the_outermost_bundle() {
        let dir = tempfile::tempdir().unwrap();
        let outer = "Fake Browser.app";
        let helper = "Fake Browser.app/Contents/Frameworks/Fake.framework/Helpers/Fake Helper (Renderer).app";
        fake_app(
            dir.path(),
            outer,
            Some(&plist_xml(&[
                ("CFBundleIdentifier", "com.example.browser"),
                ("CFBundleName", "Browser"),
                ("CFBundleDisplayName", "Fake Browser"),
            ])),
        );
        fake_app(
            dir.path(),
            helper,
            Some(&plist_xml(&[("CFBundleIdentifier", "com.example.browser.helper")])),
        );
        let exe = dir.path().join(helper).join("Contents/MacOS/Fake Helper (Renderer)");
        let bundle = dir.path().join(outer);
        assert_eq!(outermost_bundle(&exe), Some(bundle.as_path()));
        assert_eq!(
            describe(42, &exe),
            ClientApp {
                pid: 42,
                name: "Fake Browser".into(),
                bundle_id: Some("com.example.browser".into()),
                path: bundle.to_string_lossy().into_owned(),
            }
        );
    }

    #[test]
    fn falls_back_to_the_executable() {
        let exe = Path::new("/usr/bin/curl");
        assert_eq!(outermost_bundle(exe), None);
        assert_eq!(
            describe(7, exe),
            ClientApp {
                pid: 7,
                name: "curl".into(),
                bundle_id: None,
                path: "/usr/bin/curl".into()
            }
        );
    }

    #[test]
    fn reads_bundle_names() {
        let dir = tempfile::tempdir().unwrap();
        fake_app(dir.path(), "Named.app", Some(&plist_xml(&[("CFBundleName", "Only Name")])));
        assert_eq!(bundle_info(&dir.path().join("Named.app")), ("Only Name".into(), None));

        fake_app(dir.path(), "Bare.app", None);
        assert_eq!(bundle_info(&dir.path().join("Bare.app")), ("Bare".into(), None));

        // A binary plist, as most shipped apps have.
        let mut dict = plist::Dictionary::new();
        dict.insert("CFBundleIdentifier".into(), "com.example.binary".into());
        dict.insert("CFBundleDisplayName".into(), "Binary App".into());
        fake_app(dir.path(), "Binary.app", None);
        plist::Value::Dictionary(dict)
            .to_file_binary(dir.path().join("Binary.app/Contents/Info.plist"))
            .unwrap();
        assert_eq!(
            bundle_info(&dir.path().join("Binary.app")),
            ("Binary App".into(), Some("com.example.binary".into()))
        );
    }

    /// `n` curls connected to one listener, with their accepted ends and client addresses.
    struct Curls {
        port: u16,
        children: Vec<Child>,
        streams: Vec<std::net::TcpStream>,
        peers: Vec<SocketAddr>,
    }

    impl Curls {
        fn start(n: usize) -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let port = listener.local_addr().unwrap().port();
            let children = (0..n)
                .map(|_| {
                    Command::new("/usr/bin/curl")
                        .args([
                            "-s",
                            "--max-time",
                            "5",
                            &format!("http://127.0.0.1:{port}/"),
                        ])
                        .stdout(Stdio::null())
                        .stderr(Stdio::null())
                        .spawn()
                        .unwrap()
                })
                .collect();
            let (streams, peers) = (0..n).map(|_| listener.accept().unwrap()).unzip();
            Self { port, children, streams, peers }
        }

        fn pids(&self) -> Vec<i32> {
            let mut pids: Vec<i32> = self.children.iter().map(|c| c.id() as i32).collect();
            pids.sort();
            pids
        }

        fn client_ports(&self) -> Vec<u16> {
            self.peers.iter().map(|p| p.port()).collect()
        }
    }

    impl Drop for Curls {
        fn drop(&mut self) {
            self.streams.clear();
            for child in &mut self.children {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }

    #[test]
    fn finds_curl() {
        let curls = Curls::start(1);
        let attribution = Attribution::new(curls.port);
        attribution.begin(1, curls.peers[0]);
        attribution.begin(1, curls.peers[0]);
        let app = attribution.get(1, Duration::from_secs(2)).expect("found the app");
        assert_eq!(app.name, "curl");
        assert_eq!(app.bundle_id, None);
        assert_eq!(vec![app.pid], curls.pids());
        assert_eq!(attribution.get(2, Duration::from_millis(10)), None);
    }

    #[test]
    fn finds_many_clients_in_one_pass() {
        let curls = Curls::start(6);
        let mut finder = Finder::new(curls.port);
        // Port 1 is never a client, so the pass also scans every pid.
        let mut ports = curls.client_ports();
        ports.push(1);
        let apps = finder.find_all(&ports);
        assert_eq!(apps.len(), 6);
        let mut pids: Vec<i32> = apps.values().flatten().map(|a| a.pid).collect();
        pids.sort();
        assert_eq!(pids, curls.pids());
        assert!(apps.values().flatten().all(|a| a.name == "curl"));
        // Each port maps to the curl that holds it, the same through the recent pids.
        assert_eq!(finder.find_pids(&curls.client_ports()), finder.find_pids(&ports));

        let attribution = Attribution::new(curls.port);
        for (i, peer) in curls.peers.iter().enumerate() {
            attribution.begin(i as u64, *peer);
        }
        for (i, port) in curls.client_ports().iter().enumerate() {
            let app = attribution.get(i as u64, Duration::from_secs(2));
            assert_eq!(app, apps[port]);
        }
    }

    #[test]
    fn draws_app_icons() {
        let png = app_icon_png("/System/Applications/Calculator.app").unwrap().unwrap();
        assert!(png.starts_with(b"\x89PNG\r\n\x1a\n"));
        assert_eq!(&png[16..24], &[0, 0, 0, 64, 0, 0, 0, 64]);
        let cached = app_icon_png("/System/Applications/Calculator.app").unwrap().unwrap();
        assert_eq!(png, cached);
        assert!(app_icon_png("/usr/bin/curl").unwrap().unwrap().starts_with(b"\x89PNG"));
    }

    /// Run with `--ignored --nocapture` to see the timings.
    #[test]
    #[ignore]
    fn times_lookups() {
        let mut pids = Vec::new();
        all_pids(&mut pids);
        eprintln!("{} pids", pids.len());
        for n in [1, 8, 32] {
            let curls = Curls::start(n);
            let ports = curls.client_ports();
            let mut finder = Finder::new(curls.port);
            let start = Instant::now();
            let found = finder.find_pids(&ports);
            let full = start.elapsed();
            let start = Instant::now();
            let cached = finder.find_pids(&ports);
            let hit = start.elapsed();
            let mut with_miss = ports.clone();
            with_miss.push(1);
            let start = Instant::now();
            finder.find_pids(&with_miss);
            let miss = start.elapsed();
            assert_eq!(found.len(), n);
            assert_eq!(cached, found);
            eprintln!(
                "{n} ports: full scan {full:?}, cached pids {hit:?}, cached plus one never found (whole scan) {miss:?}"
            );
        }
    }
}
