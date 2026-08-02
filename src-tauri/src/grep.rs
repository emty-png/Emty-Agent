use grep_regex::RegexMatcherBuilder;
use grep_searcher::sinks::UTF8;
use grep_searcher::SearcherBuilder;
use ignore::{WalkBuilder, WalkState};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrepResult {
    pub message: String,
    pub num_matches: usize,
}

struct MatchEntry {
    file: String,
    line: usize,
    text: String,
}

struct SharedResults {
    matches: Mutex<Vec<MatchEntry>>,
    unique_files: Mutex<Vec<String>>,
    count: AtomicUsize,
    overflow: AtomicBool,
}

fn claim_result_slot(shared: &SharedResults, limit: usize) -> bool {
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
pub async fn grep_search(
    base_path: String,
    pattern: String,
    regex: Option<bool>,
    glob: Option<String>,
    case_sensitive: Option<bool>,
    context_lines: Option<usize>,
    limit: Option<usize>,
    files_only: Option<bool>,
    multiline: Option<bool>,
) -> Result<GrepResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        grep_search_blocking(
            base_path,
            pattern,
            regex,
            glob,
            case_sensitive,
            context_lines,
            limit,
            files_only,
            multiline,
        )
    })
    .await
    .map_err(|e| format!("Error: grep worker failed: {e}"))?
}

fn worker_threads() -> usize {
    std::thread::available_parallelism()
        .map(|n| n.get().saturating_sub(1).clamp(1, 2))
        .unwrap_or(2)
}

