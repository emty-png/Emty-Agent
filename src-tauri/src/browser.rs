use serde::{Deserialize, Serialize};
#[cfg(windows)]
use serde_json::json;
use serde_json::Value as JsonValue;
use tauri::utils::config::BackgroundThrottlingPolicy;
use tauri::webview::{NewWindowResponse, PageLoadEvent, WebviewBuilder};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Runtime, Url, WebviewUrl};

const BROWSER_SURFACE_PREFIX: &str = "browser-surface-";
const MAIN_WINDOW_LABEL: &str = "main";
const BROWSER_STATE_EVENT: &str = "browser://state";
const BROWSER_BRIDGE_EVENT: &str = "browser://bridge";
const BROWSER_NEW_TAB_EVENT: &str = "browser://new-tab";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserStatePayload {
    session_id: String,
    kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserNewTabPayload {
    session_id: String,
    url: String,
}

fn browser_bridge_script(session_id: &str) -> Result<String, String> {
    let template = include_str!("./browser_bridge.js");
    let session_json = serde_json::to_string(session_id).map_err(|e| e.to_string())?;
    let main_json = serde_json::to_string(MAIN_WINDOW_LABEL).map_err(|e| e.to_string())?;
    let state_event_json = serde_json::to_string(BROWSER_STATE_EVENT).map_err(|e| e.to_string())?;
    let bridge_event_json =
        serde_json::to_string(BROWSER_BRIDGE_EVENT).map_err(|e| e.to_string())?;

    Ok(template
        .replace("__SESSION_ID__", &session_json)
        .replace("__MAIN_LABEL__", &main_json)
        .replace("__STATE_EVENT__", &state_event_json)
        .replace("__BRIDGE_EVENT__", &bridge_event_json))
}

fn surface_label(session_id: &str) -> String {
    let safe = session_id
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>();

    format!("{BROWSER_SURFACE_PREFIX}{safe}")
}

fn emit_state<R: Runtime>(
    app: &AppHandle<R>,
    session_id: &str,
    kind: &'static str,
    url: Option<String>,
    title: Option<String>,
) {
    let _ = app.emit_to(
        MAIN_WINDOW_LABEL,
        BROWSER_STATE_EVENT,
        BrowserStatePayload {
            session_id: session_id.to_string(),
            kind,
            url,
            title,
        },
    );
}

fn browser_surfaces<R: Runtime>(app: &AppHandle<R>) -> Vec<tauri::Webview<R>> {
    app.webviews()
        .into_iter()
        .filter_map(|(label, webview)| label.starts_with(BROWSER_SURFACE_PREFIX).then_some(webview))
        .collect()
}

fn hide_surface<R: Runtime>(surface: &tauri::Webview<R>) -> Result<(), String> {
    surface.hide().map_err(|e| e.to_string())
}

fn hide_other_surfaces<R: Runtime>(app: &AppHandle<R>, active_label: &str) -> Result<(), String> {
    for surface in browser_surfaces(app) {
        if surface.label() != active_label {
            hide_surface(&surface)?;
        }
    }

    Ok(())
}

fn hide_surfaces<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    for surface in browser_surfaces(app) {
        hide_surface(&surface)?;
    }

    Ok(())
}

/// Linux-only overlay layer for browser surfaces.
///
/// Tauri packs `WindowChild` webviews into the window's vertical `GtkBox`,
/// which stacks children and ignores the requested position/size (upstream
/// tauri#10420, fix PR tauri#15704 still open). Wry honors bounds only for
/// `GtkFixed` parents. So on Linux we restructure the window once into
/// `GtkWindow > GtkOverlay > [vbox(main content), GtkFixed(layer)]` and
/// reparent every browser surface into the fixed layer, positioning with
/// `fixed.move_/put` + size request (client-side GTK calls, Wayland-safe).
#[cfg(target_os = "linux")]
mod linux_overlay {
    use gtk::prelude::*;

    const LAYER_NAME: &str = "emty-browser-layer";

