use std::{collections::HashMap, net::SocketAddr, sync::Arc, time::Duration};

use bytes::Bytes;
use tokio::sync::{Mutex, mpsc};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;
use webrtc::{
    data_channel::{RTCDataChannel, data_channel_message::DataChannelMessage as RtcDcMessage},
    ice_transport::{
        ice_connection_state::RTCIceConnectionState, ice_gatherer_state::RTCIceGathererState,
        ice_server::RTCIceServer,
    },
    peer_connection::{
        RTCPeerConnection, configuration::RTCConfiguration,
        sdp::session_description::RTCSessionDescription,
    },
};
use ws_bridge::{bridge_tungstenite_ws, connect_upstream_ws};

use crate::{
    WebRtcError,
    authority::PeerAuthority,
    fragment,
    proxy::{
        DataChannelMessage, DataChannelRequest, DataChannelResponse, DataChannelWsStream, WsError,
        WsFrame, WsOpen, WsOpened,
    },
};

/// Handle for communicating with a running peer task.
pub struct PeerHandle {
    /// The peer connection, used for trickle ICE.
    pub peer_connection: Arc<RTCPeerConnection>,
    /// Cancellation token to shut down the peer.
    pub shutdown: CancellationToken,
}

/// Configuration for creating a new peer connection.
pub struct PeerConfig {
    pub authority: PeerAuthority,
    /// Address of the local backend to proxy requests to.
    pub local_backend_addr: SocketAddr,
    /// Cancellation token for graceful shutdown.
    pub shutdown: CancellationToken,
}

/// Accept an SDP offer and return the answer SDP along with the peer connection.
///
/// Creates a new RTCPeerConnection with a STUN server, accepts the offer,
/// waits for ICE gathering to complete, and returns the answer with
/// candidates embedded in the SDP.
pub async fn accept_offer(
    offer_sdp: &str,
) -> Result<(String, Arc<RTCPeerConnection>), WebRtcError> {
    let api = crate::build_api();

    let config = RTCConfiguration {
        ice_servers: vec![RTCIceServer {
            urls: vec!["stun:stun.l.google.com:19302".to_string()],
            ..Default::default()
        }],
        ..Default::default()
    };

    let peer_connection = Arc::new(api.new_peer_connection(config).await?);

    // Wait for ICE gathering to complete before returning the answer so
    // that candidates are embedded in the SDP.
    let (gather_done_tx, gather_done_rx) = tokio::sync::oneshot::channel::<()>();
    let gather_done_tx = Arc::new(std::sync::Mutex::new(Some(gather_done_tx)));
    peer_connection.on_ice_gathering_state_change(Box::new(move |state| {
        let tx = gather_done_tx.clone();
        Box::pin(async move {
            if state == RTCIceGathererState::Complete
                && let Some(sender) = tx.lock().unwrap().take()
            {
                let _ = sender.send(());
            }
        })
    }));

    let offer = RTCSessionDescription::offer(offer_sdp.to_string())?;
    peer_connection.set_remote_description(offer).await?;

    let answer = peer_connection.create_answer(None).await?;
    peer_connection.set_local_description(answer).await?;

    // Wait for ICE gathering with a timeout.
    tokio::time::timeout(Duration::from_secs(5), gather_done_rx)
        .await
        .map_err(|_| WebRtcError::IceGatheringTimedOut)?
        .map_err(|_| WebRtcError::IceGatheringChannelDropped)?;

    let answer_sdp = peer_connection
        .local_description()
        .await
        .ok_or(WebRtcError::NoLocalDescription)?
        .sdp;

    Ok((answer_sdp, peer_connection))
}

