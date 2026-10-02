use std::fs::File;
use std::io;
use std::path::Path;

#[cfg(unix)]
pub(crate) fn preserve_file_security(
    source: &File,
    destination: &File,
    _destination_path: &Path,
) -> io::Result<()> {
    use std::os::fd::AsRawFd;
    use std::os::unix::fs::MetadataExt;

    let original = source.metadata()?;
    let temporary = destination.metadata()?;
    if (original.uid(), original.gid()) != (temporary.uid(), temporary.gid()) {
        // SAFETY: the file descriptor is live and the IDs came from fstat.
        if unsafe { libc::fchown(destination.as_raw_fd(), original.uid(), original.gid()) } != 0 {
            return Err(io::Error::last_os_error());
        }
    }
    destination.set_permissions(original.permissions())?;
    copy_acl(source, destination)
}

#[cfg(target_os = "macos")]
fn copy_acl(source: &File, destination: &File) -> io::Result<()> {
    use std::ffi::c_void;
    use std::os::fd::AsRawFd;

    // Darwin's ACL API is not exposed by libc. Copy the exact ACL: copyfile's
    // COPYFILE_ACL merges inherited destination entries and can ignore failures.
    unsafe extern "C" {
        fn acl_get_fd(fd: libc::c_int) -> *mut c_void;
        fn acl_init(count: libc::c_int) -> *mut c_void;
        fn acl_set_fd(fd: libc::c_int, acl: *mut c_void) -> libc::c_int;
        fn acl_free(acl: *mut c_void) -> libc::c_int;
    }
    struct Acl(*mut c_void);
    impl Drop for Acl {
        fn drop(&mut self) {
            // SAFETY: this ACL was allocated by acl_get_fd or acl_init.
            unsafe { acl_free(self.0) };
        }
    }

    // SAFETY: the source file descriptor remains open throughout this call.
    let mut acl = unsafe { acl_get_fd(source.as_raw_fd()) };
    if acl.is_null() {
        let error = io::Error::last_os_error();
        if error.raw_os_error() != Some(libc::ENOENT) {
            return Err(error);
        }
        // No source ACL must also clear any inherited temporary-file ACL.
        // SAFETY: zero is a valid initial entry count.
        acl = unsafe { acl_init(0) };
        if acl.is_null() {
            return Err(io::Error::last_os_error());
        }
    }
    let acl = Acl(acl);
    // SAFETY: both the destination descriptor and ACL are valid and live.
    if unsafe { acl_set_fd(destination.as_raw_fd(), acl.0) } != 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn copy_acl(source: &File, destination: &File) -> io::Result<()> {
    use std::os::fd::AsRawFd;

    let name = c"system.posix_acl_access";
    // SAFETY: the descriptor and NUL-terminated name are valid; a null buffer
    // with zero length requests the attribute's size.
    let size =
        unsafe { libc::fgetxattr(source.as_raw_fd(), name.as_ptr(), std::ptr::null_mut(), 0) };
    if size < 0 {
        let error = io::Error::last_os_error();
        if error.raw_os_error() != Some(libc::ENODATA) {
            return Err(error);
        }
        // The source has no ACL; remove one inherited by the temporary file.
        // SAFETY: the descriptor and attribute name are valid.
        if unsafe { libc::fremovexattr(destination.as_raw_fd(), name.as_ptr()) } != 0 {
            let error = io::Error::last_os_error();
            if error.raw_os_error() != Some(libc::ENODATA) {
                return Err(error);
            }
        }
        return Ok(());
    }
    let mut acl = vec![0u8; size as usize];
    // SAFETY: the buffer is allocated with the reported size and remains live.
    let size = unsafe {
        libc::fgetxattr(source.as_raw_fd(), name.as_ptr(), acl.as_mut_ptr().cast(), acl.len())
    };
    if size < 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: acl holds the returned bytes; flags=0 creates or replaces the ACL.
    if unsafe {
        libc::fsetxattr(
            destination.as_raw_fd(),
            name.as_ptr(),
            acl.as_ptr().cast(),
            size as usize,
            0,
        )
    } != 0
    {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(all(unix, not(any(target_os = "linux", target_os = "macos"))))]
fn copy_acl(_source: &File, _destination: &File) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "cannot preserve sync file ACLs on this platform",
    ))
}

#[cfg(windows)]
pub(crate) fn preserve_file_security(
    source: &File,
    destination: &File,
    destination_path: &Path,
) -> io::Result<()> {
    use std::os::windows::fs::OpenOptionsExt;
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Authorization::{
        GetSecurityInfo, SE_FILE_OBJECT, SetSecurityInfo,
    };
    use windows_sys::Win32::Security::{
        DACL_SECURITY_INFORMATION, GROUP_SECURITY_INFORMATION, GetSecurityDescriptorControl,
        OWNER_SECURITY_INFORMATION, PROTECTED_DACL_SECURITY_INFORMATION, SE_DACL_PROTECTED,
        UNPROTECTED_DACL_SECURITY_INFORMATION,
    };
    use windows_sys::Win32::Storage::FileSystem::{READ_CONTROL, WRITE_DAC, WRITE_OWNER};

    struct Descriptor(*mut std::ffi::c_void);
    impl Drop for Descriptor {
        fn drop(&mut self) {
            // SAFETY: GetSecurityInfo allocated this descriptor with LocalAlloc.
            unsafe { LocalFree(self.0) };
        }
    }
    let information =
        OWNER_SECURITY_INFORMATION | GROUP_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION;
    let mut owner = std::ptr::null_mut();
    let mut group = std::ptr::null_mut();
    let mut dacl = std::ptr::null_mut();
    let mut descriptor = std::ptr::null_mut();
    // SAFETY: the source handle is live and all output pointers are valid.
    let error = unsafe {
        GetSecurityInfo(
            source.as_raw_handle(),
            SE_FILE_OBJECT,
            information,
            &mut owner,
            &mut group,
            &mut dacl,
            std::ptr::null_mut(),
            &mut descriptor,
        )
    };
    if error != 0 {
        return Err(io::Error::from_raw_os_error(error as i32));
    }
    let _descriptor = Descriptor(descriptor);
    let mut control = 0;
    let mut revision = 0;
    // SAFETY: descriptor was returned by GetSecurityInfo; output pointers are valid.
    if unsafe { GetSecurityDescriptorControl(descriptor, &mut control, &mut revision) } == 0 {
        return Err(io::Error::last_os_error());
    }
    let inheritance = if control & SE_DACL_PROTECTED != 0 {
        PROTECTED_DACL_SECURITY_INFORMATION
    } else {
        UNPROTECTED_DACL_SECURITY_INFORMATION
    };
    let security_handle = std::fs::OpenOptions::new()
        .access_mode(READ_CONTROL | WRITE_DAC | WRITE_OWNER)
        .open(destination_path)?;
    // Preserve both the DACL and its inheritance policy before staging data.
    // SAFETY: both the destination handle and descriptor-backed pointers are live.
    let error = unsafe {
        SetSecurityInfo(
            security_handle.as_raw_handle(),
            SE_FILE_OBJECT,
            information | inheritance,
            owner,
            group,
            dacl,
            std::ptr::null(),
        )
    };
    if error != 0 {
        return Err(io::Error::from_raw_os_error(error as i32));
    }
    destination.set_permissions(source.metadata()?.permissions())
}
