use control_plane::db::{init_schema, open_db};
use control_plane::ratelimit::SlidingWindowLimiter;
use control_plane::routes::{create_router, AppState};
use control_plane::signaling::SignalingHub;
use ed25519_dalek::SigningKey;
use futures_util::{SinkExt, StreamExt};
use rand::rngs::OsRng;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::protocol::Message as WsMessage;

const TEST_SECRET: &str = "test_signaling_secret_key_123";

struct TestServer {
    addr: SocketAddr,
    db_path: PathBuf,
    _join_handle: tokio::task::JoinHandle<()>,
}

impl Drop for TestServer {
    fn drop(&mut self) {
        self._join_handle.abort();
        let _ = std::fs::remove_file(&self.db_path);
    }
}

struct HttpResponse {
    status: u16,
    #[allow(dead_code)]
    headers: HashMap<String, String>,
    body: String,
}

impl HttpResponse {
    fn json(&self) -> Value {
        serde_json::from_str(&self.body).unwrap_or_else(|_| {
            panic!(
                "Expected JSON response, got status {} body: {}",
                self.status, self.body
            )
        })
    }
}

async fn send_http(
    addr: SocketAddr,
    method: &str,
    path: &str,
    headers: &[(&str, &str)],
    body: &str,
) -> HttpResponse {
    let mut stream = tokio::net::TcpStream::connect(addr)
        .await
        .expect("connect to test server");
    let body_bytes = body.as_bytes();
    let mut req = format!(
        "{} {} HTTP/1.1\r\nHost: {}\r\nConnection: close\r\nContent-Length: {}\r\n",
        method,
        path,
        addr,
        body_bytes.len()
    );
    for (k, v) in headers {
        req.push_str(&format!("{}: {}\r\n", k, v));
    }
    req.push_str("\r\n");
    stream
        .write_all(req.as_bytes())
        .await
        .expect("write req header");
    if !body_bytes.is_empty() {
        stream
            .write_all(body_bytes)
            .await
            .expect("write req body");
    }

    let mut resp_bytes = Vec::new();
    stream
        .read_to_end(&mut resp_bytes)
        .await
        .expect("read response");

    let resp_str = String::from_utf8_lossy(&resp_bytes);
    let parts: Vec<&str> = resp_str.splitn(2, "\r\n\r\n").collect();
    let header_part = parts[0];
    let body_part = if parts.len() > 1 { parts[1] } else { "" };

    let first_line = header_part.lines().next().unwrap_or("");
    let status = first_line
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse::<u16>().ok())
        .unwrap_or(0);

    let mut parsed_headers = HashMap::new();
    for line in header_part.lines().skip(1) {
        if let Some((k, v)) = line.split_once(':') {
            parsed_headers.insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
        }
    }

    HttpResponse {
        status,
        headers: parsed_headers,
        body: body_part.to_string(),
    }
}

async fn setup_test_server() -> TestServer {
    let temp_db =
        std::env::temp_dir().join(format!("test_signaling_{}.db", uuid::Uuid::new_v4()));
    let conn = open_db(&temp_db).expect("open test db");
    init_schema(&conn).expect("init schema");

    let mut rng = OsRng;
    let signing_key = SigningKey::generate(&mut rng);

    let state = Arc::new(AppState {
        db_path: temp_db.clone(),
        server_secret: TEST_SECRET.into(),
        webhook_secret: Some(TEST_SECRET.into()),
        signing_key: Arc::new(signing_key),
        rate_limiter: Arc::new(SlidingWindowLimiter::new(60_000, 10_000)),
        signaling: SignalingHub::new(),
    });

    let app = create_router(state);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind tcp");
    let addr = listener.local_addr().expect("local addr");
    let handle = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });

    TestServer {
        addr,
        db_path: temp_db,
        _join_handle: handle,
    }
}