/// Run the server-side peer.
///
/// Registers callbacks on the peer connection to handle incoming data channel
/// messages. HTTP requests are proxied to the local backend; WebSocket
/// connections are bridged. Runs until the shutdown token is cancelled or
/// the ICE connection disconnects.
pub async fn run_peer(
    peer_connection: Arc<RTCPeerConnection>,
    config: PeerConfig,
) -> Result<(), WebRtcError> {
    let http_client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .expect("HTTP client configuration");

    // Channel for the data channel writer task.
    let (dc_send_tx, dc_send_rx) = mpsc::channel::<Vec<u8>>(64);

    // Signal when the data channel opens so the writer task can start.
    let (dc_ready_tx, dc_ready_rx) = tokio::sync::oneshot::channel::<Arc<RTCDataChannel>>();
    let dc_ready_tx = Arc::new(std::sync::Mutex::new(Some(dc_ready_tx)));

    // Active WebSocket connections: conn_id → sender for frames from the client.
    let ws_connections: Arc<Mutex<HashMap<Uuid, mpsc::Sender<WsFrame>>>> =
        Arc::new(Mutex::new(HashMap::new()));

    // Detect ICE disconnection.
    let disconnect_token = config.shutdown.child_token();
    let disconnect_cancel = disconnect_token.clone();
    peer_connection.on_ice_connection_state_change(Box::new(move |state| {
        let cancel = disconnect_cancel.clone();
        Box::pin(async move {
            tracing::debug!(?state, "[server-peer] ICE connection state changed");
            if state == RTCIceConnectionState::Disconnected
                || state == RTCIceConnectionState::Failed
                || state == RTCIceConnectionState::Closed
            {
                cancel.cancel();
            }
        })
    }));

    tokio::spawn(config.authority.clone().monitor(disconnect_token.clone()));
    let authority = config.authority.clone();
    let dispatch_shutdown = disconnect_token.clone();

    // Handle incoming data channel from the client.
    let dc_send_tx_clone = dc_send_tx.clone();
    let ws_conns = ws_connections.clone();
    let local_backend_addr = config.local_backend_addr;
    let http_client_clone = http_client.clone();

    peer_connection.on_data_channel(Box::new(move |dc: Arc<RTCDataChannel>| {
        let dc_send_tx = dc_send_tx_clone.clone();
        let ws_conns = ws_conns.clone();
        let local_backend_addr = local_backend_addr;
        let http_client = http_client_clone.clone();
        let dc_ready_tx = dc_ready_tx.clone();
        let authority = authority.clone();
        let dispatch_shutdown = dispatch_shutdown.clone();

        Box::pin(async move {
            tracing::debug!(label = dc.label(), "[server-peer] data channel opened");

            // Signal the writer task that the DC is ready.
            if let Some(tx) = dc_ready_tx.lock().unwrap().take() {
                let _ = tx.send(dc.clone());
            }

            // Incoming message handler.
            let (incoming_tx, mut incoming_rx) = mpsc::channel::<Vec<u8>>(64);
            let defrag = Arc::new(std::sync::Mutex::new(fragment::Defragmenter::new()));

            dc.on_message(Box::new(move |msg: RtcDcMessage| {
                let tx = incoming_tx.clone();
                let defrag = defrag.clone();
                Box::pin(async move {
                    let complete = {
                        let mut d = defrag.lock().unwrap();
                        d.process(&msg.data)
                    };
                    if let Some(bytes) = complete {
                        let _ = tx.send(bytes).await;
                    }
                })
            }));

            // Message dispatch task.
            tokio::spawn(async move {
                loop {
                    let raw = tokio::select! {
                        _ = dispatch_shutdown.cancelled() => break,
                        raw = incoming_rx.recv() => match raw { Some(raw) => raw, None => break },
                    };
                    if !authority.authorized().await {
                        dispatch_shutdown.cancel();
                        break;
                    }
                    if dispatch_shutdown.is_cancelled() {
                        break;
                    }
                    let message: DataChannelMessage = match serde_json::from_slice(&raw) {
                        Ok(msg) => msg,
                        Err(e) => {
                            tracing::warn!(?e, "Invalid data channel message");
                            continue;
                        }
                    };

                    match message {
                        DataChannelMessage::HttpRequest(request) => {
                            tracing::trace!(
                                id = %request.id,
                                method = %request.method,
                                path = %request.path,
                                "[server-peer] received HTTP request"
                            );
                            let client = http_client.clone();
                            let addr = local_backend_addr;
                            let tx = dc_send_tx.clone();
                            let shutdown = dispatch_shutdown.clone();
                            tokio::spawn(async move {
                                let Some(response) = proxy_request_until_cancelled(
                                    &client, addr, request, &shutdown,
                                )
                                .await
                                else {
                                    return;
                                };
                                tracing::trace!(
                                    id = %response.id,
                                    status = response.status,
                                    body_len = response
                                        .body_b64
                                        .as_ref()
                                        .map(|b| b.len())
                                        .unwrap_or(0),
                                    "[server-peer] sending HTTP response"
                                );
                                let msg = DataChannelMessage::HttpResponse(response);
                                if let Ok(json) = serde_json::to_vec(&msg) {
                                    let _ = tx.send(json).await;
                                }
                            });
                        }

                        DataChannelMessage::WsOpen(ws_open) => {
                            handle_ws_open(
                                ws_open,
                                local_backend_addr,
                                &dc_send_tx,
                                &ws_conns,
                                dispatch_shutdown.clone(),
                            )
                            .await;
                        }

                        DataChannelMessage::WsFrame(frame) => {
                            let conn_id = frame.conn_id;
                            let tx = {
                                let conns = ws_conns.lock().await;
                                conns.get(&conn_id).cloned()
                            };

                            if let Some(tx) = tx
                                && tx.send(frame).await.is_err()
                            {
                                ws_conns.lock().await.remove(&conn_id);
                            }
                        }

                        DataChannelMessage::WsClose(close) => {
                            ws_conns.lock().await.remove(&close.conn_id);
                        }

                        // Client shouldn't send these; ignore.
                        DataChannelMessage::HttpResponse(_)
                        | DataChannelMessage::WsOpened(_)
                        | DataChannelMessage::WsError(_) => {}
                    }
                }
            });
        })
    }));

    // Writer task: drains dc_send_rx, fragments, and writes to the data channel.
    let writer_shutdown = disconnect_token.clone();
    tokio::spawn(async move {
        let dc = tokio::select! {
            result = dc_ready_rx => match result {
                Ok(dc) => dc,
                Err(_) => return,
            },
            _ = writer_shutdown.cancelled() => return,
        };
        let mut dc_send_rx = dc_send_rx;
        loop {
            tokio::select! {
                Some(msg_json) = dc_send_rx.recv() => {
                    tracing::trace!(
                        bytes = msg_json.len(),
                        "[server-peer] writing to data channel"
                    );
                    let chunks = fragment::fragment(msg_json);
                    for chunk in chunks {
                        if let Err(e) = dc.send(&Bytes::from(chunk)).await {
                            tracing::warn!(?e, "Failed to send on data channel");
                            break;
                        }
                    }
                }
                _ = writer_shutdown.cancelled() => break,
            }
        }
    });

    // Wait for shutdown or disconnection.
    disconnect_token.cancelled().await;
    let _ = peer_connection.close().await;
    tracing::debug!("[server-peer] peer connection closed");
    Ok(())
}

