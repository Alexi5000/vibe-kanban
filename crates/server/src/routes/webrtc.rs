use std::sync::Arc;

use axum::{
    Extension, Json, Router,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::Json as ResponseJson,
    routing::post,
};
use deployment::Deployment;
use relay_webrtc::{IceCandidate, SdpAnswer, SdpOffer, authority::PeerAuthority};
use utils::response::ApiResponse;
use uuid::Uuid;

use crate::{
    DeploymentImpl, error::ApiError,
    middleware::relay_request_signature::RelayRequestSignatureContext,
};

pub fn router() -> Router<DeploymentImpl> {
    Router::new()
        .route("/webrtc/offer", post(handle_offer))
        .route("/webrtc/candidate", post(handle_candidate))
}

async fn handle_offer(
    State(deployment): State<DeploymentImpl>,
    signature: Option<Extension<RelayRequestSignatureContext>>,
    headers: HeaderMap,
    Json(offer): Json<SdpOffer>,
) -> Result<ResponseJson<ApiResponse<SdpAnswer>>, ApiError> {
    let Some(webrtc_host) = deployment.webrtc_host() else {
        return Err(ApiError::BadRequest(
            "Local server address is not available".to_string(),
        ));
    };

    let authority = peer_authority(&deployment, signature, &headers)?;
    if !authority.authorized().await {
        return Err(ApiError::Unauthorized);
    }
    let answer = webrtc_host.handle_offer(offer, authority).await?;
    Ok(ResponseJson(ApiResponse::success(answer)))
}

async fn handle_candidate(
    State(deployment): State<DeploymentImpl>,
    signature: Option<Extension<RelayRequestSignatureContext>>,
    headers: HeaderMap,
    Json(candidate): Json<IceCandidate>,
) -> Result<StatusCode, ApiError> {
    let Some(webrtc_host) = deployment.webrtc_host() else {
        return Err(ApiError::BadRequest(
            "Local server address is not available".to_string(),
        ));
    };

    let authority = peer_authority(&deployment, signature, &headers)?;
    if !authority.authorized().await {
        return Err(ApiError::Unauthorized);
    }
    webrtc_host
        .add_ice_candidate(candidate, authority.binding())
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

fn peer_authority(
    deployment: &DeploymentImpl,
    signature: Option<Extension<RelayRequestSignatureContext>>,
    headers: &HeaderMap,
) -> Result<PeerAuthority, ApiError> {
    signature.ok_or(ApiError::Unauthorized)?;
    let parse = |name: &str| -> Result<Uuid, ApiError> {
        if headers.get_all(name).iter().count() != 1 {
            return Err(ApiError::Unauthorized);
        }
        headers
            .get(name)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| Uuid::parse_str(v).ok())
            .ok_or(ApiError::Unauthorized)
    };
    let host = parse("x-vk-relay-host")?;
    let session = parse("x-vk-relay-browser-session")?;
    let base = deployment
        .remote_info()
        .get_relay_api_base()
        .ok_or(ApiError::Unauthorized)?;
    let remote = deployment
        .remote_client()
        .map_err(|_| ApiError::Unauthorized)?;
    PeerAuthority::new(
        &base,
        host,
        session,
        deployment.user_id(),
        Arc::new(move || {
            let remote = remote.clone();
            Box::pin(async move { remote.access_token().await.ok() })
        }),
    )
    .ok_or(ApiError::Unauthorized)
}
