use std::{future::Future, pin::Pin, sync::Arc, time::Duration};

use tokio_util::sync::CancellationToken;
use uuid::Uuid;

pub type AccessTokenProvider =
    Arc<dyn Fn() -> Pin<Box<dyn Future<Output = Option<String>> + Send>> + Send + Sync>;

#[derive(Clone)]
pub struct PeerAuthority {
    client: reqwest::Client,
    url: reqwest::Url,
    token: AccessTokenProvider,
    binding: String,
}

impl PeerAuthority {
    pub fn new(
        base: &str,
        host: Uuid,
        session: Uuid,
        machine: &str,
        token: AccessTokenProvider,
    ) -> Option<Self> {
        let mut url = reqwest::Url::parse(&format!(
            "{}/v1/relay/authorize/{host}/{session}",
            base.trim_end_matches('/')
        ))
        .ok()?;
        if !matches!(url.scheme(), "http" | "https")
            || !url.username().is_empty()
            || url.password().is_some()
            || url.fragment().is_some()
            || url.query().is_some()
        {
            return None;
        }
        url.query_pairs_mut().append_pair("machine_id", machine);
        Some(Self {
            client: reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(Duration::from_secs(2))
                .build()
                .ok()?,
            url,
            token,
            binding: format!("{host}:{session}"),
        })
    }

    pub fn binding(&self) -> &str {
        &self.binding
    }

    pub async fn authorized(&self) -> bool {
        tokio::time::timeout(Duration::from_secs(2), async {
            let Some(token) = (self.token)().await else {
                return false;
            };
            self.client
                .get(self.url.clone())
                .bearer_auth(token)
                .send()
                .await
                .is_ok_and(|response| response.status() == reqwest::StatusCode::NO_CONTENT)
        })
        .await
        .unwrap_or(false)
    }

    pub async fn monitor(self, shutdown: CancellationToken) {
        loop {
            tokio::select! {
                _ = shutdown.cancelled() => return,
                _ = tokio::time::sleep(Duration::from_secs(1)) => {},
            }
            if !self.authorized().await {
                shutdown.cancel();
                return;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicBool, Ordering};

    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };

    use super::*;

    async fn mock_authority(
        status: Arc<AtomicBool>,
    ) -> (PeerAuthority, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let host = Uuid::new_v4();
        let session = Uuid::new_v4();
        let server = tokio::spawn(async move {
            loop {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut bytes = Vec::new();
                while !bytes.ends_with(b"\r\n\r\n") {
                    bytes.push(socket.read_u8().await.unwrap());
                }
                let request = String::from_utf8(bytes).unwrap();
                assert!(request.starts_with(&format!(
                    "GET /v1/relay/authorize/{host}/{session}?machine_id=test-machine HTTP/1.1"
                )));
                assert!(
                    request
                        .to_ascii_lowercase()
                        .contains("\r\nauthorization: bearer dummy-host-token\r\n")
                );
                let response = if status.load(Ordering::SeqCst) {
                    "204 No Content"
                } else {
                    "401 Unauthorized"
                };
                socket
                    .write_all(
                        format!(
                            "HTTP/1.1 {response}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                        )
                        .as_bytes(),
                    )
                    .await
                    .unwrap();
            }
        });
        let authority = PeerAuthority::new(
            &base,
            host,
            session,
            "test-machine",
            Arc::new(|| Box::pin(async { Some("dummy-host-token".into()) })),
        )
        .unwrap();
        (authority, server)
    }

    #[tokio::test]
    async fn revalidates_revocation_and_cancels_active_work_without_resurrection() {
        tokio::time::timeout(Duration::from_secs(5), async {
            let active = Arc::new(AtomicBool::new(true));
            let (authority, server) = mock_authority(active.clone()).await;
            assert!(authority.authorized().await);
            let shutdown = CancellationToken::new();
            let child = shutdown.child_token();
            let monitor = tokio::spawn(authority.clone().monitor(shutdown.clone()));
            active.store(false, Ordering::SeqCst);
            assert!(!authority.authorized().await);
            child.cancelled().await;
            monitor.await.unwrap();
            active.store(true, Ordering::SeqCst);
            assert!(shutdown.is_cancelled());
            assert!(child.is_cancelled());
            server.abort();
        })
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn missing_host_credentials_never_contact_authority() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let authority = PeerAuthority::new(
            &format!("http://{}", listener.local_addr().unwrap()),
            Uuid::new_v4(),
            Uuid::new_v4(),
            "machine",
            Arc::new(|| Box::pin(async { None })),
        )
        .unwrap();
        assert!(!authority.authorized().await);
        assert!(
            tokio::time::timeout(Duration::from_millis(30), listener.accept())
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn unavailable_authority_fails_closed() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        drop(listener);
        let authority = PeerAuthority::new(
            &base,
            Uuid::new_v4(),
            Uuid::new_v4(),
            "machine",
            Arc::new(|| Box::pin(async { Some("dummy".into()) })),
        )
        .unwrap();
        assert!(!authority.authorized().await);
    }
}