// ---------------------------------------------------------------------------
// HTTP proxy
// ---------------------------------------------------------------------------

async fn proxy_request_until_cancelled(
    client: &reqwest::Client,
    addr: SocketAddr,
    request: DataChannelRequest,
    shutdown: &CancellationToken,
) -> Option<DataChannelResponse> {
    tokio::select! {
        biased;
        _ = shutdown.cancelled() => None,
        response = proxy_request(client, addr, request) => Some(response),
    }
}

async fn proxy_request(
    http_client: &reqwest::Client,
    local_backend_addr: SocketAddr,
    request: DataChannelRequest,
) -> DataChannelResponse {
    if !valid_local_path(&request.path) {
        return DataChannelResponse {
            id: request.id,
            status: 400,
            headers: Default::default(),
            body_b64: None,
        };
    }
    let url = format!("http://{}{}", local_backend_addr, request.path);

    let method = match request.method.to_uppercase().as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        "PUT" => reqwest::Method::PUT,
        "DELETE" => reqwest::Method::DELETE,
        "PATCH" => reqwest::Method::PATCH,
        "HEAD" => reqwest::Method::HEAD,
        "OPTIONS" => reqwest::Method::OPTIONS,
        other => {
            tracing::warn!(%other, "Unsupported HTTP method");
            return DataChannelResponse {
                id: request.id,
                status: 405,
                headers: Default::default(),
                body_b64: None,
            };
        }
    };

    let mut req_builder = http_client.request(method, &url);

    for (key, values) in &request.headers {
        let k = key.to_ascii_lowercase();
        if matches!(
            k.as_str(),
            "origin"
                | "host"
                | "x-vk-relayed"
                | "x-vk-relay-host"
                | "x-vk-relay-browser-session"
                | "x-vk-tunnel-provenance"
        ) {
            continue;
        }
        for value in values {
            req_builder = req_builder.header(key.as_str(), value.as_str());
        }
    }

    if let Some(body_b64) = &request.body_b64 {
        use base64::Engine as _;
        match base64::engine::general_purpose::STANDARD.decode(body_b64) {
            Ok(body) => {
                req_builder = req_builder.body(body);
            }
            Err(e) => {
                tracing::warn!(?e, "Invalid base64 body in data channel request");
                return DataChannelResponse {
                    id: request.id,
                    status: 400,
                    headers: Default::default(),
                    body_b64: None,
                };
            }
        }
    }

    match req_builder.send().await {
        Ok(response) => {
            let status = response.status().as_u16();
            let mut headers: std::collections::HashMap<String, Vec<String>> =
                std::collections::HashMap::new();
            for (key, value) in response.headers() {
                if let Ok(v) = value.to_str() {
                    headers
                        .entry(key.to_string())
                        .or_default()
                        .push(v.to_string());
                }
            }

            let body_b64 = match response.bytes().await {
                Ok(bytes) if !bytes.is_empty() => {
                    use base64::Engine as _;
                    Some(base64::engine::general_purpose::STANDARD.encode(&bytes))
                }
                _ => None,
            };

            DataChannelResponse {
                id: request.id,
                status,
                headers,
                body_b64,
            }
        }
        Err(e) => {
            tracing::warn!(?e, %url, "Failed to proxy request to local backend");
            DataChannelResponse {
                id: request.id,
                status: 502,
                headers: Default::default(),
                body_b64: None,
            }
        }
    }
}

