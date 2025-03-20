use crate::window::MAIN_WINDOW_PREFIX;
use hex_color::HexColor;
use log::warn;
use objc::{msg_send, sel, sel_impl};
use rand::distr::Alphanumeric;
use rand::Rng;
use tauri::{
    plugin::{Builder, TauriPlugin},
    Emitter, Listener, Manager, Runtime, Window, WindowEvent,
};

const WINDOW_CONTROL_PAD_X: f64 = 13.0;
const WINDOW_CONTROL_PAD_Y: f64 = 18.0;

struct UnsafeWindowHandle(*mut std::ffi::c_void);

unsafe impl Send for UnsafeWindowHandle {}

unsafe impl Sync for UnsafeWindowHandle {}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("mac_window")
        .on_window_ready(|window| {
            #[cfg(target_os = "macos")]
            {
                setup_traffic_light_positioner(&window);
                let h = window.app_handle();

                let window_for_theme = window.clone();
                let id1 = h.listen("yaak_bg_changed", move |ev| {
                    let color_str: String = match serde_json::from_str(ev.payload()) {
                        Ok(color) => color,
                        Err(err) => {
                            warn!("Failed to JSON parse color '{}': {}", ev.payload(), err);
                            return;
                        }
                    };

                    match HexColor::parse_rgb(color_str.trim()) {
                        Ok(color) => {
                            update_window_theme(window_for_theme.clone(), color);
                        }
                        Err(err) => {
                            warn!("Failed to parse background color '{}': {}", color_str, err)
                        }
                    }
                });

                let window_for_title = window.clone();
                let id2 = h.listen("yaak_title_changed", move |ev| {
                    let title: String = match serde_json::from_str(ev.payload()) {
                        Ok(title) => title,
                        Err(err) => {
                            warn!("Failed to parse window title \"{}\": {}", ev.payload(), err);
                            return;
                        }
                    };

                    update_window_title(window_for_title.clone(), title);
                });

                let h = h.clone();
                window.on_window_event(move |e| {
                    match e {
                        WindowEvent::Destroyed => {
                            h.unlisten(id1);
                            h.unlisten(id2);
                        }
                        _ => {}
                    };
                });
            }
            return;
        })
        .build()
}

#[cfg(target_os = "macos")]
fn update_window_title<R: Runtime>(window: Window<R>, title: String) {
    use cocoa::{appkit::NSWindow, base::nil, foundation::NSString};

    unsafe {
        let window_handle = UnsafeWindowHandle(window.ns_window().unwrap());

        let window2 = window.clone();
        let label = window.label().to_string();
        let _ = window.run_on_main_thread(move || {
            let win_title = NSString::alloc(nil).init_str(&title);
            let handle = window_handle;
            NSWindow::setTitle_(handle.0 as cocoa::base::id, win_title);
            position_traffic_lights(
                UnsafeWindowHandle(window2.ns_window().expect("Failed to create window handle")),
                WINDOW_CONTROL_PAD_X,
                WINDOW_CONTROL_PAD_Y,
                label,
            );
        });
    }
}

#[cfg(target_os = "macos")]
fn update_window_theme<R: Runtime>(window: Window<R>, color: HexColor) {
    use cocoa::appkit::{
        NSAppearance, NSAppearanceNameVibrantDark, NSAppearanceNameVibrantLight, NSWindow,
    };

    let brightness = (color.r as u64 + color.g as u64 + color.b as u64) / 3;
    let label = window.label().to_string();

    unsafe {
        let window_handle = UnsafeWindowHandle(window.ns_window().unwrap());
        let window2 = window.clone();
        let _ = window.run_on_main_thread(move || {
            let handle = window_handle;

            let selected_appearance = if brightness >= 128 {
                NSAppearance(NSAppearanceNameVibrantLight)
            } else {
                NSAppearance(NSAppearanceNameVibrantDark)
            };

            NSWindow::setAppearance(handle.0 as cocoa::base::id, selected_appearance);
            position_traffic_lights(
                UnsafeWindowHandle(window2.ns_window().expect("Failed to create window handle")),
                WINDOW_CONTROL_PAD_X,
                WINDOW_CONTROL_PAD_Y,
                label,
            );
        });
    }
}

