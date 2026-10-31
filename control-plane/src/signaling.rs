use axum::extract::ws::{Message, WebSocket};
use futures_util::{SinkExt, StreamExt};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, RwLock};

pub const SESSION_IDLE_TIMEOUT: Duration = Duration::from_secs(1800); // 30 minutes

struct Peer {
    #[allow(dead_code)]
    id: u64,
    tx: mpsc::UnboundedSender<Message>,
}

struct Room {
    #[allow(dead_code)]
    pin: String,
    #[allow(dead_code)]
    created_at: Instant,
    last_activity: Instant,
    peers: HashMap<u64, Peer>,
}

pub struct SignalingHub {
    rooms: RwLock<HashMap<String, Room>>,
    next_peer_id: AtomicU64,
}

impl SignalingHub {
    pub fn new() -> Arc<Self> {
        let hub = Arc::new(Self {
            rooms: RwLock::new(HashMap::new()),
            next_peer_id: AtomicU64::new(1),
        });

        // Periodic background task to sweep idle sessions (>30 min)
        let hub_weak = Arc::downgrade(&hub);
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(60));
            loop {
                interval.tick().await;
                if let Some(hub_ref) = hub_weak.upgrade() {
                    hub_ref.cleanup_inactive(SESSION_IDLE_TIMEOUT).await;
                } else {
                    break;
                }
            }
        });

        hub
    }

    pub fn next_peer_id(&self) -> u64 {
        self.next_peer_id.fetch_add(1, Ordering::Relaxed)
    }

    /// Generates an unused 6-character numeric PIN
    pub async fn generate_pin(&self) -> String {
        let rooms = self.rooms.read().await;
        for _ in 0..100 {
            let n: u32 = rand::random::<u32>() % 900_000 + 100_000; // 100000 to 999999
            let pin = n.to_string();
            if !rooms.contains_key(&pin) {
                return pin;
            }
        }
        format!("{:06}", rand::random::<u32>() % 1_000_000)
    }

    /// Creates and reserves a new room session, returning the 6-character PIN
    pub async fn create_session(&self) -> String {
        let pin = self.generate_pin().await;
        let mut rooms = self.rooms.write().await;
        rooms.insert(
            pin.clone(),
            Room {
                pin: pin.clone(),
                created_at: Instant::now(),
                last_activity: Instant::now(),
                peers: HashMap::new(),
            },
        );
        pin
    }

    /// Number of active rooms currently registered
    pub async fn active_rooms_count(&self) -> usize {
        self.rooms.read().await.len()
    }

    /// Number of connected peers in a given room, if it exists
    pub async fn room_peer_count(&self, pin: &str) -> Option<usize> {
        let rooms = self.rooms.read().await;
        rooms.get(pin).map(|r| r.peers.len())
    }

    /// Adds a peer to the specified room.
    /// Returns Ok(peer_count) on success, or Err if room has already 2 peers.
    pub async fn join_room(
        &self,
        pin: &str,
        peer_id: u64,
        tx: mpsc::UnboundedSender<Message>,
    ) -> Result<usize, String> {
        let mut rooms = self.rooms.write().await;
        let room = rooms.entry(pin.to_string()).or_insert_with(|| Room {
            pin: pin.to_string(),
            created_at: Instant::now(),
            last_activity: Instant::now(),
            peers: HashMap::new(),
        });

        if room.peers.len() >= 2 {
            return Err("Room full (maximum 2 participants)".to_string());
        }

        room.last_activity = Instant::now();
        room.peers.insert(peer_id, Peer { id: peer_id, tx });
        let peer_count = room.peers.len();

        // Notify other peer in the room that a peer joined
        for (pid, peer) in &room.peers {
            if *pid != peer_id {
                let msg = serde_json::to_string(&serde_json::json!({
                    "type": "peer_joined",
                    "peer_count": peer_count
                }))
                .unwrap_or_default();
                let _ = peer.tx.send(Message::Text(msg.into()));
            }
        }

        Ok(peer_count)
    }

    /// Relays a signaling payload to all other peers in the room
    pub async fn relay_message(&self, pin: &str, sender_id: u64, text: String) {
        let mut rooms = self.rooms.write().await;
        if let Some(room) = rooms.get_mut(pin) {
            room.last_activity = Instant::now();
            for (pid, peer) in &room.peers {
                if *pid != sender_id {
                    let _ = peer.tx.send(Message::Text(text.clone().into()));
                }
            }
        }
    }

    /// Removes a peer from a room. Cleans up empty room if no peers remain.
    pub async fn leave_room(&self, pin: &str, peer_id: u64) {
        let mut rooms = self.rooms.write().await;
        let mut is_empty = false;
        if let Some(room) = rooms.get_mut(pin) {
            room.peers.remove(&peer_id);
            room.last_activity = Instant::now();

            // Notify remaining peer that the other peer left
            for (_, peer) in &room.peers {
                let msg = serde_json::to_string(&serde_json::json!({
                    "type": "peer_left"
                }))
                .unwrap_or_default();
                let _ = peer.tx.send(Message::Text(msg.into()));
            }

            if room.peers.is_empty() {
                is_empty = true;
            }
        }
        if is_empty {
            rooms.remove(pin);
        }
    }

    /// Sweeps sessions that have been idle for longer than `max_idle`
    pub async fn cleanup_inactive(&self, max_idle: Duration) -> usize {
        let mut rooms = self.rooms.write().await;
        let mut to_remove = Vec::new();
        for (pin, room) in rooms.iter() {
            if room.last_activity.elapsed() >= max_idle {
                to_remove.push(pin.clone());
                for (_, peer) in &room.peers {
                    let msg = serde_json::to_string(&serde_json::json!({
                        "type": "error",
                        "message": "Session expired due to inactivity"
                    }))
                    .unwrap_or_default();
                    let _ = peer.tx.send(Message::Text(msg.into()));
                }
            }
        }
        let count = to_remove.len();
        for pin in to_remove {
            rooms.remove(&pin);
        }
        count
    }
}

