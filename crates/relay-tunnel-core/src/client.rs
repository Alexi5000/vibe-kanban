use std::{convert::Infallible, net::SocketAddr};

use anyhow::Context as _;
use axum::body::Body;
use futures_util::StreamExt;
use http::StatusCode;
use hyper::{
    Request, Response, body::Incoming, client::conn::http1 as client_http1,
    server::conn::http1 as server_http1, service::service_fn, upgrade,
};
use hyper_util::rt::TokioIo;
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_util::sync::CancellationToken;
use tokio_yamux::Session;
use ws_bridge::tungstenite_ws_stream_io;

use crate::{tls::ws_connector, yamux_config};

pub struct RelayClientConfig {
    pub ws_url: String,
    pub bearer_token: String,
    pub tunnel_provenance: String,
    pub local_addr: SocketAddr,
    pub shutdown: CancellationToken,
}

/// Connects the relay client control channel and starts handling inbound streams.
///
/// Returns when shutdown is requested or when the control channel disconnects/errors.
pub async fn start_relay_client(config: RelayClientConfig) -> anyhow::Result<()> {
    let mut request = config
        .ws_url
        .clone()
        .into_client_request()
        .context("Failed to build WS request")?;

    request.headers_mut().insert(
        "Authorization",
        format!("Bearer {}", config.bearer_token)
            .parse()
            .context("Invalid auth header")?,
    );
    let (ws_stream, _response) =
        tokio_tungstenite::connect_async_tls_with_config(request, None, false, ws_connector())
            .await
            .context("Failed to connect relay control channel")?;

    let ws_io = tungstenite_ws_stream_io(ws_stream);
    let mut session = Session::new_client(ws_io, yamux_config());
    let mut control = session.control();

    tracing::debug!("Relay control channel connected");

    let shutdown = config.shutdown;
    let local_addr = config.local_addr;
    let tunnel_provenance = config.tunnel_provenance;

    loop {
        tokio::select! {
            _ = shutdown.cancelled() => {
                control.close().await;
                return Ok(());
            }
            inbound = session.next() => {
                let stream = inbound
                    .ok_or_else(|| anyhow::anyhow!("Relay control channel closed"))?
                    .map_err(|e| anyhow::anyhow!("Relay yamux session error: {e}"))?;

                let tunnel_provenance = tunnel_provenance.clone();
                tokio::spawn(async move {
                    if let Err(error) = handle_inbound_stream(stream, local_addr, tunnel_provenance).await {
                        tracing::warn!(?error, "Relay stream handling failed");
                    }
                });
            }
        }
    }
}

async fn handle_inbound_stream(
    stream: tokio_yamux::StreamHandle,
    local_addr: SocketAddr,
    tunnel_provenance: String,
) -> anyhow::Result<()> {
    let io = TokioIo::new(stream);

    server_http1::Builder::new()
        .serve_connection(
            io,
            service_fn(move |request: Request<Incoming>| {
                proxy_to_local(request, local_addr, tunnel_provenance.clone())
            }),
        )
        .with_upgrades()
        .await
        .context("Yamux stream server connection failed")
}

async fn proxy_to_local(
    mut request: Request<Incoming>,
    local_addr: SocketAddr,
    tunnel_provenance: String,
) -> Result<Response<Body>, Infallible> {
    set_tunnel_provenance(&mut request, &tunnel_provenance);
    request
        .headers_mut()
        .insert("x-vk-relayed", http::HeaderValue::from_static("1"));

    request.headers_mut().insert(
        http::header::HOST,
        http::HeaderValue::from_str(&local_addr.to_string())
            .expect("socket address is a valid authority"),
    );

    // TODO: fix dev servers
    let local_stream = match TcpStream::connect(local_addr).await {
        Ok(stream) => stream,
        Err(error) => {
            tracing::warn!(
                ?error,
                "Failed to connect to local server for relay request"
            );
            return Ok(simple_response(
                StatusCode::BAD_GATEWAY,
                "Failed to connect to local server",
            ));
        }
    };

    let (mut sender, connection) = match client_http1::Builder::new()
        .handshake(TokioIo::new(local_stream))
        .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::warn!(?error, "Failed to create local proxy HTTP connection");
            return Ok(simple_response(
                StatusCode::BAD_GATEWAY,
                "Failed to initialize local proxy connection",
            ));
        }
    };

    tokio::spawn(async move {
        if let Err(error) = connection.with_upgrades().await {
            tracing::debug!(?error, "Local proxy connection closed");
        }
    });

    let request_upgrade = upgrade::on(&mut request);

    let mut response = match sender.send_request(request).await {
        Ok(response) => response,
        Err(error) => {
            tracing::warn!(?error, "Local proxy request failed");
            return Ok(simple_response(
                StatusCode::BAD_GATEWAY,
                "Local proxy request failed",
            ));
        }
    };

    if response.status() == StatusCode::SWITCHING_PROTOCOLS {
        let response_upgrade = upgrade::on(&mut response);
        tokio::spawn(async move {
            let mut from_remote = TokioIo::new(request_upgrade.await?);
            let mut to_local = TokioIo::new(response_upgrade.await?);
            tokio::io::copy_bidirectional(&mut from_remote, &mut to_local).await?;
            Ok::<_, anyhow::Error>(())
        });
    }

    let (parts, body) = response.into_parts();
    Ok(Response::from_parts(parts, Body::new(body)))
}