// ----------------------------------------------------------------------------
// 1. Session REST API tests: Create and Inspect Session
// ----------------------------------------------------------------------------
#[tokio::test]
async fn test_support_session_rest_endpoints() {
    let s = setup_test_server().await;

    // A. Create new support session PIN
    let resp = send_http(
        s.addr,
        "POST",
        "/v1/support/session",
        &[("Content-Type", "application/json")],
        "{}",
    )
    .await;

    assert_eq!(resp.status, 201, "Create session failed: {}", resp.body);
    let val = resp.json();
    let pin = val["pin"].as_str().expect("pin string");
    assert_eq!(pin.len(), 6);
    assert!(pin.chars().all(|c| c.is_ascii_digit()));

    // B. Query created session status
    let check_resp = send_http(
        s.addr,
        "GET",
        &format!("/v1/support/session/{}", pin),
        &[],
        "",
    )
    .await;
    assert_eq!(check_resp.status, 200);
    let check_val = check_resp.json();
    assert_eq!(check_val["pin"], pin);
    assert_eq!(check_val["active"], true);
    assert_eq!(check_val["peer_count"], 0);

    // C. Query non-existent session
    let missing_resp = send_http(
        s.addr,
        "GET",
        "/v1/support/session/999999",
        &[],
        "",
    )
    .await;
    assert_eq!(missing_resp.status, 404);
}

