use std::{
    collections::hash_map::DefaultHasher,
    hash::{Hash, Hasher},
    time::Duration,
};

use os_info;
use serde_json::{Value, json};

#[derive(Debug, Clone)]
pub struct AnalyticsContext {
    pub user_id: String,
    pub analytics_service: AnalyticsService,
}

#[derive(Debug, Clone)]
pub struct AnalyticsConfig {
    pub posthog_api_key: String,
    pub posthog_api_endpoint: String,
}

impl AnalyticsConfig {
    pub fn new() -> Option<Self> {
        let api_key = option_env!("POSTHOG_API_KEY")
            .map(|s| s.to_string())
            .or_else(|| std::env::var("POSTHOG_API_KEY").ok())
            .or_else(cargo_run_posthog_key)?;
        let api_endpoint = option_env!("POSTHOG_API_ENDPOINT")
            .map(|s| s.to_string())
            .or_else(|| std::env::var("POSTHOG_API_ENDPOINT").ok())?;

        Some(Self {
            posthog_api_key: api_key,
            posthog_api_endpoint: api_endpoint,
        })
    }
}

fn cargo_run_posthog_key() -> Option<String> {
    let manifest = std::env::var_os("CARGO_MANIFEST_DIR")?;
    posthog_key_from_dotenv(std::path::Path::new(&manifest).join("../../.env"))
}

fn posthog_key_from_dotenv(path: impl AsRef<std::path::Path>) -> Option<String> {
    dotenvy::from_path_iter(path).ok()?.find_map(|entry| {
        let (key, value) = entry.ok()?;
        (key == "POSTHOG_API_KEY").then_some(value)
    })
}

#[derive(Clone, Debug)]
pub struct AnalyticsService {
    config: AnalyticsConfig,
    client: reqwest::Client,
}

impl AnalyticsService {
    pub fn new(config: AnalyticsConfig) -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .unwrap();

        Self { config, client }
    }

    pub fn track_event(&self, user_id: &str, event_name: &str, properties: Option<Value>) {
        let endpoint = format!(
            "{}/capture/",
            self.config.posthog_api_endpoint.trim_end_matches('/')
        );

        let mut payload = json!({
            "api_key": self.config.posthog_api_key,
            "event": event_name,
            "distinct_id": user_id,
        });
        if event_name == "$identify" {
            // For $identify, set person properties in $set
            if let Some(props) = properties {
                payload["$set"] = props;
            }
        } else {
            // For other events, use properties as before
            let mut event_properties = properties.unwrap_or_else(|| json!({}));
            if let Some(props) = event_properties.as_object_mut() {
                props.insert(
                    "timestamp".to_string(),
                    json!(chrono::Utc::now().to_rfc3339()),
                );
                props.insert("version".to_string(), json!(env!("CARGO_PKG_VERSION")));
                props.insert("device".to_string(), get_device_info());
                props.insert("source".to_string(), json!("backend"));
            }
            payload["properties"] = event_properties;
        }

        let client = self.client.clone();
        let event_name = event_name.to_string();

        tokio::spawn(async move {
            match client
                .post(&endpoint)
                .header("Content-Type", "application/json")
                .json(&payload)
                .send()
                .await
            {
                Ok(response) => {
                    if response.status().is_success() {
                        tracing::debug!("Event '{}' sent successfully", event_name);
                    } else {
                        let status = response.status();
                        let response_text = response.text().await.unwrap_or_default();
                        tracing::error!(
                            "Failed to send event. Status: {}. Response: {}",
                            status,
                            response_text
                        );
                    }
                }
                Err(e) => {
                    tracing::error!("Error sending event '{}': {}", event_name, e);
                }
            }
        });
    }
}

/// Generates a consistent, anonymous user ID for npm package telemetry.
/// Returns a hex string prefixed with "npm_user_"
pub fn generate_user_id() -> String {
    let mut hasher = DefaultHasher::new();

    #[cfg(target_os = "macos")]
    {
        // Use ioreg to get hardware UUID
        if let Ok(output) = std::process::Command::new("ioreg")
            .args(["-rd1", "-c", "IOPlatformExpertDevice"])
            .output()
        {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if let Some(line) = stdout.lines().find(|l| l.contains("IOPlatformUUID")) {
                line.hash(&mut hasher);
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        if let Ok(machine_id) = std::fs::read_to_string("/etc/machine-id") {
            machine_id.trim().hash(&mut hasher);
        }
    }

    #[cfg(target_os = "windows")]
    {
        use utils::command_ext::NoWindowExt;
        // Use PowerShell to get machine GUID from registry
        if let Ok(output) = std::process::Command::new("powershell")
            .args(&[
                "-NoProfile",
                "-Command",
                "(Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Cryptography').MachineGuid",
            ])
            .no_window()
            .output()
        {
            if output.status.success() {
                output.stdout.hash(&mut hasher);
            }
        }
    }

    // Add username for per-user differentiation
    if let Ok(user) = std::env::var("USER").or_else(|_| std::env::var("USERNAME")) {
        user.hash(&mut hasher);
    }

    // Add home directory for additional entropy
    if let Ok(home) = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")) {
        home.hash(&mut hasher);
    }

    format!("npm_user_{:016x}", hasher.finish())
}

fn get_device_info() -> Value {
    let info = os_info::get();

    json!({
        "os_type": info.os_type().to_string(),
        "os_version": info.version().to_string(),
        "architecture": info.architecture().unwrap_or("unknown").to_string(),
        "bitness": info.bitness().to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dotenv_key_preserves_quoted_values_without_exporting_other_variables() {
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join(".env");
        std::fs::write(
            &file,
            "UNRELATED_SYNTHETIC_ANALYTICS_KEY=ignored\nPOSTHOG_API_KEY='quoted synthetic value'\n",
        )
        .unwrap();
        assert_eq!(
            posthog_key_from_dotenv(&file).as_deref(),
            Some("quoted synthetic value")
        );
        assert!(std::env::var_os("UNRELATED_SYNTHETIC_ANALYTICS_KEY").is_none());
        assert!(posthog_key_from_dotenv(directory.path().join("missing")).is_none());
    }

    #[test]
    fn test_generate_user_id_format() {
        let id = generate_user_id();
        assert!(id.starts_with("npm_user_"));
        assert_eq!(id.len(), 25);
    }

    #[test]
    fn test_consistency() {
        let id1 = generate_user_id();
        let id2 = generate_user_id();
        assert_eq!(id1, id2, "ID should be consistent across calls");
    }
}