#[cfg(target_os = "macos")]
fn position_traffic_lights(ns_window_handle: UnsafeWindowHandle, x: f64, y: f64, label: String) {
    if !label.starts_with(MAIN_WINDOW_PREFIX) {
        return;
    }

    use cocoa::appkit::{NSView, NSWindow, NSWindowButton};
    use cocoa::foundation::NSRect;

    let ns_window = ns_window_handle.0 as cocoa::base::id;
    unsafe {
        let close = ns_window.standardWindowButton_(NSWindowButton::NSWindowCloseButton);
        let miniaturize =
            ns_window.standardWindowButton_(NSWindowButton::NSWindowMiniaturizeButton);
        let zoom = ns_window.standardWindowButton_(NSWindowButton::NSWindowZoomButton);

        let title_bar_container_view = close.superview().superview();

        let close_rect: NSRect = msg_send![close, frame];
        let button_height = close_rect.size.height;

        let title_bar_frame_height = button_height + y;
        let mut title_bar_rect = NSView::frame(title_bar_container_view);
        title_bar_rect.size.height = title_bar_frame_height;
        title_bar_rect.origin.y = NSView::frame(ns_window).size.height - title_bar_frame_height;
        let _: () = msg_send![title_bar_container_view, setFrame: title_bar_rect];

        let window_buttons = vec![close, miniaturize, zoom];
        let space_between = NSView::frame(miniaturize).origin.x - NSView::frame(close).origin.x;

        for (i, button) in window_buttons.into_iter().enumerate() {
            let mut rect: NSRect = NSView::frame(button);
            rect.origin.x = x + (i as f64 * space_between);
            button.setFrameOrigin(rect.origin);
        }
    }
}

#[cfg(target_os = "macos")]
#[derive(Debug)]
struct WindowState<R: Runtime> {
    window: Window<R>,
}