/// WebSocket connection loop for a client or super-admin peer
pub async fn handle_socket(
    socket: WebSocket,
    hub: Arc<SignalingHub>,
    initial_pin: Option<String>,
) {
    let (mut ws_sender, mut ws_receiver) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<Message>();

    // Background task sending outgoing messages to client
    let mut send_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            let is_close = matches!(msg, Message::Close(_));
            if ws_sender.send(msg).await.is_err() || is_close {
                break;
            }
        }
    });

    let peer_id = hub.next_peer_id();
    let mut current_pin: Option<String> = None;

    // If room PIN provided via URL path or query parameter, attempt immediate join
    if let Some(pin) = initial_pin {
        let clean_pin = pin.trim().to_uppercase();
        if clean_pin.len() != 6 || !clean_pin.chars().all(|c| c.is_ascii_alphanumeric()) {
            let _ = tx.send(Message::Text(
                serde_json::to_string(&serde_json::json!({
                    "type": "error",
                    "message": "Invalid PIN format (must be 6 alphanumeric characters)"
                }))
                .unwrap_or_default()
                .into(),
            ));
            let _ = tx.send(Message::Close(None));
            let _ = tokio::time::timeout(Duration::from_millis(100), &mut send_task).await;
            return;
        }

        match hub.join_room(&clean_pin, peer_id, tx.clone()).await {
            Ok(peer_count) => {
                current_pin = Some(clean_pin.clone());
                let _ = tx.send(Message::Text(
                    serde_json::to_string(&serde_json::json!({
                        "type": "joined",
                        "pin": clean_pin,
                        "peer_count": peer_count
                    }))
                    .unwrap_or_default()
                    .into(),
                ));
            }
            Err(err) => {
                let _ = tx.send(Message::Text(
                    serde_json::to_string(&serde_json::json!({
                        "type": "error",
                        "message": err
                    }))
                    .unwrap_or_default()
                    .into(),
                ));
                let _ = tx.send(Message::Close(None));
                let _ = tokio::time::timeout(Duration::from_millis(100), &mut send_task).await;
                return;
            }
        }
    }

    // Main receive loop
    while let Some(msg_result) = ws_receiver.next().await {
        let msg = match msg_result {
            Ok(m) => m,
            Err(_) => break,
        };

        match msg {
            Message::Text(text_str) => {
                let text = text_str.as_str();
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(text) {
                    let msg_type = v.get("type").and_then(|t| t.as_str()).unwrap_or("");

                    if msg_type == "join" {
                        if let Some(pin) = v.get("pin").and_then(|p| p.as_str()) {
                            let clean_pin = pin.trim().to_uppercase();
                            if clean_pin.len() != 6
                                || !clean_pin.chars().all(|c| c.is_ascii_alphanumeric())
                            {
                                let _ = tx.send(Message::Text(
                                    serde_json::to_string(&serde_json::json!({
                                        "type": "error",
                                        "message": "Invalid PIN format"
                                    }))
                                    .unwrap_or_default()
                                    .into(),
                                ));
                                continue;
                            }

                            if let Some(ref old_pin) = current_pin {
                                hub.leave_room(old_pin, peer_id).await;
                            }

                            match hub.join_room(&clean_pin, peer_id, tx.clone()).await {
                                Ok(peer_count) => {
                                    current_pin = Some(clean_pin.clone());
                                    let _ = tx.send(Message::Text(
                                        serde_json::to_string(&serde_json::json!({
                                            "type": "joined",
                                            "pin": clean_pin,
                                            "peer_count": peer_count
                                        }))
                                        .unwrap_or_default()
                                        .into(),
                                    ));
                                }
                                Err(err) => {
                                    let _ = tx.send(Message::Text(
                                        serde_json::to_string(&serde_json::json!({
                                            "type": "error",
                                            "message": err
                                        }))
                                        .unwrap_or_default()
                                        .into(),
                                    ));
                                }
                            }
                        }
                        continue;
                    }

                    if msg_type == "ping" {
                        let _ = tx.send(Message::Text(
                            serde_json::to_string(&serde_json::json!({ "type": "pong" }))
                                .unwrap_or_default()
                                .into(),
                        ));
                        continue;
                    }

                    // Relay offer, answer, candidate, or arbitrary signaling payloads
                    if let Some(ref pin) = current_pin {
                        hub.relay_message(pin, peer_id, text.to_string()).await;
                    } else {
                        let _ = tx.send(Message::Text(
                            serde_json::to_string(&serde_json::json!({
                                "type": "error",
                                "message": "Not in a room. Join a room first."
                            }))
                            .unwrap_or_default()
                            .into(),
                        ));
                    }
                }
            }
            Message::Ping(bytes) => {
                let _ = tx.send(Message::Pong(bytes));
            }
            Message::Close(_) => {
                break;
            }
            _ => {}
        }
    }

    // Clean up on disconnect
    if let Some(ref pin) = current_pin {
        hub.leave_room(pin, peer_id).await;
    }
    send_task.abort();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_signaling_hub_lifecycle() {
        let hub = SignalingHub::new();
        let pin = hub.create_session().await;
        assert_eq!(pin.len(), 6);
        assert_eq!(hub.active_rooms_count().await, 1);
        assert_eq!(hub.room_peer_count(&pin).await, Some(0));

        let (tx1, mut rx1) = mpsc::unbounded_channel();
        let (tx2, mut rx2) = mpsc::unbounded_channel();

        let count1 = hub.join_room(&pin, 1, tx1).await.unwrap();
        assert_eq!(count1, 1);
        assert_eq!(hub.room_peer_count(&pin).await, Some(1));

        let count2 = hub.join_room(&pin, 2, tx2).await.unwrap();
        assert_eq!(count2, 2);
        assert_eq!(hub.room_peer_count(&pin).await, Some(2));

        // Peer 1 should have received "peer_joined"
        if let Some(Message::Text(msg)) = rx1.recv().await {
            assert!(msg.contains("peer_joined"));
        } else {
            panic!("Expected peer_joined message");
        }

        // 3rd peer should be rejected
        let (tx3, _rx3) = mpsc::unbounded_channel();
        let res3 = hub.join_room(&pin, 3, tx3).await;
        assert!(res3.is_err());

        // Peer 1 sends offer -> Peer 2 receives it
        let offer_text = r#"{"type":"offer","sdp":"v=0..."}"#.to_string();
        hub.relay_message(&pin, 1, offer_text.clone()).await;

        if let Some(Message::Text(msg)) = rx2.recv().await {
            assert_eq!(msg, offer_text);
        } else {
            panic!("Expected offer message");
        }

        // Peer 2 sends answer -> Peer 1 receives it
        let answer_text = r#"{"type":"answer","sdp":"v=0_answer..."}"#.to_string();
        hub.relay_message(&pin, 2, answer_text.clone()).await;

        if let Some(Message::Text(msg)) = rx1.recv().await {
            assert_eq!(msg, answer_text);
        } else {
            panic!("Expected answer message");
        }

        // Peer 2 disconnects
        hub.leave_room(&pin, 2).await;
        assert_eq!(hub.room_peer_count(&pin).await, Some(1));

        // Peer 1 should receive peer_left
        if let Some(Message::Text(msg)) = rx1.recv().await {
            assert!(msg.contains("peer_left"));
        } else {
            panic!("Expected peer_left message");
        }

        // Peer 1 disconnects -> Room is removed
        hub.leave_room(&pin, 1).await;
        assert_eq!(hub.active_rooms_count().await, 0);
    }
}
