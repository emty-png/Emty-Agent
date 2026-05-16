use serde::{Deserialize, Serialize};
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

    if let Some(surface) = app.get_webview(&label) {
        let x = bounds.x.max(0.0);
        let y = bounds.y.max(0.0);
        let width = bounds.width.max(1.0);
        let height = bounds.height.max(1.0);

        surface
            .set_position(LogicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
        surface
            .set_size(LogicalSize::new(width, height))
            .map_err(|e| e.to_string())?;
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

    let x = bounds.x.max(0.0);
    let y = bounds.y.max(0.0);
    let width = bounds.width.max(1.0);
    let height = bounds.height.max(1.0);

    window
        .add_child(
            builder,
            LogicalPosition::new(x, y),
            LogicalSize::new(width, height),
        )
        .map_err(|e| e.to_string())?;

    emit_state(&app, &session_id, "mounted", Some(url), None);

    Ok(())
}

#[tauri::command]
pub async fn browser_resize_surface<R: Runtime>(
    app: AppHandle<R>,
    session_id: Option<String>,
    bounds: BrowserBounds,
) -> Result<(), String> {
    let surfaces = if let Some(session_id) = session_id {
        get_surface(&app, &session_id).map(|surface| vec![surface])?
    } else {
        browser_surfaces(&app)
    };

    let x = bounds.x.max(0.0);
    let y = bounds.y.max(0.0);
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

#[tauri::command]
pub async fn browser_unmount_surface<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    hide_surfaces(&app)
}

#[tauri::command]
pub async fn browser_close_surface<R: Runtime>(
    app: AppHandle<R>,
    session_id: String,
) -> Result<(), String> {
    close_surface_if_present(&app, &session_id)
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
fn capture_surface_screenshot<R: Runtime>(surface: tauri::Webview<R>) -> Result<String, String> {
    use std::sync::mpsc;
    use std::time::Duration;
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

            let method = CoTaskMemPWSTR::from("Page.captureScreenshot");
            let params = CoTaskMemPWSTR::from(
                r#"{"format":"png","fromSurface":true,"captureBeyondViewport":false}"#,
            );

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

    let result_json = rx
        .recv_timeout(Duration::from_secs(8))
        .map_err(|_| "Timed out capturing native browser screenshot".to_string())??;

    let result: JsonValue = serde_json::from_str(&result_json).map_err(|e| e.to_string())?;
    let data = result
        .get("data")
        .and_then(JsonValue::as_str)
        .ok_or_else(|| "WebView2 screenshot response did not contain PNG data".to_string())?;

    Ok(format!("data:image/png;base64,{data}"))
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
) -> Result<(), String> {
    let surface = get_surface(&app, &session_id)?;
    let json = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
    let script = format!(
        "window.__EMTY_AGENT_BROWSER_BRIDGE__ && window.__EMTY_AGENT_BROWSER_BRIDGE__.dispatch({json});"
    );

    surface.eval(script).map_err(|e| e.to_string())
}