    fn as_fixed(widget: &gtk::Widget) -> Option<gtk::Fixed> {
        widget.clone().dynamic_cast::<gtk::Fixed>().ok()
    }

    fn find_layer_in_overlay(overlay: &gtk::Overlay) -> Option<gtk::Fixed> {
        overlay
            .children()
            .into_iter()
            .filter_map(|child| as_fixed(&child))
            .find(|fixed| fixed.widget_name() == LAYER_NAME)
    }

    /// Ensure the overlay restructure exists for the window containing
    /// `container` (the surface's current direct parent) and return the
    /// fixed layer, creating it on first use.
    fn ensure_layer(container: &gtk::Container) -> Result<gtk::Fixed, String> {
        let win = container
            .parent()
            .and_then(|p| p.dynamic_cast::<gtk::Container>().ok())
            .ok_or_else(|| String::from("browser surface has no window parent"))?;

        // Restructure already done before: reuse the tagged layer.
        if let Ok(overlay) = win.clone().dynamic_cast::<gtk::Overlay>() {
            if let Some(layer) = find_layer_in_overlay(&overlay) {
                // Events pass through the layer except on the surfaces
                // themselves, so the app stays clickable beside/around them.
                overlay.set_overlay_pass_through(&layer, true);
                return Ok(layer);
            }
            let layer = gtk::Fixed::new();
            layer.set_widget_name(LAYER_NAME);
            overlay.add_overlay(&layer);
            overlay.set_overlay_pass_through(&layer, true);
            overlay.show();
            return Ok(layer);
        }

        // First surface: wrap `container` (the window vbox) in an overlay.
        let overlay = gtk::Overlay::new();
        let layer = gtk::Fixed::new();
        layer.set_widget_name(LAYER_NAME);
        win.remove(container);
        overlay.add(container);
        overlay.add_overlay(&layer);
        overlay.set_overlay_pass_through(&layer, true);
        win.add(&overlay);
        overlay.show();
        // `layer` stays hidden until the first placement so an empty overlay
        // never intercepts input.
        Ok(layer)
    }

    /// Move `widget` into the fixed layer at `bounds` (logical px, rounded).
    /// Must run on the GTK main thread.
    pub fn place_surface(
        widget: &webkit2gtk::WebView,
        bounds: &super::BrowserBounds,
    ) -> Result<(), String> {
        let x = bounds.x.round() as i32;
        let y = bounds.y.round() as i32;
        let width = bounds.width.max(1.0).round() as i32;
        let height = bounds.height.max(1.0).round() as i32;

        if let Some(fixed) = widget.parent().and_then(|p| as_fixed(&p)) {
            // Already layered (any GtkFixed positions): move_ persists
            // across relayouts, unlike a bare size_allocate (wry#1745).
            fixed.move_(widget, x, y);
        } else {
            let container = widget
                .parent()
                .and_then(|p| p.dynamic_cast::<gtk::Container>().ok())
                .ok_or_else(|| String::from("browser surface has no parent"))?;
            let layer = ensure_layer(&container)?;
            container.remove(widget);
            widget.set_size_request(width, height);
            layer.put(widget, x, y);
        }
        widget.set_size_request(width, height);
        widget.size_allocate(&gtk::Allocation::new(x, y, width, height));
        if let Some(fixed) = widget.parent().and_then(|p| as_fixed(&p)) {
            fixed.show();
        }
        Ok(())
    }

    /// Hide the overlay layer reachable from `widget`, if any.
    /// Must run on the GTK main thread.
    pub fn hide_layer_for(widget: &webkit2gtk::WebView) {
        let mut current = widget.parent();
        while let Some(parent) = current {
            if let Some(fixed) = as_fixed(&parent) {
                if fixed.widget_name() == LAYER_NAME {
                    fixed.hide();
                    return;
                }
            }
            current = parent.parent();
        }
    }
}

