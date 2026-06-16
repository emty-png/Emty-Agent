use globset::{Glob, GlobSet, GlobSetBuilder};
use ignore::WalkBuilder;

// ---------------------------------------------------------------------------
// Response type
// ---------------------------------------------------------------------------

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobResult {
    pub message: String,
    pub num_files: usize,
}

// ---------------------------------------------------------------------------
// Internal: collected entry before sorting
// ---------------------------------------------------------------------------

struct Entry {
    rel_path: String,
    is_dir: bool,
}

// ---------------------------------------------------------------------------
// Tauri command
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn glob_search(
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

    // ── Validate base_path ──────────────────────────────────────────────
    let meta = std::fs::metadata(&base_path).map_err(|e| {
        format!("Error: base_path '{base_path}' does not exist or is not a directory: {e}")
    })?;
    if !meta.is_dir() {
        return Err(format!(
            "Error: base_path '{base_path}' does not exist or is not a directory."
        ));
    }

    // ── Compile glob pattern ────────────────────────────────────────────
    let glob_matcher = Glob::new(&pattern)
        .map_err(|e| format!("Error: Invalid glob pattern '{pattern}': {e}."))?
        .compile_matcher();

    // ── Compile custom ignore patterns ──────────────────────────────────
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

    // ── Walk and collect ────────────────────────────────────────────────
    let walker = WalkBuilder::new(&base_path)
        .hidden(!show_hidden)
        .git_ignore(respect_gitignore)
        .git_exclude(respect_gitignore)
        .git_global(respect_gitignore)
        .build();

    let mut entries: Vec<Entry> = Vec::new();
    let mut overflow: usize = 0;

    for result in walker {
        let entry = match result {
            Ok(e) => e,
            Err(_) => continue,
        };

        // Get relative path
        let rel = match entry.path().strip_prefix(&base_path) {
            Ok(r) => r,
            Err(_) => continue,
        };

        // Skip the root directory itself
        let rel_str = rel.to_string_lossy();
        if rel_str.is_empty() {
            continue;
        }

        // Normalize to forward slashes
        let rel_normalized = rel_str.replace('\\', "/");

        // Check glob pattern
        if !glob_matcher.is_match(&rel_normalized) {
            continue;
        }

        // Check custom ignore patterns
        if let Some(ref ignore) = ignore_set {
            if ignore.is_match(&rel_normalized) {
                continue;
            }
        }

        // Collect with overflow detection
        if entries.len() < limit {
            entries.push(Entry {
                rel_path: rel_normalized,
                is_dir: entry.file_type().map_or(false, |ft| ft.is_dir()),
            });
        } else {
            overflow += 1;
        }
    }

    // ── Sort: directories first, then alphabetical ──────────────────────
    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.rel_path.cmp(&b.rel_path),
    });

    let num_files = entries.len();

    // ── Format output ───────────────────────────────────────────────────
    if num_files == 0 && overflow == 0 {
        return Ok(GlobResult {
            message: format!("No files matched pattern '{pattern}' in '{base_path}'."),
            num_files: 0,
        });
    }

    let mut message = format!("{num_files} files found.\n");
    for entry in &entries {
        message.push_str(&entry.rel_path);
        message.push('\n');
    }

    if overflow > 0 {
        message.push_str(&format!(
            "\n({limit} results shown. Additional matches were found but omitted to protect context. Set a higher limit or refine your pattern to see them.)"
        ));
    }

    Ok(GlobResult { message, num_files })
}