fn grep_search_blocking(
    base_path: String,
    pattern: String,
    regex: Option<bool>,
    glob: Option<String>,
    case_sensitive: Option<bool>,
    context_lines: Option<usize>,
    limit: Option<usize>,
    files_only: Option<bool>,
    multiline: Option<bool>,
) -> Result<GrepResult, String> {
    let use_regex = regex.unwrap_or(false);
    let is_case_sensitive = case_sensitive.unwrap_or(true);
    let ctx = context_lines.unwrap_or(1).min(5);
    let limit = limit.unwrap_or(100).min(300);
    let show_files_only = files_only.unwrap_or(false);
    let is_multiline = multiline.unwrap_or(false);
    let ctx = if show_files_only { 0 } else { ctx };

    let meta = std::fs::metadata(&base_path).map_err(|e| {
        format!("Error: base_path '{base_path}' does not exist or is not a directory: {e}")
    })?;
    if !meta.is_dir() {
        return Err(format!(
            "Error: base_path '{base_path}' does not exist or is not a directory."
        ));
    }
    let base_path_buf = Arc::new(PathBuf::from(&base_path));

    let matcher = RegexMatcherBuilder::new()
        .fixed_strings(!use_regex)
        .case_insensitive(!is_case_sensitive)
        .multi_line(is_multiline)
        .dot_matches_new_line(is_multiline)
        .build(&pattern)
        .map_err(|e| format!("Error: Invalid pattern '{pattern}': {e}."))?;
    let matcher = Arc::new(matcher);

    let mut walker_builder = WalkBuilder::new(&base_path);
    walker_builder
        .hidden(true)
        .git_ignore(true)
        .git_exclude(true)
        .git_global(true)
        .threads(worker_threads());

    let glob_matcher = if let Some(ref g) = glob {
        Some(
            globset::Glob::new(g)
                .map_err(|e| format!("Error: Invalid glob pattern '{g}': {e}."))?
                .compile_matcher(),
        )
    } else {
        None
    };
    let glob_matcher = Arc::new(glob_matcher);

    let shared = Arc::new(SharedResults {
        matches: Mutex::new(Vec::with_capacity(limit)),
        unique_files: Mutex::new(Vec::with_capacity(limit)),
        count: AtomicUsize::new(0),
        overflow: AtomicBool::new(false),
    });

    walker_builder.build_parallel().run(|| {
        let base_path = Arc::clone(&base_path_buf);
        let glob_matcher = Arc::clone(&glob_matcher);
        let matcher = Arc::clone(&matcher);
        let shared = Arc::clone(&shared);
        let mut searcher = SearcherBuilder::new()
            .line_number(true)
            .before_context(ctx)
            .after_context(ctx)
            .multi_line(is_multiline)
            .build();

        Box::new(move |result| {
            if shared.overflow.load(Ordering::Relaxed) {
                return WalkState::Quit;
            }

            let entry = match result {
                Ok(e) => e,
                Err(_) => return WalkState::Continue,
            };

            let Some(file_type) = entry.file_type() else {
                return WalkState::Continue;
            };
            if !file_type.is_file() {
                return WalkState::Continue;
            }

            let rel = match entry.path().strip_prefix(base_path.as_ref()) {
                Ok(r) => r,
                Err(_) => return WalkState::Continue,
            };
            let rel_str = rel.to_string_lossy().replace('\\', "/");

            if let Some(ref gm) = *glob_matcher {
                if !gm.is_match(&rel_str) {
                    return WalkState::Continue;
                }
            }

            let file_path = rel_str;
            let abs_path = entry.path().to_path_buf();
            let mut found_in_file = false;

            let search_result = searcher.search_path(
                matcher.as_ref(),
                &abs_path,
                UTF8(|line_num, line_content| {
                    if shared.overflow.load(Ordering::Relaxed) {
                        return Ok(false);
                    }

                    if show_files_only {
                        if !found_in_file {
                            found_in_file = true;
                            if !claim_result_slot(&shared, limit) {
                                return Ok(false);
                            }
                            if let Ok(mut files) = shared.unique_files.lock() {
                                files.push(file_path.clone());
                            }
                        }
                    } else {
                        if !claim_result_slot(&shared, limit) {
                            return Ok(false);
                        }
                        if let Ok(mut matches) = shared.matches.lock() {
                            matches.push(MatchEntry {
                                file: file_path.clone(),
                                line: line_num as usize,
                                text: line_content.trim_end().to_string(),
                            });
                        }
                    }

                    Ok(true)
                }),
            );

            if search_result.is_err() {
                return WalkState::Continue;
            }

            if shared.overflow.load(Ordering::Relaxed) {
                WalkState::Quit
            } else {
                WalkState::Continue
            }
        })
    });

    let overflow = shared.overflow.load(Ordering::Relaxed);
    let mut matches = shared
        .matches
        .lock()
        .map_err(|_| "Error: grep results lock was poisoned.".to_string())?;
    let mut unique_files = shared
        .unique_files
        .lock()
        .map_err(|_| "Error: grep results lock was poisoned.".to_string())?;

    if show_files_only {
        unique_files.sort();
    } else {
        matches.sort_by(|a, b| a.file.cmp(&b.file).then(a.line.cmp(&b.line)));
    }

    let num_matches = shared.count.load(Ordering::Relaxed);

    if num_matches == 0 && !overflow {
        let glob_note = if let Some(ref g) = glob {
            format!(" matching glob '{g}'")
        } else {
            String::new()
        };
        return Ok(GrepResult {
            message: format!("No matches found for '{pattern}'.{glob_note}"),
            num_matches: 0,
        });
    }

    let pattern_display = if pattern.len() > 48 {
        format!("{}...", &pattern[..48])
    } else {
        pattern.clone()
    };

    let mut message = if show_files_only {
        format!("Found matches in {num_matches} files for '{pattern_display}':\n")
    } else {
        format!("Found matches for '{pattern_display}':\n")
    };

    if show_files_only {
        for path in &*unique_files {
            message.push_str(path);
            message.push('\n');
        }
    } else {
        let mut last_file = String::new();
        for m in &*matches {
            if m.file != last_file {
                if !last_file.is_empty() {
                    message.push('\n');
                }
                message.push_str(&format!("=== {} ===\n", m.file));
                last_file = m.file.clone();
            }
            message.push_str(&format!("{:>4} | {}\n", m.line, m.text));
        }
    }

    if overflow {
        message.push_str("---\n(Additional matches were found but omitted to protect context limits. Please make your query more specific or use the 'glob' parameter to narrow the search.)\n");
    }

    Ok(GrepResult {
        message,
        num_matches,
    })
}