/// Wayland compositors (e.g. KWin) clamp negative child coordinates into the
/// visible area instead of parking the webview off-screen. Treat far-negative
/// bounds as "hide" so background tabs can't bleed through at the wrong origin.
fn is_offscreen_bounds(bounds: &BrowserBounds) -> bool {
    bounds.x < -5000.0 || bounds.y < -5000.0
}

fn close_surface_if_present<R: Runtime>(
    app: &AppHandle<R>,
    session_id: &str,
) -> Result<(), String> {
    if let Some(surface) = app.get_webview(&surface_label(session_id)) {
        surface.close().map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn get_surface<R: Runtime>(
    app: &AppHandle<R>,
    session_id: &str,
) -> Result<tauri::Webview<R>, String> {
    app.get_webview(&surface_label(session_id))
        .ok_or_else(|| format!("Browser surface is not mounted for session {session_id}"))
}

fn profile_dir<R: Runtime>(
    app: &AppHandle<R>,
    session_id: &str,
) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("browser-profiles")
        .join(session_id);

    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn parse_external_url(input: &str) -> Result<Url, String> {
    Url::parse(input).map_err(|e| format!("Invalid browser URL \"{input}\": {e}"))
}

#[tauri::command]
pub async fn browser_mount_surface<R: Runtime>(
    app: AppHandle<R>,
    session_id: String,
    url: String,
    bounds: BrowserBounds,
) -> Result<(), String> {
    let window = app
        .get_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| "Main window not found".to_string())?;
    let label = surface_label(&session_id);

    hide_other_surfaces(&app, &label)?;

    if is_offscreen_bounds(&bounds) {
        if let Some(surface) = app.get_webview(&label) {
            hide_surface(&surface)?;
        }
        #[cfg(target_os = "linux")]
        if browser_surfaces(&app).len() <= 1 {
            if let Some(surface) = browser_surfaces(&app).into_iter().next() {
                let _ = surface.with_webview(move |platform| {
                    linux_overlay::hide_layer_for(&platform.inner());
                });
            }
        }
        return Ok(());
    }

    if let Some(surface) = app.get_webview(&label) {
        // Linux positions via the GtkOverlay layer (Tauri set_position /
        // set_size are no-ops there); other platforms use Tauri directly.
        // The with_webview closure runs on the GTK main thread.
        #[cfg(target_os = "linux")]
        {
            let bounds_for_place = bounds.clone();
            surface
                .with_webview(move |platform| {
                    if let Err(e) =
                        linux_overlay::place_surface(&platform.inner(), &bounds_for_place)
                    {
                        eprintln!("[browser] linux overlay placement failed: {e}");
                    }
                })
                .map_err(|e| e.to_string())?;
        }
        #[cfg(not(target_os = "linux"))]
        {
            let x = bounds.x;
            let y = bounds.y;
            let width = bounds.width.max(1.0);
            let height = bounds.height.max(1.0);

            surface
                .set_position(LogicalPosition::new(x, y))
                .map_err(|e| e.to_string())?;
            surface
                .set_size(LogicalSize::new(width, height))
                .map_err(|e| e.to_string())?;
        }
        surface.show().map_err(|e| e.to_string())?;

        emit_state(&app, &session_id, "shown", Some(url), None);

        return Ok(());
    }

    let app_for_nav = app.clone();
    let session_for_nav = session_id.clone();
    let app_for_title = app.clone();
    let session_for_title = session_id.clone();
    let app_for_load = app.clone();
    let session_for_load = session_id.clone();
    let app_for_popup = app.clone();
    let session_for_popup = session_id.clone();

    let parsed_url = parse_external_url(&url)?;
    let builder = WebviewBuilder::new(label, WebviewUrl::External(parsed_url))
        .data_directory(profile_dir(&app, &session_id)?)
        .accept_first_mouse(true)
        .background_throttling(BackgroundThrottlingPolicy::Disabled)
        .on_navigation(move |next_url| {
            emit_state(
                &app_for_nav,
                &session_for_nav,
                "navigation-requested",
                Some(next_url.to_string()),
                None,
            );
            true
        })
        .on_document_title_changed(move |_webview, title| {
            emit_state(
                &app_for_title,
                &session_for_title,
                "title-changed",
                None,
                Some(title),
            );
        })
        .on_page_load(move |_webview, payload| {
            let kind = match payload.event() {
                PageLoadEvent::Started => "page-load-started",
                PageLoadEvent::Finished => "page-load-finished",
            };

            emit_state(
                &app_for_load,
                &session_for_load,
                kind,
                Some(payload.url().to_string()),
                None,
            );
        })
        .on_new_window(move |next_url, _features| {
            let _ = app_for_popup.emit_to(
                MAIN_WINDOW_LABEL,
                BROWSER_NEW_TAB_EVENT,
                BrowserNewTabPayload {
                    session_id: session_for_popup.clone(),
                    url: next_url.to_string(),
                },
            );

            NewWindowResponse::Deny
        })
        .initialization_script(browser_bridge_script(&session_id)?);

    if is_offscreen_bounds(&bounds) {
        window
            .add_child(
                builder,
                LogicalPosition::new(0.0, 0.0),
                LogicalSize::new(1.0, 1.0),
            )
            .map_err(|e| e.to_string())?;
        hide_surfaces(&app)?;

        emit_state(&app, &session_id, "mounted", Some(url), None);

        return Ok(());
    }

    let x = bounds.x;
    let y = bounds.y;
    let width = bounds.width.max(1.0);
    let height = bounds.height.max(1.0);

    let surface = window
        .add_child(
            builder,
            LogicalPosition::new(x, y),
            LogicalSize::new(width, height),
        )
        .map_err(|e| e.to_string())?;

    // On Linux add_child packs into the GtkBox (position ignored); move the
    // fresh surface into the overlay layer at the requested bounds.
    #[cfg(target_os = "linux")]
    {
        let bounds_for_place = bounds.clone();
        surface
            .with_webview(move |platform| {
                if let Err(e) =
                    linux_overlay::place_surface(&platform.inner(), &bounds_for_place)
                {
                    eprintln!("[browser] linux overlay placement failed: {e}");
                }
            })
            .map_err(|e| e.to_string())?;
    }

    emit_state(&app, &session_id, "mounted", Some(url), None);

    Ok(())
}

#[tauri::command]
pub async fn browser_resize_surface<R: Runtime>(
    app: AppHandle<R>,
    session_id: Option<String>,
    bounds: BrowserBounds,
) -> Result<(), String> {
    if is_offscreen_bounds(&bounds) {
        hide_surfaces(&app)?;
        #[cfg(target_os = "linux")]
        if let Some(surface) = browser_surfaces(&app).into_iter().next() {
            let _ = surface.with_webview(move |platform| {
                linux_overlay::hide_layer_for(&platform.inner());
            });
        }
        return Ok(());
    }

    let surfaces = if let Some(session_id) = session_id {
        get_surface(&app, &session_id).map(|surface| vec![surface])?
    } else {
        browser_surfaces(&app)
    };

    #[cfg(target_os = "linux")]
    {
        for surface in &surfaces {
            let bounds_for_place = bounds.clone();
            surface
                .with_webview(move |platform| {
                    if let Err(e) =
                        linux_overlay::place_surface(&platform.inner(), &bounds_for_place)
                    {
                        eprintln!("[browser] linux overlay placement failed: {e}");
                    }
                })
                .map_err(|e| e.to_string())?;
            surface.show().map_err(|e| e.to_string())?;
        }

        return Ok(());
    }

    #[cfg(not(target_os = "linux"))]
    {
        let x = bounds.x;
        let y = bounds.y;
        let width = bounds.width.max(1.0);
        let height = bounds.height.max(1.0);

        for surface in surfaces {
            surface
                .set_position(LogicalPosition::new(x, y))
                .map_err(|e| e.to_string())?;
            surface
                .set_size(LogicalSize::new(width, height))
                .map_err(|e| e.to_string())?;
            surface.show().map_err(|e| e.to_string())?;
        }

        Ok(())
    }
}

#[tauri::command]
pub async fn browser_unmount_surface<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    hide_surfaces(&app)?;
    #[cfg(target_os = "linux")]
    if let Some(surface) = browser_surfaces(&app).into_iter().next() {
        let _ = surface.with_webview(move |platform| {
            linux_overlay::hide_layer_for(&platform.inner());
        });
    }
    Ok(())
}

