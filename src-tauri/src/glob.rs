use globset::{Glob, GlobSet, GlobSetBuilder};
use ignore::{WalkBuilder, WalkState};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobResult {
    pub message: String,
    pub num_files: usize,
}

struct Entry {
    rel_path: String,
    is_dir: bool,
}

struct SharedEntries {
    entries: Mutex<Vec<Entry>>,
    count: AtomicUsize,
    overflow: AtomicBool,
}

fn worker_threads() -> usize {
    std::thread::available_parallelism()
        .map(|n| n.get().saturating_sub(1).clamp(1, 2))
        .unwrap_or(2)
}

fn claim_entry_slot(shared: &SharedEntries, limit: usize) -> bool {
    let mut current = shared.count.load(Ordering::Relaxed);

    loop {
        if current >= limit {
            shared.overflow.store(true, Ordering::Relaxed);
            return false;
        }

        match shared.count.compare_exchange_weak(
            current,
            current + 1,
            Ordering::Relaxed,
            Ordering::Relaxed,
        ) {
            Ok(_) => return true,
            Err(next) => current = next,
        }
    }
}

#[tauri::command]
pub async fn glob_search(
    base_path: String,
    pattern: String,
    limit: Option<usize>,
    dot: Option<bool>,
    no_gitignore: Option<bool>,
    ignore_patterns: Option<Vec<String>>,
) -> Result<GlobResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        glob_search_blocking(
            base_path,
            pattern,
            limit,
            dot,
            no_gitignore,
            ignore_patterns,
        )
    })
    .await
    .map_err(|e| format!("Error: glob worker failed: {e}"))?
}

fn glob_search_blocking(
    base_path: String,
    pattern: String,
    limit: Option<usize>,
    dot: Option<bool>,
    no_gitignore: Option<bool>,
    ignore_patterns: Option<Vec<String>>,
) -> Result<GlobResult, String> {
    let limit = limit.unwrap_or(200).min(1000);
    let show_hidden = dot.unwrap_or(false);
    let respect_gitignore = !no_gitignore.unwrap_or(false);

    let meta = std::fs::metadata(&base_path).map_err(|e| {
        format!("Error: base_path '{base_path}' does not exist or is not a directory: {e}")
    })?;
    if !meta.is_dir() {
        return Err(format!(
            "Error: base_path '{base_path}' does not exist or is not a directory."
        ));
    }
    let base_path_buf = Arc::new(PathBuf::from(&base_path));

    let glob_matcher = Glob::new(&pattern)
        .map_err(|e| format!("Error: Invalid glob pattern '{pattern}': {e}."))?
        .compile_matcher();
    let glob_matcher = Arc::new(glob_matcher);

    let ignore_set: Option<GlobSet> = if let Some(ref patterns) = ignore_patterns {
        if patterns.is_empty() {
            None
        } else {
            let mut builder = GlobSetBuilder::new();
            for p in patterns {
                let g = Glob::new(p)
                    .map_err(|e| format!("Error: Invalid ignore pattern '{p}': {e}."))?;
                builder.add(g);
            }
            Some(
                builder
                    .build()
                    .map_err(|e| format!("Error: compiling ignore patterns: {e}."))?,
            )
        }
    } else {
        None
    };
    let ignore_set = Arc::new(ignore_set);

    let mut walker_builder = WalkBuilder::new(&base_path);
    walker_builder
        .hidden(!show_hidden)
        .git_ignore(respect_gitignore)
        .git_exclude(respect_gitignore)
        .git_global(respect_gitignore)
        .threads(worker_threads());

    let shared = Arc::new(SharedEntries {
        entries: Mutex::new(Vec::with_capacity(limit)),
        count: AtomicUsize::new(0),
        overflow: AtomicBool::new(false),
    });

    walker_builder.build_parallel().run(|| {
        let base_path = Arc::clone(&base_path_buf);
        let glob_matcher = Arc::clone(&glob_matcher);
        let ignore_set = Arc::clone(&ignore_set);
        let shared = Arc::clone(&shared);

        Box::new(move |result| {
            if shared.overflow.load(Ordering::Relaxed) {
                return WalkState::Quit;
            }

            let entry = match result {
                Ok(e) => e,
                Err(_) => return WalkState::Continue,
            };

            let rel = match entry.path().strip_prefix(base_path.as_ref()) {
                Ok(r) => r,
                Err(_) => return WalkState::Continue,
            };

            let rel_str = rel.to_string_lossy();
            if rel_str.is_empty() {
                return WalkState::Continue;
            }
            let rel_normalized = rel_str.replace('\\', "/");

            if !glob_matcher.is_match(&rel_normalized) {
                return WalkState::Continue;
            }

            if let Some(ref ignore) = *ignore_set {
                if ignore.is_match(&rel_normalized) {
                    return WalkState::Continue;
                }
            }

            if !claim_entry_slot(&shared, limit) {
                return WalkState::Quit;
            }

            let is_dir = entry.file_type().map_or(false, |ft| ft.is_dir());
            if let Ok(mut entries) = shared.entries.lock() {
                entries.push(Entry {
                    rel_path: rel_normalized,
                    is_dir,
                });
            }

            WalkState::Continue
        })
    });

    let overflow = shared.overflow.load(Ordering::Relaxed);
    let mut entries = shared
        .entries
        .lock()
        .map_err(|_| "Error: glob results lock was poisoned.".to_string())?;

    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.rel_path.cmp(&b.rel_path),
    });

    let num_files = entries.len();

    if num_files == 0 && !overflow {
        return Ok(GlobResult {
            message: format!("No files matched pattern '{pattern}' in '{base_path}'."),
            num_files: 0,
        });
    }

    let mut message = format!("{num_files} files found.\n");
    for entry in &*entries {
        message.push_str(&entry.rel_path);
        message.push('\n');
    }

    if overflow {
        message.push_str(&format!(
            "\n({limit} results shown. Additional matches were found but omitted to protect context. Set a higher limit or refine your pattern to see them.)"
        ));
    }

    Ok(GlobResult { message, num_files })
}