fn simple_response(status: StatusCode, body: &'static str) -> Response<Body> {
    Response::builder()
        .status(status)
        .body(Body::from(body))
        .unwrap_or_else(|_| Response::new(Body::from(body)))
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;

    #[tokio::test]
    async fn forwarding_uses_local_host_and_preserves_signed_path_and_headers() {
        let backend = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let local_addr = backend.local_addr().unwrap();
        let backend_task = tokio::spawn(async move {
            let (stream, _) = backend.accept().await.unwrap();
            server_http1::Builder::new()
                .serve_connection(
                    TokioIo::new(stream),
                    service_fn(move |request: Request<Incoming>| async move {
                        assert_eq!(
                            request.headers()[http::header::HOST],
                            local_addr.to_string()
                        );
                        assert_eq!(request.headers()["x-vk-relayed"], "1");
                        assert_eq!(request.headers()["x-vk-sig-signature"], "dummy-signature");
                        assert_eq!(
                            request.uri().path_and_query().unwrap().as_str(),
                            "/api/health?test=1"
                        );
                        Ok::<_, Infallible>(simple_response(StatusCode::OK, "dummy response"))
                    }),
                )
                .await
                .unwrap();
        });
        let inbound = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let inbound_addr = inbound.local_addr().unwrap();
        let proxy_task = tokio::spawn(async move {
            let (stream, _) = inbound.accept().await.unwrap();
            server_http1::Builder::new()
                .serve_connection(
                    TokioIo::new(stream),
                    service_fn(move |request| {
                        proxy_to_local(request, local_addr, "dummy-local-token".into())
                    }),
                )
                .await
                .unwrap();
        });
        let stream = TcpStream::connect(inbound_addr).await.unwrap();
        let (mut sender, connection) = client_http1::Builder::new()
            .handshake(TokioIo::new(stream))
            .await
            .unwrap();
        let connection_task = tokio::spawn(connection);
        let request = Request::builder()
            .uri("/api/health?test=1")
            .header(http::header::HOST, "relay.example")
            .header("x-vk-relayed", "attacker-controlled")
            .header("x-vk-sig-signature", "dummy-signature")
            .body(Body::empty())
            .unwrap();
        let response = tokio::time::timeout(Duration::from_secs(5), sender.send_request(request))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        drop(response);
        drop(sender);
        connection_task.abort();
        proxy_task.abort();
        backend_task.abort();
    }
}

fn set_tunnel_provenance<B>(request: &mut Request<B>, token: &str) {
    request.headers_mut().remove("x-vk-tunnel-provenance");
    if matches!(
        request.uri().path(),
        "/api/webrtc/offer" | "/api/webrtc/candidate"
    ) && let Ok(value) = http::HeaderValue::from_str(token)
    {
        request
            .headers_mut()
            .insert("x-vk-tunnel-provenance", value);
    }
}

#[cfg(test)]
mod provenance_tests {
    use super::*;
    #[test]
    fn provenance_is_overwritten_only_for_signaling_and_never_leaked_to_other_routes() {
        for path in ["/api/webrtc/offer", "/api/webrtc/candidate"] {
            let mut request = Request::builder()
                .uri(path)
                .header("x-vk-tunnel-provenance", "forged")
                .body(())
                .unwrap();
            set_tunnel_provenance(&mut request, "local-dummy");
            assert_eq!(request.headers()["x-vk-tunnel-provenance"], "local-dummy");
        }
        for path in [
            "/api/preview/",
            "/api/webrtc/offer/",
            "/api/webrtc/%6ffer",
            "/echo",
        ] {
            let mut request = Request::builder()
                .uri(path)
                .header("x-vk-tunnel-provenance", "forged")
                .body(())
                .unwrap();
            set_tunnel_provenance(&mut request, "local-dummy");
            assert!(!request.headers().contains_key("x-vk-tunnel-provenance"));
        }
    }
}