#[tauri::command]
pub async fn browser_close_surface<R: Runtime>(
    app: AppHandle<R>,
    session_id: String,
) -> Result<(), String> {
    // Hide the overlay layer first (queued on the main thread ahead of the
    // destroy) when this is the last surface.
    #[cfg(target_os = "linux")]
    if browser_surfaces(&app).len() <= 1 {
        if let Some(surface) = app.get_webview(&surface_label(&session_id)) {
            let _ = surface.with_webview(move |platform| {
                linux_overlay::hide_layer_for(&platform.inner());
            });
        }
    }
    close_surface_if_present(&app, &session_id)?;
    Ok(())
}

#[tauri::command]
pub async fn browser_surface_navigate<R: Runtime>(
    app: AppHandle<R>,
    session_id: String,
    url: String,
) -> Result<(), String> {
    let surface = get_surface(&app, &session_id)?;
    surface
        .navigate(parse_external_url(&url)?)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn browser_surface_reload<R: Runtime>(
    app: AppHandle<R>,
    session_id: String,
) -> Result<(), String> {
    get_surface(&app, &session_id)?
        .reload()
        .map_err(|e| e.to_string())
}

#[cfg(windows)]
fn call_devtools_protocol_method<R: Runtime>(
    surface: tauri::Webview<R>,
    method_name: &'static str,
    params_json: String,
    timeout: std::time::Duration,
    timeout_message: &'static str,
) -> Result<String, String> {
    use std::sync::mpsc;
    use webview2_com::{CallDevToolsProtocolMethodCompletedHandler, CoTaskMemPWSTR};

    let (tx, rx) = mpsc::channel::<Result<String, String>>();

    surface
        .with_webview(move |platform| {
            let tx = tx.clone();
            let webview = match unsafe { platform.controller().CoreWebView2() } {
                Ok(webview) => webview,
                Err(err) => {
                    let _ = tx.send(Err(err.to_string()));
                    return;
                }
            };

            let handler_tx = tx.clone();
            let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(
                move |error_code, result| {
                    if let Err(err) = error_code {
                        let _ = handler_tx.send(Err(err.to_string()));
                        return Ok(());
                    }

                    let _ = handler_tx.send(Ok(result));
                    Ok(())
                },
            ));

            let method = CoTaskMemPWSTR::from(method_name);
            let params = CoTaskMemPWSTR::from(params_json.as_str());

            if let Err(err) = unsafe {
                webview.CallDevToolsProtocolMethod(
                    *method.as_ref().as_pcwstr(),
                    *params.as_ref().as_pcwstr(),
                    &handler,
                )
            } {
                let _ = tx.send(Err(err.to_string()));
            }
        })
        .map_err(|e| e.to_string())?;

    rx.recv_timeout(timeout)
        .map_err(|_| timeout_message.to_string())?
}

