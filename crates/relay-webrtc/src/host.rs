use std::{collections::HashMap, net::SocketAddr, sync::Arc};

use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;
use webrtc::ice_transport::ice_candidate::RTCIceCandidateInit;

use crate::{
    WebRtcError,
    authority::PeerAuthority,
    peer::{self, PeerConfig, PeerHandle},
    signaling::{IceCandidate, SdpAnswer, SdpOffer},
};

/// Manages WebRTC peer connections for the local host.
///
/// Accepts SDP offers from remote peers, creates peer connections, and runs
/// tasks that proxy data channel traffic to the local backend.
pub struct WebRtcHost {
    tunnel_provenance: uuid::Uuid,
    inner: Arc<Mutex<WebRtcHostInner>>,
}

struct WebRtcHostInner {
    peers: HashMap<String, PeerHandle>,
    local_backend_addr: SocketAddr,
    shutdown: CancellationToken,
    lifetime: CancellationToken,
}

impl WebRtcHost {
    pub fn new(local_backend_addr: SocketAddr, shutdown: CancellationToken) -> Self {
        Self {
            tunnel_provenance: uuid::Uuid::new_v4(),
            inner: Arc::new(Mutex::new(WebRtcHostInner {
                peers: HashMap::new(),
                local_backend_addr,
                lifetime: shutdown.clone(),
                shutdown: shutdown.child_token(),
            })),
        }
    }

    pub async fn stop_all(&self) {
        let peers = {
            let mut inner = self.inner.lock().await;
            inner.shutdown.cancel();
            inner
                .peers
                .drain()
                .map(|(_, peer)| peer)
                .collect::<Vec<_>>()
        };
        for peer in peers {
            peer.shutdown.cancel();
            let _ = peer.peer_connection.close().await;
        }
    }

    pub async fn start(&self) {
        let mut inner = self.inner.lock().await;
        inner.shutdown = inner.lifetime.child_token();
    }

    pub fn tunnel_provenance(&self) -> String {
        self.tunnel_provenance.to_string()
    }

    pub fn accepts_tunnel_provenance(&self, value: &str) -> bool {
        uuid::Uuid::parse_str(value)
            .is_ok_and(|value| (value.as_u128() ^ self.tunnel_provenance.as_u128()) == 0)
    }

    /// Accept an SDP offer and return an SDP answer.
    ///
    /// Creates a new peer connection and spawns its event loop task.
    pub async fn handle_offer(
        &self,
        offer: SdpOffer,
        authority: PeerAuthority,
    ) -> Result<SdpAnswer, WebRtcError> {
        let generation = self.inner.lock().await.shutdown.clone();
        if generation.is_cancelled() {
            return Err(WebRtcError::SessionRevoked);
        }
        let (answer_sdp, peer_connection) = peer::accept_offer(&offer.sdp).await?;
        let session_id = format!("{}:{}", authority.binding(), offer.session_id);

        let (old_peer, peer_shutdown, local_backend_addr) = {
            let mut inner = self.inner.lock().await;
            if generation.is_cancelled() {
                drop(inner);
                let _ = peer_connection.close().await;
                return Err(WebRtcError::SessionRevoked);
            }
            let old_peer = inner.peers.remove(&session_id);
            let peer_shutdown = generation.child_token();
            let local_backend_addr = inner.local_backend_addr;

            let handle = PeerHandle {
                peer_connection: peer_connection.clone(),
                shutdown: peer_shutdown.clone(),
            };
            inner.peers.insert(session_id.clone(), handle);
            (old_peer, peer_shutdown, local_backend_addr)
        };

        let inner_ref = Arc::clone(&self.inner);

        // Clean up any existing peer with the same session ID.
        if let Some(old_peer) = old_peer {
            old_peer.shutdown.cancel();
            let _ = old_peer.peer_connection.close().await;
        }

        tokio::spawn(async move {
            let config = PeerConfig {
                local_backend_addr,
                shutdown: peer_shutdown,
                authority,
            };

            if let Err(e) = peer::run_peer(peer_connection.clone(), config).await {
                tracing::warn!(?e, %session_id, "WebRTC peer task failed");
            }

            // Remove self from the peer map on exit.
            let mut inner = inner_ref.lock().await;
            if inner
                .peers
                .get(&session_id)
                .is_some_and(|peer| Arc::ptr_eq(&peer.peer_connection, &peer_connection))
            {
                inner.peers.remove(&session_id);
            }
        });

        Ok(SdpAnswer {
            sdp: answer_sdp,
            session_id: offer.session_id,
        })
    }

    /// Add a trickle ICE candidate for an active peer session.
    pub async fn add_ice_candidate(
        &self,
        candidate: IceCandidate,
        binding: &str,
    ) -> Result<(), WebRtcError> {
        let peer_connection = {
            let inner = self.inner.lock().await;
            inner
                .peers
                .get(&format!("{}:{}", binding, candidate.session_id))
                .map(|peer| peer.peer_connection.clone())
                .ok_or_else(|| WebRtcError::SessionNotFound {
                    session_id: candidate.session_id.clone(),
                })?
        };

        let init = RTCIceCandidateInit {
            candidate: candidate.candidate,
            sdp_mid: candidate.sdp_mid,
            sdp_mline_index: candidate.sdp_m_line_index.map(|v| v as u16),
            ..Default::default()
        };

        peer_connection.add_ice_candidate(init).await?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_current_local_tunnel_can_supply_provenance() {
        let host = WebRtcHost::new("127.0.0.1:1".parse().unwrap(), CancellationToken::new());
        let other = WebRtcHost::new("127.0.0.1:1".parse().unwrap(), CancellationToken::new());
        assert!(host.accepts_tunnel_provenance(&host.tunnel_provenance()));
        assert!(!host.accepts_tunnel_provenance(&other.tunnel_provenance()));
        assert!(!host.accepts_tunnel_provenance(""));
        assert!(!host.accepts_tunnel_provenance(&uuid::Uuid::new_v4().to_string()));
    }
    #[tokio::test]
    async fn stopping_relay_cancels_old_peer_generation_and_allows_new_authorized_offers() {
        let host = WebRtcHost::new("127.0.0.1:1".parse().unwrap(), CancellationToken::new());
        let old_peer = host.inner.lock().await.shutdown.child_token();
        host.stop_all().await;
        assert!(old_peer.is_cancelled());
        assert!(host.inner.lock().await.shutdown.is_cancelled());
        host.start().await;
        assert!(old_peer.is_cancelled());
        let new_peer = host.inner.lock().await.shutdown.child_token();
        assert!(!new_peer.is_cancelled());
        host.stop_all().await;
        assert!(new_peer.is_cancelled());
    }
}