// ----------------------------------------------------------------------------
// 2. WebRTC Peer-to-Peer Signaling Relay E2E Test
// ----------------------------------------------------------------------------
#[tokio::test]
async fn test_webrtc_signaling_relay_e2e() {
    let s = setup_test_server().await;

    // Generate room session PIN
    let sess_resp = send_http(
        s.addr,
        "POST",
        "/v1/support/session",
        &[("Content-Type", "application/json")],
        "{}",
    )
    .await;
    let pin = sess_resp.json()["pin"].as_str().unwrap().to_string();

    // A. Client POS connects to WebSocket
    let ws_url = format!("ws://{}/v1/support/ws/{}", s.addr, pin);
    let (mut pos_ws, _) = connect_async(&ws_url).await.expect("pos connect ws");

    // Client POS should receive {"type": "joined", "pin": pin, "peer_count": 1}
    let msg1 = pos_ws.next().await.unwrap().unwrap();
    let msg1_text = msg1.to_text().unwrap();
    let val1: Value = serde_json::from_str(msg1_text).unwrap();
    assert_eq!(val1["type"], "joined");
    assert_eq!(val1["pin"], pin);
    assert_eq!(val1["peer_count"], 1);

    // B. Super Admin connects to same WebSocket room
    let (mut admin_ws, _) = connect_async(&ws_url).await.expect("admin connect ws");

    // Super Admin should receive {"type": "joined", "pin": pin, "peer_count": 2}
    let msg2 = admin_ws.next().await.unwrap().unwrap();
    let val2: Value = serde_json::from_str(msg2.to_text().unwrap()).unwrap();
    assert_eq!(val2["type"], "joined");
    assert_eq!(val2["peer_count"], 2);

    // Client POS should receive {"type": "peer_joined", "peer_count": 2}
    let msg3 = pos_ws.next().await.unwrap().unwrap();
    let val3: Value = serde_json::from_str(msg3.to_text().unwrap()).unwrap();
    assert_eq!(val3["type"], "peer_joined");
    assert_eq!(val3["peer_count"], 2);

    // C. Client POS sends WebRTC SDP Offer -> Super Admin receives it
    let offer_payload = json!({
        "type": "offer",
        "sdp": "v=0\r\no=ClientPOS 123456 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=sendonly\r\n"
    });
    pos_ws
        .send(WsMessage::Text(offer_payload.to_string().into()))
        .await
        .expect("send offer");

    let admin_recv_offer = admin_ws.next().await.unwrap().unwrap();
    let offer_val: Value = serde_json::from_str(admin_recv_offer.to_text().unwrap()).unwrap();
    assert_eq!(offer_val["type"], "offer");
    assert_eq!(offer_val["sdp"], offer_payload["sdp"]);

    // D. Super Admin sends WebRTC SDP Answer -> Client POS receives it
    let answer_payload = json!({
        "type": "answer",
        "sdp": "v=0\r\no=SuperAdmin 789012 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=recvonly\r\n"
    });
    admin_ws
        .send(WsMessage::Text(answer_payload.to_string().into()))
        .await
        .expect("send answer");

    let pos_recv_answer = pos_ws.next().await.unwrap().unwrap();
    let answer_val: Value = serde_json::from_str(pos_recv_answer.to_text().unwrap()).unwrap();
    assert_eq!(answer_val["type"], "answer");
    assert_eq!(answer_val["sdp"], answer_payload["sdp"]);

    // E. ICE Candidate exchange: Client POS -> Super Admin
    let candidate_pos = json!({
        "type": "candidate",
        "candidate": {
            "candidate": "candidate:1 1 UDP 2130706431 192.168.1.50 54321 typ host",
            "sdpMid": "0",
            "sdpMLineIndex": 0
        }
    });
    pos_ws
        .send(WsMessage::Text(candidate_pos.to_string().into()))
        .await
        .expect("send pos candidate");

    let admin_recv_cand = admin_ws.next().await.unwrap().unwrap();
    let cand_val: Value = serde_json::from_str(admin_recv_cand.to_text().unwrap()).unwrap();
    assert_eq!(cand_val["type"], "candidate");
    assert_eq!(
        cand_val["candidate"]["candidate"],
        "candidate:1 1 UDP 2130706431 192.168.1.50 54321 typ host"
    );

    // F. Ping / Pong test
    pos_ws
        .send(WsMessage::Text(json!({"type": "ping"}).to_string().into()))
        .await
        .expect("send ping");
    let pong_msg = pos_ws.next().await.unwrap().unwrap();
    let pong_val: Value = serde_json::from_str(pong_msg.to_text().unwrap()).unwrap();
    assert_eq!(pong_val["type"], "pong");

    // G. 3rd peer connection attempt should be rejected (room capacity = 2)
    let (mut third_ws, _) = connect_async(&ws_url).await.expect("third connect ws");
    let third_msg = third_ws.next().await.unwrap().unwrap();
    let third_val: Value = serde_json::from_str(third_msg.to_text().unwrap()).unwrap();
    assert_eq!(third_val["type"], "error");
    assert!(third_val["message"].as_str().unwrap().contains("Room full"));

    // H. Super Admin disconnects -> Client POS receives peer_left
    let _ = admin_ws.close(None).await;

    let pos_left_msg = pos_ws.next().await.unwrap().unwrap();
    let left_val: Value = serde_json::from_str(pos_left_msg.to_text().unwrap()).unwrap();
    assert_eq!(left_val["type"], "peer_left");

    // I. Client POS disconnects -> Room is cleaned up
    let _ = pos_ws.close(None).await;

    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    // Query session -> room should be removed
    let after_resp = send_http(
        s.addr,
        "GET",
        &format!("/v1/support/session/{}", pin),
        &[],
        "",
    )
    .await;
    assert_eq!(after_resp.status, 404);
}

// ----------------------------------------------------------------------------
// 3. Query parameter and dynamic room creation test
// ----------------------------------------------------------------------------
#[tokio::test]
async fn test_signaling_dynamic_pin_via_query_and_disconnect() {
    let s = setup_test_server().await;

    // Connect with query parameter ?pin=ABC123
    let custom_pin = "ABC123";
    let ws_url = format!("ws://{}/v1/support/ws?pin={}", s.addr, custom_pin);
    let (mut ws1, _) = connect_async(&ws_url).await.expect("connect ws with query");

    let msg1 = ws1.next().await.unwrap().unwrap();
    let val1: Value = serde_json::from_str(msg1.to_text().unwrap()).unwrap();
    assert_eq!(val1["type"], "joined");
    assert_eq!(val1["pin"], custom_pin);
    assert_eq!(val1["peer_count"], 1);

    let _ = ws1.close(None).await;
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    let check = send_http(
        s.addr,
        "GET",
        &format!("/v1/support/session/{}", custom_pin),
        &[],
        "",
    )
    .await;
    assert_eq!(check.status, 404);
}