#[cfg(windows)]
fn capture_surface_screenshot<R: Runtime>(surface: tauri::Webview<R>) -> Result<String, String> {
    let result_json = call_devtools_protocol_method(
        surface,
        "Page.captureScreenshot",
        r#"{"format":"png","fromSurface":true,"captureBeyondViewport":false}"#.to_string(),
        std::time::Duration::from_secs(8),
        "Timed out capturing native browser screenshot",
    )?;

    let result: JsonValue = serde_json::from_str(&result_json).map_err(|e| e.to_string())?;
    let data = result
        .get("data")
        .and_then(JsonValue::as_str)
        .ok_or_else(|| "WebView2 screenshot response did not contain PNG data".to_string())?;

    Ok(format!("data:image/png;base64,{data}"))
}

#[cfg(windows)]
fn dispatch_surface_request_native<R: Runtime>(
    surface: tauri::Webview<R>,
    session_id: &str,
    payload: &JsonValue,
) -> Result<JsonValue, String> {
    let bridge_source = browser_bridge_script(session_id)?;
    let bridge_json = serde_json::to_string(&bridge_source).map_err(|e| e.to_string())?;
    let request_json = serde_json::to_string(payload).map_err(|e| e.to_string())?;
    let expression = format!(
        r#"(async () => {{
  const bridgeSource = {bridge_json};
  const request = {request_json};

  try {{
    if (!window.__EMTY_AGENT_BROWSER_BRIDGE__ || typeof window.__EMTY_AGENT_BROWSER_BRIDGE__.run !== 'function')
      (0, eval)(bridgeSource);

    if (!window.__EMTY_AGENT_BROWSER_BRIDGE__ || typeof window.__EMTY_AGENT_BROWSER_BRIDGE__.run !== 'function')
      throw new Error('Browser bridge is unavailable on this page.');

    const result = await window.__EMTY_AGENT_BROWSER_BRIDGE__.run(request);
    return {{ ok: true, result }};
  }}
  catch (error) {{
    return {{
      ok: false,
      error: String(error && error.message ? error.message : error),
    }};
  }}
}})()"#
    );
    let params = json!({
        "expression": expression,
        "awaitPromise": true,
        "returnByValue": true,
        "userGesture": true,
        "allowUnsafeEvalBlockedByCSP": true,
    })
    .to_string();
    let result_json = call_devtools_protocol_method(
        surface,
        "Runtime.evaluate",
        params,
        std::time::Duration::from_secs(30),
        "Timed out executing native browser action",
    )?;
    let result: JsonValue = serde_json::from_str(&result_json).map_err(|e| e.to_string())?;

    if let Some(exception) = result.get("exceptionDetails") {
        return Err(format!("Browser action failed: {exception}"));
    }

    let value = result
        .get("result")
        .and_then(|result| result.get("value"))
        .ok_or_else(|| "Browser action did not return a value.".to_string())?;

    if value.get("ok").and_then(JsonValue::as_bool) == Some(true) {
        return Ok(value.get("result").cloned().unwrap_or(JsonValue::Null));
    }

    Err(value
        .get("error")
        .and_then(JsonValue::as_str)
        .unwrap_or("Browser action failed")
        .to_string())
}

