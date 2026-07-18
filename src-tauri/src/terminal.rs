use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    env,
    io::{Read, Write},
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    thread,
};
use tauri::{AppHandle, Emitter, State};

const TERMINAL_EVENT: &str = "terminal://event";

#[derive(Default)]
pub struct TerminalState {
    sessions: Mutex<HashMap<String, Arc<TerminalSession>>>,
}

struct TerminalSession {
    master: Mutex<Box<dyn portable_pty::MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    #[allow(dead_code)]
    process_id: Option<u32>,
    #[allow(dead_code)] // used on non-Windows via #[cfg(not(windows))]
    killer: Mutex<Box<dyn portable_pty::ChildKiller + Send + Sync>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalStartRequest {
    session_id: String,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalStartResponse {
    session_id: String,
    cwd: String,
    shell: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalInputRequest {
    session_id: String,
    data: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalResizeRequest {
    session_id: String,
    cols: u16,
    rows: u16,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCloseRequest {
    session_id: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(tag = "type", rename_all = "camelCase")]
enum TerminalEventPayload {
    Started {
        session_id: String,
        shell: String,
        cwd: String,
    },
    Output {
        session_id: String,
        data: String,
    },
    Exit {
        session_id: String,
        exit_code: i32,
        success: bool,
    },
    Error {
        session_id: String,
        message: String,
    },
}

// Guarantees Windows ConPTY starts up successfully by auto-responding
// to the initial startup coordinate query before it can block the shell.
fn strip_and_reply_to_terminal_queries(
    session: &Arc<TerminalSession>,
    _session_id: &str,
    data: String,
) -> String {
    if !data.contains("\u{1b}[6n") {
        return data;
    }

    let response = "\u{1b}[1;1R";
    match session.writer.lock() {
        Ok(mut writer) => {
            if writer.write_all(response.as_bytes()).is_err() {
                return data;
            }
            if writer.flush().is_err() {
                return data;
            }
        }
        Err(_) => {
            return data;
        }
    }

    data.replace("\u{1b}[6n", "")
}

fn emit_terminal_event(app: &AppHandle, payload: TerminalEventPayload) {
    let _ = app.emit(TERMINAL_EVENT, payload);
}

fn fallback_home_dir() -> Option<PathBuf> {
    env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("USERPROFILE").map(PathBuf::from))
}

fn resolve_cwd(raw: Option<&str>) -> PathBuf {
    let provided = raw
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from);

    let candidate = provided
        .filter(|path| path.is_dir())
        .or_else(|| env::current_dir().ok())
        .or_else(fallback_home_dir)
        .unwrap_or_else(|| PathBuf::from("."));

    candidate
}

fn normalize_size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        cols: cols.max(2),
        rows: rows.max(1),
        pixel_width: 0,
        pixel_height: 0,
    }
}

fn display_path(path: &Path) -> String {
    let raw = path.to_string_lossy().to_string();
    #[cfg(windows)]
    {
        raw.strip_prefix(r"\\?\").unwrap_or(&raw).to_string()
    }
    #[cfg(not(windows))]
    {
        raw
    }
}

fn shell_exists_on_path(name: &str) -> bool {
    env::var_os("PATH")
        .map(|paths| env::split_paths(&paths).any(|dir| dir.join(name).is_file()))
        .unwrap_or(false)
}

fn shell_label(program: &str) -> String {
    Path::new(program)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or(program)
        .to_string()
}

fn build_shell_command(cwd: &Path) -> (CommandBuilder, String) {
    #[cfg(windows)]
    let (mut command, label) = {
        // Prefer Windows PowerShell (`powershell.exe`) on Windows systems.
        // If it's not present, fall back to PowerShell Core (`pwsh`).
        let shell = if shell_exists_on_path("powershell.exe") || shell_exists_on_path("powershell")
        {
            "powershell.exe"
        } else if shell_exists_on_path("pwsh.exe") || shell_exists_on_path("pwsh") {
            "pwsh.exe"
        } else {
            // As a last resort, still request `powershell.exe` so the caller
            // knows we're expecting a PowerShell-family shell on Windows.
            "powershell.exe"
        };

        let mut builder = CommandBuilder::new(shell);
        // Use common PowerShell startup flags.
        builder.arg("-NoLogo");
        (builder, shell_label(shell))
    };

    #[cfg(not(windows))]
    let (mut command, label) = {
        let shell = env::var("SHELL")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| String::from("/bin/sh"));
        let label = shell_label(&shell);
        (CommandBuilder::new(shell), label)
    };

    command.cwd(cwd);
    (command, label)
}

#[tauri::command]
pub fn terminal_start(
    app: AppHandle,
    state: State<'_, TerminalState>,
    request: TerminalStartRequest,
) -> Result<TerminalStartResponse, String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| String::from("Terminal registry lock poisoned"))?;

    if sessions.contains_key(&request.session_id) {
        return Err(String::from("Terminal session already exists"));
    }

    let cwd = resolve_cwd(request.cwd.as_deref());
    let cwd_display = display_path(&cwd);
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(normalize_size(request.cols, request.rows))
        .map_err(|error| format!("Failed to create terminal: {error}"))?;

    let (mut command, shell) = build_shell_command(&cwd);
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    command.env("TERM_PROGRAM", "Emty Agent");

    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| format!("Failed to start shell: {error}"))?;
    let killer = child.clone_killer();
    let process_id = child.process_id();
    drop(pair.slave);

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| format!("Failed to open terminal reader: {error}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| format!("Failed to open terminal writer: {error}"))?;

    let session = Arc::new(TerminalSession {
        master: Mutex::new(pair.master),
        writer: Mutex::new(writer),
        process_id,
        killer: Mutex::new(killer),
    });

    sessions.insert(request.session_id.clone(), Arc::clone(&session));
    drop(sessions);

    let session_id = request.session_id.clone();
    let read_app = app.clone();
    let read_session = Arc::clone(&session);
    thread::spawn(move || {
        let mut output_reader = reader;
        let mut buffer = [0_u8; 8192];

        loop {
            match output_reader.read(&mut buffer) {
                Ok(0) => {
                    break;
                }
                Ok(count) => {
                    let data = String::from_utf8_lossy(&buffer[..count]).into_owned();
                    let data =
                        strip_and_reply_to_terminal_queries(&read_session, &session_id, data);
                    if data.is_empty() {
                        continue;
                    }

                    emit_terminal_event(
                        &read_app,
                        TerminalEventPayload::Output {
                            session_id: session_id.clone(),
                            data,
                        },
                    );
                }
                Err(error) => {
                    emit_terminal_event(
                        &read_app,
                        TerminalEventPayload::Error {
                            session_id: session_id.clone(),
                            message: format!("Terminal read failed: {error}"),
                        },
                    );
                    break;
                }
            }
        }
    });

    let wait_app = app.clone();
    let wait_session_id = request.session_id.clone();
    let mut child = child;
    thread::spawn(move || {
        let exit_result = child.wait().map_err(|error| error.to_string());

        match exit_result {
            Ok(status) => emit_terminal_event(
                &wait_app,
                TerminalEventPayload::Exit {
                    session_id: wait_session_id,
                    exit_code: status.exit_code() as i32,
                    success: status.success(),
                },
            ),
            Err(message) => emit_terminal_event(
                &wait_app,
                TerminalEventPayload::Error {
                    session_id: wait_session_id,
                    message,
                },
            ),
        }
    });

    emit_terminal_event(
        &app,
        TerminalEventPayload::Started {
            session_id: request.session_id.clone(),
            shell: shell.clone(),
            cwd: cwd_display.clone(),
        },
    );

    Ok(TerminalStartResponse {
        session_id: request.session_id,
        cwd: cwd_display,
        shell,
    })
}