// ---------------------------------------------------------------------------
// WebSocket proxy
// ---------------------------------------------------------------------------

async fn handle_ws_open(
    ws_open: WsOpen,
    local_backend_addr: SocketAddr,
    dc_send_tx: &mpsc::Sender<Vec<u8>>,
    ws_connections: &Arc<Mutex<HashMap<Uuid, mpsc::Sender<WsFrame>>>>,
    shutdown: CancellationToken,
) {
    let conn_id = ws_open.conn_id;
    let (frame_tx, frame_rx) = mpsc::channel::<WsFrame>(32);
    ws_connections.lock().await.insert(conn_id, frame_tx);

    let addr = local_backend_addr;
    let dc_tx = dc_send_tx.clone();
    let ws_connections = ws_connections.clone();

    tokio::spawn(async move {
        let bridge_result = tokio::select! {
            biased;
            _ = shutdown.cancelled() => Ok(()),
            result = run_ws_bridge(ws_open, addr, frame_rx, &dc_tx) => result,
        };

        // Always clear the per-connection sender when the bridge task exits.
        ws_connections.lock().await.remove(&conn_id);

        if let Err(e) = bridge_result {
            let msg = DataChannelMessage::WsError(WsError {
                conn_id,
                error: e.to_string(),
            });
            if let Ok(json) = serde_json::to_vec(&msg) {
                let _ = dc_tx.send(json).await;
            }
        }
    });
}

// ---------------------------------------------------------------------------
// WS bridge using ws_copy_bidirectional
// ---------------------------------------------------------------------------

async fn run_ws_bridge(
    ws_open: WsOpen,
    local_backend_addr: SocketAddr,
    frame_rx: mpsc::Receiver<WsFrame>,
    dc_tx: &mpsc::Sender<Vec<u8>>,
) -> Result<(), WebRtcError> {
    let conn_id = ws_open.conn_id;
    if !valid_local_path(&ws_open.path) {
        return Err(WebRtcError::InvalidLocalPath);
    }
    let url = format!("ws://{}{}", local_backend_addr, ws_open.path);
    let (ws_stream, selected_protocol) =
        connect_upstream_ws(url, ws_open.protocols.as_deref()).await?;

    let opened_msg = DataChannelMessage::WsOpened(WsOpened {
        conn_id,
        selected_protocol,
    });
    let json = serde_json::to_vec(&opened_msg)?;
    dc_tx
        .send(json)
        .await
        .map_err(|_| WebRtcError::DataChannelSendQueueClosed)?;

    let bridge = DataChannelWsStream {
        conn_id,
        frame_rx,
        poll_sender: tokio_util::sync::PollSender::new(dc_tx.clone()),
    };

    bridge_tungstenite_ws(ws_stream, bridge)
        .await
        .map_err(WebRtcError::from)
}

fn valid_local_path(path: &str) -> bool {
    path.starts_with('/')
        && !path.starts_with("//")
        && !path.contains(['\\', '#'])
        && path
            .parse::<http::Uri>()
            .is_ok_and(|uri| uri.scheme().is_none() && uri.authority().is_none())
}