#[cfg(not(windows))]
fn capture_surface_screenshot<R: Runtime>(_surface: tauri::Webview<R>) -> Result<String, String> {
    Err("Native browser screenshots are only available on Windows right now.".to_string())
}

#[tauri::command]
pub async fn browser_surface_screenshot<R: Runtime>(
    app: AppHandle<R>,
    session_id: String,
) -> Result<String, String> {
    let surface = get_surface(&app, &session_id)?;
    capture_surface_screenshot(surface)
}

#[tauri::command]
pub async fn browser_surface_dispatch<R: Runtime>(
    app: AppHandle<R>,
    session_id: String,
    payload: JsonValue,
) -> Result<Option<JsonValue>, String> {
    let surface = get_surface(&app, &session_id)?;

    #[cfg(windows)]
    {
        return dispatch_surface_request_native(surface, &session_id, &payload).map(Some);
    }

    #[cfg(not(windows))]
    {
        let json = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
        let script = format!(
        "if (!window.__EMTY_AGENT_BROWSER_BRIDGE__ || typeof window.__EMTY_AGENT_BROWSER_BRIDGE__.dispatch !== 'function') {{ throw new Error('Browser bridge is unavailable on this page.'); }} window.__EMTY_AGENT_BROWSER_BRIDGE__.dispatch({json});"
    );

        surface.eval(script).map_err(|e| e.to_string())?;
        Ok(None)
    }
}
