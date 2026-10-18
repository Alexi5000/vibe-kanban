pub mod config;
pub mod handler;
pub mod sftp;

use std::sync::Arc;

use relay_control::signing::RelaySigningService;
use tokio::io::{AsyncRead, AsyncWrite};

/// Run an SSH server session over the given stream.
///
/// The stream is typically an axum WebSocket wrapped in `AxumWsStreamIo`.
/// Authentication checks the connecting client's Ed25519 public key against
/// active relay signing sessions.
pub async fn run_ssh_session(
    stream: impl AsyncRead + AsyncWrite + Unpin + Send + 'static,
    config: Arc<russh::server::Config>,
    relay_signing: RelaySigningService,
) -> anyhow::Result<()> {
    let handler = handler::SshSessionHandler::new(relay_signing);
    let session = russh::server::run_stream(config, stream, handler).await?;
    session.await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use ed25519_dalek::SigningKey;
    use russh::{
        ChannelMsg, client,
        keys::{PrivateKeyWithHashAlg, PublicKeyOrCertificate},
    };

    use super::*;

    struct TestClient;

    impl client::Handler for TestClient {
        type Error = russh::Error;

        async fn check_server_key(
            &mut self,
            _: &PublicKeyOrCertificate,
        ) -> Result<bool, Self::Error> {
            Ok(true)
        }
    }

    #[tokio::test]
    async fn authenticated_session_executes_and_rejects_external_forwarding() {
        tokio::time::timeout(std::time::Duration::from_secs(10), async {
            let server_key = SigningKey::from_bytes(&[7; 32]);
            let peer_key = SigningKey::from_bytes(&[8; 32]);
            let signing = RelaySigningService::new(server_key.clone());
            signing.create_session(peer_key.verifying_key()).await;
            let (client_stream, server_stream) = tokio::io::duplex(65536);
            let server = tokio::spawn(run_ssh_session(
                server_stream,
                config::build_config(&server_key),
                signing,
            ));
            let mut client = client::connect_stream(
                Arc::new(client::Config::default()),
                client_stream,
                TestClient,
            )
            .await
            .unwrap();
            let key = config::build_config(&peer_key).keys[0].clone();
            let auth = client
                .authenticate_publickey("peer", PrivateKeyWithHashAlg::new(Arc::new(key), None))
                .await
                .unwrap();
            assert!(auth.success());
            assert!(
                client
                    .channel_open_direct_tcpip("192.0.2.1", 80, "127.0.0.1", 12345)
                    .await
                    .is_err()
            );
            let mut channel = client.channel_open_session().await.unwrap();
            channel.exec(true, "printf ssh-migration-ok").await.unwrap();
            let mut output = Vec::new();
            let mut exit_status = None;
            while let Some(message) = channel.wait().await {
                match message {
                    ChannelMsg::Data { data } => output.extend_from_slice(&data),
                    ChannelMsg::ExitStatus { exit_status: code } => exit_status = Some(code),
                    _ => {}
                }
            }
            assert_eq!(output, b"ssh-migration-ok");
            assert_eq!(exit_status, Some(0));
            client
                .disconnect(russh::Disconnect::ByApplication, "test complete", "")
                .await
                .unwrap();
            server.await.unwrap().unwrap();
        })
        .await
        .expect("SSH session must complete without stalling");
    }
}