#[cfg(test)]
mod tests {
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };

    use super::*;

    #[test]
    fn local_paths_cannot_override_proxy_authority() {
        for path in [
            "@attacker.example/",
            "//attacker.example/",
            "https://attacker.example/",
            "/\\attacker.example/",
            "/api/health#fragment",
        ] {
            assert!(!valid_local_path(path), "{path}");
        }
        assert!(valid_local_path("/api/health?test=1"));
    }

    #[tokio::test]
    async fn http_proxy_synthesizes_local_host_after_removing_untrusted_host() {
        tokio::time::timeout(Duration::from_secs(5), async {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let addr = listener.local_addr().unwrap();
            let backend = tokio::spawn(async move {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut bytes = Vec::new();
                while !bytes.ends_with(b"\r\n\r\n") {
                    bytes.push(socket.read_u8().await.unwrap());
                }
                let request = String::from_utf8(bytes).unwrap().to_ascii_lowercase();
                assert!(request.contains(&format!("\r\nhost: {addr}\r\n")));
                assert!(!request.contains("attacker.example"));
                socket
                    .write_all(
                        b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok",
                    )
                    .await
                    .unwrap();
            });
            let response = proxy_request(
                &reqwest::Client::new(),
                addr,
                DataChannelRequest {
                    id: Uuid::new_v4(),
                    method: "GET".into(),
                    path: "/api/health?test=1".into(),
                    headers: HashMap::from([("Host".into(), vec!["attacker.example".into()])]),
                    body_b64: None,
                },
            )
            .await;
            assert_eq!(response.status, 200);
            backend.await.unwrap();
        })
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn websocket_proxy_synthesizes_local_host() {
        tokio::time::timeout(Duration::from_secs(5), async {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let addr = listener.local_addr().unwrap();
            let backend = tokio::spawn(async move {
                let (socket, _) = listener.accept().await.unwrap();
                tokio_tungstenite::accept_hdr_async(
                    socket,
                    move |request: &tokio_tungstenite::tungstenite::handshake::server::Request,
                          response| {
                        assert_eq!(
                            request.headers().get("host").unwrap(),
                            addr.to_string().as_str()
                        );
                        assert_eq!(request.uri().path(), "/api/events");
                        Ok(response)
                    },
                )
                .await
                .unwrap();
            });
            let (socket, _) = connect_upstream_ws(format!("ws://{addr}/api/events"), None)
                .await
                .unwrap();
            drop(socket);
            backend.await.unwrap();
        })
        .await
        .unwrap();
    }
    #[tokio::test]
    async fn cancelled_peer_aborts_inflight_http() {
        tokio::time::timeout(Duration::from_secs(5), async {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let addr = listener.local_addr().unwrap();
            let shutdown = CancellationToken::new();
            let cancel = shutdown.clone();
            let (accepted_tx, accepted_rx) = tokio::sync::oneshot::channel();
            let backend = tokio::spawn(async move {
                let (socket, _) = listener.accept().await.unwrap();
                accepted_tx.send(()).unwrap();
                std::future::pending::<()>().await;
                drop(socket);
            });
            let request = DataChannelRequest {
                id: Uuid::new_v4(),
                method: "GET".into(),
                path: "/api/health".into(),
                headers: Default::default(),
                body_b64: None,
            };
            let client = reqwest::Client::new();
            let work = tokio::spawn(async move {
                proxy_request_until_cancelled(&client, addr, request, &shutdown).await
            });
            accepted_rx.await.unwrap();
            cancel.cancel();
            assert!(work.await.unwrap().is_none());
            backend.abort();
        })
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn cancelled_peer_closes_active_websocket_bridge() {
        use futures_util::StreamExt;
        tokio::time::timeout(Duration::from_secs(5), async {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let addr = listener.local_addr().unwrap();
            let backend = tokio::spawn(async move {
                let (socket, _) = listener.accept().await.unwrap();
                let mut ws = tokio_tungstenite::accept_async(socket).await.unwrap();
                let closed = ws.next().await;
                assert!(
                    closed.is_none()
                        || closed
                            .is_some_and(|result| result.is_err()
                                || result.is_ok_and(|frame| frame.is_close()))
                );
            });
            let shutdown = CancellationToken::new();
            let (dc_tx, mut dc_rx) = mpsc::channel(8);
            let connections = Arc::new(Mutex::new(HashMap::new()));
            handle_ws_open(
                WsOpen {
                    conn_id: Uuid::new_v4(),
                    path: "/api/events".into(),
                    protocols: None,
                },
                addr,
                &dc_tx,
                &connections,
                shutdown.clone(),
            )
            .await;
            let opened: DataChannelMessage =
                serde_json::from_slice(&dc_rx.recv().await.unwrap()).unwrap();
            assert!(matches!(opened, DataChannelMessage::WsOpened(_)));
            shutdown.cancel();
            backend.await.unwrap();
            while !connections.lock().await.is_empty() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
    }
}
