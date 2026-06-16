use serde::Serialize;
use urlencoding::encode;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResults {
    pub results: Vec<SearchResult>,
}

/// Extract real destination URL from DDG redirect `/l/?uddg=<encoded_url>&rut=...`.
fn extract_ddg_url(href: &str) -> String {
    if let Some(idx) = href.find("uddg=") {
        let encoded = &href[idx + 5..];
        let end = encoded.find('&').unwrap_or(encoded.len());
        if let Ok(decoded) = urlencoding::decode(&encoded[..end]) {
            return decoded.to_string();
        }
    }
    if href.starts_with("http") {
        return href.to_string();
    }
    String::new()
}

#[tauri::command]
pub async fn ddg_search(
    query: String,
    max_results: Option<usize>,
) -> Result<SearchResults, String> {
    let limit = max_results.unwrap_or(5).min(10);
    let url = format!("https://html.duckduckgo.com/html/?q={}", encode(&query));

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to reach DuckDuckGo: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("DuckDuckGo returned HTTP {}", resp.status()));
    }

    let html = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read DuckDuckGo response: {e}"))?;

    let document = scraper::Html::parse_document(&html);

    let title_selector =
        scraper::Selector::parse("a.result__a").map_err(|e| format!("Selector error: {e}"))?;
    let snippet_selector = scraper::Selector::parse("a.result__snippet")
        .map_err(|e| format!("Selector error: {e}"))?;

    let mut results: Vec<SearchResult> = Vec::new();

    for (i, title_el) in document.select(&title_selector).enumerate() {
        if results.len() >= limit {
            break;
        }

        let title: String = title_el.text().collect::<String>().trim().to_string();
        if title.is_empty() {
            continue;
        }

        let href = title_el.value().attr("href").unwrap_or("");
        let real_url = extract_ddg_url(href);

        // Skip ads and empty URLs
        if real_url.is_empty() || real_url.contains("duckduckgo.com/y.js") {
            continue;
        }

        let snippet: String = document
            .select(&snippet_selector)
            .nth(i)
            .map(|el| el.text().collect::<String>().trim().to_string())
            .unwrap_or_default();

        results.push(SearchResult {
            title,
            url: real_url,
            snippet,
        });
    }

    Ok(SearchResults { results })
}
