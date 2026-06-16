use grep_regex::RegexMatcherBuilder;
use grep_searcher::sinks::UTF8;
use grep_searcher::SearcherBuilder;
use ignore::WalkBuilder;

// ---------------------------------------------------------------------------
// Response type
// ---------------------------------------------------------------------------

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrepResult {
    pub message: String,
    pub num_matches: usize,
}

// ---------------------------------------------------------------------------
// Internal: collected match entry
// ---------------------------------------------------------------------------

struct MatchEntry {
    file: String,
    line: usize,
    text: String,
}

// ---------------------------------------------------------------------------
// Tauri command
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn grep_search(
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

    // If files_only, force context to 0
    let ctx = if show_files_only { 0 } else { ctx };

    // ── Validate base_path ──────────────────────────────────────────────
    let meta = std::fs::metadata(&base_path).map_err(|e| {
        format!("Error: base_path '{base_path}' does not exist or is not a directory: {e}")
    })?;
    if !meta.is_dir() {
        return Err(format!(
            "Error: base_path '{base_path}' does not exist or is not a directory."
        ));
    }

    // ── Build matcher ───────────────────────────────────────────────────
    let matcher = RegexMatcherBuilder::new()
        .fixed_strings(!use_regex)
        .case_insensitive(!is_case_sensitive)
        .multi_line(is_multiline)
        .dot_matches_new_line(is_multiline)
        .build(&pattern)
        .map_err(|e| format!("Error: Invalid pattern '{pattern}': {e}."))?;

    // ── Build walker ────────────────────────────────────────────────────
    let mut walker_builder = WalkBuilder::new(&base_path);
    walker_builder
        .hidden(true)
        .git_ignore(true)
        .git_exclude(true)
        .git_global(true);

    // Add glob filter if provided
    let glob_matcher = if let Some(ref g) = glob {
        Some(
            globset::Glob::new(g)
                .map_err(|e| format!("Error: Invalid glob pattern '{g}': {e}."))?
                .compile_matcher(),
        )
    } else {
        None
    };

    // ── Build searcher ──────────────────────────────────────────────────
    let mut searcher = SearcherBuilder::new()
        .line_number(true)
        .before_context(ctx)
        .after_context(ctx)
        .multi_line(is_multiline)
        .build();

    // ── Walk and search ─────────────────────────────────────────────────
    let mut matches: Vec<MatchEntry> = Vec::new();
    let mut unique_files: Vec<String> = Vec::new();
    let mut overflow = 0usize;

    for result in walker_builder.build() {
        let entry = match result {
            Ok(e) => e,
            Err(_) => continue,
        };

        // Only search files
        let file_type = match entry.file_type() {
            Some(ft) => ft,
            None => continue,
        };
        if !file_type.is_file() {
            continue;
        }

        // Get relative path
        let rel = match entry.path().strip_prefix(&base_path) {
            Ok(r) => r,
            Err(_) => continue,
        };
        let rel_str = rel.to_string_lossy().replace('\\', "/");

        // Apply glob filter
        if let Some(ref gm) = glob_matcher {
            if !gm.is_match(&rel_str) {
                continue;
            }
        }

        let abs_path = entry.path();

        // Stop walking once we've hit the limit (early exit)
        if show_files_only {
            if unique_files.len() >= limit {
                overflow = 1;
                break;
            }
        } else {
            if matches.len() >= limit {
                overflow = 1;
                break;
            }
        }

        // Search the file
        let file_path = rel_str.clone();
        let found_in_file = std::cell::Cell::new(false);

        let search_result = searcher.search_path(
            &matcher,
            abs_path,
            UTF8(|line_num, line_content| {
                if show_files_only {
                    if !found_in_file.get() {
                        found_in_file.set(true);
                        if unique_files.len() < limit && !unique_files.contains(&file_path) {
                            unique_files.push(file_path.clone());
                        }
                    }
                } else {
                    if matches.len() < limit {
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
            // Skip files that can't be read (binary, permission errors, etc.)
            continue;
        }
    }

    // ── Format output ───────────────────────────────────────────────────
    let num_matches = if show_files_only {
        unique_files.len()
    } else {
        matches.len()
    };

    if num_matches == 0 && overflow == 0 {
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

    // Header
    let pattern_display = if pattern.len() > 48 {
        format!("{}…", &pattern[..48])
    } else {
        pattern.clone()
    };

    let mut message = if show_files_only {
        format!("Found matches in {num_matches} files for '{pattern_display}':\n")
    } else {
        format!("Found matches for '{pattern_display}':\n")
    };

    if show_files_only {
        // files_only mode: flat list
        for path in &unique_files {
            message.push_str(path);
            message.push('\n');
        }
    } else {
        // Grouped mode: === filename === headers
        let mut last_file = String::new();
        for m in &matches {
            if m.file != last_file {
                if !last_file.is_empty() {
                    message.push('\n');
                }
                message.push_str(&format!("=== {} ===\n", m.file));
                last_file = m.file.clone();
            }
            message.push_str(&format!("{:>4} │ {}\n", m.line, m.text));
        }
    }

    // Truncation
    if overflow > 0 {
        message.push_str("---\n(Additional matches were found but omitted to protect context limits. Please make your query more specific or use the 'glob' parameter to narrow the search.)\n");
    }

    Ok(GrepResult {
        message,
        num_matches,
    })
}