#[cfg(target_os = "macos")]
pub fn setup_traffic_light_positioner<R: Runtime>(window: &Window<R>) {
    use cocoa::appkit::NSWindow;
    use cocoa::base::{id, BOOL};
    use cocoa::delegate;
    use cocoa::foundation::NSUInteger;
    use objc::runtime::{Object, Sel};
    use std::ffi::c_void;

    position_traffic_lights(
        UnsafeWindowHandle(window.ns_window().expect("Failed to create window handle")),
        WINDOW_CONTROL_PAD_X,
        WINDOW_CONTROL_PAD_Y,
        window.label().to_string(),
    );

    // Ensure they stay in place while resizing the window.
    fn with_window_state<R: Runtime, F: FnOnce(&mut WindowState<R>) -> T, T>(
        this: &Object,
        func: F,
    ) {
        let ptr = unsafe {
            let x: *mut c_void = *this.get_ivar("app_box");
            &mut *(x as *mut WindowState<R>)
        };
        func(ptr);
    }

    unsafe {
        let ns_win =
            window.ns_window().expect("NS Window should exist to mount traffic light delegate.")
                as id;

        let current_delegate: id = ns_win.delegate();

        extern "C" fn on_window_should_close(this: &Object, _cmd: Sel, sender: id) -> BOOL {
            unsafe {
                let super_del: id = *this.get_ivar("super_delegate");
                msg_send![super_del, windowShouldClose: sender]
            }
        }
        extern "C" fn on_window_will_close(this: &Object, _cmd: Sel, notification: id) {
            unsafe {
                let super_del: id = *this.get_ivar("super_delegate");
                let _: () = msg_send![super_del, windowWillClose: notification];
            }
        }
        extern "C" fn on_window_did_resize<R: Runtime>(this: &Object, _cmd: Sel, notification: id) {
            unsafe {
                with_window_state(&*this, |state: &mut WindowState<R>| {
                    let id = state
                        .window
                        .ns_window()
                        .expect("NS window should exist on state to handle resize")
                        as id;

                    position_traffic_lights(
                        UnsafeWindowHandle(id as *mut c_void),
                        WINDOW_CONTROL_PAD_X,
                        WINDOW_CONTROL_PAD_Y,
                        state.window.label().to_string(),
                    );
                });

                let super_del: id = *this.get_ivar("super_delegate");
                let _: () = msg_send![super_del, windowDidResize: notification];
            }
        }
        extern "C" fn on_window_did_move(this: &Object, _cmd: Sel, notification: id) {
            unsafe {
                let super_del: id = *this.get_ivar("super_delegate");
                let _: () = msg_send![super_del, windowDidMove: notification];
            }
        }
        extern "C" fn on_window_did_change_backing_properties(
            this: &Object,
            _cmd: Sel,
            notification: id,
        ) {
            unsafe {
                let super_del: id = *this.get_ivar("super_delegate");
                let _: () = msg_send![super_del, windowDidChangeBackingProperties: notification];
            }
        }
        extern "C" fn on_window_did_become_key(this: &Object, _cmd: Sel, notification: id) {
            unsafe {
                let super_del: id = *this.get_ivar("super_delegate");
                let _: () = msg_send![super_del, windowDidBecomeKey: notification];
            }
        }
        extern "C" fn on_window_did_resign_key(this: &Object, _cmd: Sel, notification: id) {
            unsafe {
                let super_del: id = *this.get_ivar("super_delegate");
                let _: () = msg_send![super_del, windowDidResignKey: notification];
            }
        }
        extern "C" fn on_dragging_entered(this: &Object, _cmd: Sel, notification: id) -> BOOL {
            unsafe {
                let super_del: id = *this.get_ivar("super_delegate");
                msg_send![super_del, draggingEntered: notification]
            }
        }
        extern "C" fn on_prepare_for_drag_operation(
            this: &Object,
            _cmd: Sel,
            notification: id,
        ) -> BOOL {
            unsafe {
                let super_del: id = *this.get_ivar("super_delegate");
                msg_send![super_del, prepareForDragOperation: notification]
            }
        }
        extern "C" fn on_perform_drag_operation(this: &Object, _cmd: Sel, sender: id) -> BOOL {
            unsafe {
                let super_del: id = *this.get_ivar("super_delegate");
                msg_send![super_del, performDragOperation: sender]
            }
        }
        extern "C" fn on_conclude_drag_operation(this: &Object, _cmd: Sel, notification: id) {
            unsafe {
                let super_del: id = *this.get_ivar("super_delegate");
                let _: () = msg_send![super_del, concludeDragOperation: notification];
            }
        }
        extern "C" fn on_dragging_exited(this: &Object, _cmd: Sel, notification: id) {
            unsafe {
                let super_del: id = *this.get_ivar("super_delegate");
                let _: () = msg_send![super_del, draggingExited: notification];
            }
        }
        extern "C" fn on_window_will_use_full_screen_presentation_options(
            this: &Object,
            _cmd: Sel,
            window: id,
            proposed_options: NSUInteger,
        ) -> NSUInteger {
            unsafe {
                let super_del: id = *this.get_ivar("super_delegate");
                msg_send![super_del, window: window willUseFullScreenPresentationOptions: proposed_options]
            }
        }
        extern "C" fn on_window_did_enter_full_screen<R: Runtime>(
            this: &Object,
            _cmd: Sel,
            notification: id,
        ) {
            unsafe {
                with_window_state(&*this, |state: &mut WindowState<R>| {
                    state.window.emit("did-enter-fullscreen", ()).expect("Failed to emit event");
                });

                let super_del: id = *this.get_ivar("super_delegate");
                let _: () = msg_send![super_del, windowDidEnterFullScreen: notification];
            }
        }
        extern "C" fn on_window_will_enter_full_screen<R: Runtime>(
            this: &Object,
            _cmd: Sel,
            notification: id,
        ) {
            unsafe {
                with_window_state(&*this, |state: &mut WindowState<R>| {
                    state.window.emit("will-enter-fullscreen", ()).expect("Failed to emit event");
                });

                let super_del: id = *this.get_ivar("super_delegate");
                let _: () = msg_send![super_del, windowWillEnterFullScreen: notification];
            }
        }
        extern "C" fn on_window_did_exit_full_screen<R: Runtime>(
            this: &Object,
            _cmd: Sel,
            notification: id,
        ) {
            unsafe {
                with_window_state(&*this, |state: &mut WindowState<R>| {
                    state.window.emit("did-exit-fullscreen", ()).expect("Failed to emit event");

                    let id = state.window.ns_window().expect("Failed to emit event") as id;
                    position_traffic_lights(
                        UnsafeWindowHandle(id as *mut c_void),
                        WINDOW_CONTROL_PAD_X,
                        WINDOW_CONTROL_PAD_Y,
                        state.window.label().to_string(),
                    );
                });

                let super_del: id = *this.get_ivar("super_delegate");
                let _: () = msg_send![super_del, windowDidExitFullScreen: notification];
            }
        }
        extern "C" fn on_window_will_exit_full_screen<R: Runtime>(
            this: &Object,
            _cmd: Sel,
            notification: id,
        ) {
            unsafe {
                with_window_state(&*this, |state: &mut WindowState<R>| {
                    state.window.emit("will-exit-fullscreen", ()).expect("Failed to emit event");
                });

                let super_del: id = *this.get_ivar("super_delegate");
                let _: () = msg_send![super_del, windowWillExitFullScreen: notification];
            }
        }
        extern "C" fn on_window_did_fail_to_enter_full_screen(
            this: &Object,
            _cmd: Sel,
            window: id,
        ) {
            unsafe {
                let super_del: id = *this.get_ivar("super_delegate");
                let _: () = msg_send![super_del, windowDidFailToEnterFullScreen: window];
            }
        }
        extern "C" fn on_effective_appearance_did_change(
            this: &Object,
            _cmd: Sel,
            notification: id,
        ) {
            unsafe {
                let super_del: id = *this.get_ivar("super_delegate");
                let _: () = msg_send![super_del, effectiveAppearanceDidChange: notification];
            }
        }
        extern "C" fn on_effective_appearance_did_changed_on_main_thread(
            this: &Object,
            _cmd: Sel,
            notification: id,
        ) {
            unsafe {
                let super_del: id = *this.get_ivar("super_delegate");
                let _: () = msg_send![
                    super_del,
                    effectiveAppearanceDidChangedOnMainThread: notification
                ];
            }
        }

        // Are we de-allocing this properly? (I miss safe Rust :(  )
        let window_label = window.label().to_string();

        let app_state = WindowState {
            window: window.clone(),
        };
        let app_box = Box::into_raw(Box::new(app_state)) as *mut c_void;
        let random_str: String =
            rand::rng().sample_iter(&Alphanumeric).take(20).map(char::from).collect();

        // We need to ensure we have a unique delegate name, otherwise we will panic while trying to create a duplicate
        // delegate with the same name.
        let delegate_name = format!("windowDelegate_{}_{}", window_label, random_str);

        ns_win.setDelegate_(delegate!(&delegate_name, {
            window: id = ns_win,
            app_box: *mut c_void = app_box,
            toolbar: id = cocoa::base::nil,
            super_delegate: id = current_delegate,
            (windowShouldClose:) => on_window_should_close as extern fn(&Object, Sel, id) -> BOOL,
            (windowWillClose:) => on_window_will_close as extern fn(&Object, Sel, id),
            (windowDidResize:) => on_window_did_resize::<R> as extern fn(&Object, Sel, id),
            (windowDidMove:) => on_window_did_move as extern fn(&Object, Sel, id),
            (windowDidChangeBackingProperties:) => on_window_did_change_backing_properties as extern fn(&Object, Sel, id),
            (windowDidBecomeKey:) => on_window_did_become_key as extern fn(&Object, Sel, id),
            (windowDidResignKey:) => on_window_did_resign_key as extern fn(&Object, Sel, id),
            (draggingEntered:) => on_dragging_entered as extern fn(&Object, Sel, id) -> BOOL,
            (prepareForDragOperation:) => on_prepare_for_drag_operation as extern fn(&Object, Sel, id) -> BOOL,
            (performDragOperation:) => on_perform_drag_operation as extern fn(&Object, Sel, id) -> BOOL,
            (concludeDragOperation:) => on_conclude_drag_operation as extern fn(&Object, Sel, id),
            (draggingExited:) => on_dragging_exited as extern fn(&Object, Sel, id),
            (window:willUseFullScreenPresentationOptions:) => on_window_will_use_full_screen_presentation_options as extern fn(&Object, Sel, id, NSUInteger) -> NSUInteger,
            (windowDidEnterFullScreen:) => on_window_did_enter_full_screen::<R> as extern fn(&Object, Sel, id),
            (windowWillEnterFullScreen:) => on_window_will_enter_full_screen::<R> as extern fn(&Object, Sel, id),
            (windowDidExitFullScreen:) => on_window_did_exit_full_screen::<R> as extern fn(&Object, Sel, id),
            (windowWillExitFullScreen:) => on_window_will_exit_full_screen::<R> as extern fn(&Object, Sel, id),
            (windowDidFailToEnterFullScreen:) => on_window_did_fail_to_enter_full_screen as extern fn(&Object, Sel, id),
            (effectiveAppearanceDidChange:) => on_effective_appearance_did_change as extern fn(&Object, Sel, id),
            (effectiveAppearanceDidChangedOnMainThread:) => on_effective_appearance_did_changed_on_main_thread as extern fn(&Object, Sel, id)
        }))
    }
}