#[tauri::command]
pub fn terminal_write(
    state: State<'_, TerminalState>,
    request: TerminalInputRequest,
) -> Result<(), String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| String::from("Terminal registry lock poisoned"))?;
    let session = sessions
        .get(&request.session_id)
        .cloned()
        .ok_or_else(|| String::from("Terminal session not found"))?;
    drop(sessions);

    let mut writer = session
        .writer
        .lock()
        .map_err(|_| String::from("Terminal writer lock poisoned"))?;
    writer
        .write_all(request.data.as_bytes())
        .map_err(|error| format!("Failed to write to terminal: {error}"))?;
    writer
        .flush()
        .map_err(|error| format!("Failed to flush terminal input: {error}"))?;

    Ok(())
}

#[tauri::command]
pub fn terminal_resize(
    state: State<'_, TerminalState>,
    request: TerminalResizeRequest,
) -> Result<(), String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| String::from("Terminal registry lock poisoned"))?;
    let session = sessions
        .get(&request.session_id)
        .cloned()
        .ok_or_else(|| String::from("Terminal session not found"))?;
    drop(sessions);

    let master = session
        .master
        .lock()
        .map_err(|_| String::from("Terminal master lock poisoned"))?;
    master
        .resize(normalize_size(request.cols, request.rows))
        .map_err(|error| format!("Failed to resize terminal: {error}"))?;

    Ok(())
}

#[tauri::command]
pub fn terminal_close(
    state: State<'_, TerminalState>,
    request: TerminalCloseRequest,
) -> Result<(), String> {
    let session = state
        .sessions
        .lock()
        .map_err(|_| String::from("Terminal registry lock poisoned"))?
        .remove(&request.session_id)
        .ok_or_else(|| String::from("Terminal session not found"))?;

    // On Windows, use taskkill to kill the entire process tree.
    // portable_pty's ChildKiller::kill() only terminates the immediate
    // child (the shell), leaving spawned grandchildren (npm, node, etc.) alive.
    #[cfg(windows)]
    {
        let pid = session.process_id;

        // Drop all locks before spawning taskkill to avoid deadlocks
        // with the reader/wait threads that hold Arc<Session> clones.
        drop(session);

        if let Some(pid) = pid {
            let _ = std::process::Command::new("taskkill")
                .args(["/PID", &pid.to_string(), "/T", "/F"])
                .creation_flags(0x08000000) // CREATE_NO_WINDOW
                .output();
        }
    }

    #[cfg(not(windows))]
    {
        let mut killer = session
            .killer
            .lock()
            .map_err(|_| String::from("Terminal killer lock poisoned"))?;
        killer
            .kill()
            .map_err(|error| format!("Failed to kill terminal process: {error}"))?;
    }

    Ok(())
}
