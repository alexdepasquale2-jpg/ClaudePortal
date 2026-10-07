//! Per-backend admission control (SPEC §3.6): at most `n` requests run at once;
//! waiters are served by priority (Interactive first, Dream last), FIFO within
//! a priority.

use std::cmp::Ordering;
use std::collections::BinaryHeap;
use std::sync::{Arc, Mutex, MutexGuard};
use tokio::sync::oneshot;
use xz_types::Priority;

/// A priority-ordered counting semaphore.
pub(crate) struct Gate {
    state: Mutex<State>,
}

struct State {
    free: usize,
    waiting: BinaryHeap<Waiter>,
    next_seq: u64,
}

struct Waiter {
    priority: Priority,
    seq: u64,
    tx: oneshot::Sender<Permit>,
}

/// Max-heap order: higher priority first, then the earlier arrival.
impl Ord for Waiter {
    fn cmp(&self, other: &Self) -> Ordering {
        self.priority
            .cmp(&other.priority)
            .then_with(|| other.seq.cmp(&self.seq))
    }
}

impl PartialOrd for Waiter {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl PartialEq for Waiter {
    fn eq(&self, other: &Self) -> bool {
        self.cmp(other) == Ordering::Equal
    }
}

impl Eq for Waiter {}

/// The right to run one request. Dropping it admits the next waiter.
pub(crate) struct Permit {
    gate: Option<Arc<Gate>>,
}

impl Drop for Permit {
    fn drop(&mut self) {
        if let Some(gate) = self.gate.take() {
            gate.release();
        }
    }
}

impl Gate {
    pub(crate) fn new(concurrency: usize) -> Arc<Self> {
        Arc::new(Self {
            state: Mutex::new(State {
                free: concurrency.max(1),
                waiting: BinaryHeap::new(),
                next_seq: 0,
            }),
        })
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Waits for a slot. Cancel-safe: a waiter that gives up passes its turn on.
    pub(crate) async fn acquire(self: &Arc<Self>, priority: Priority) -> Permit {
        loop {
            let rx = {
                let mut st = self.lock();
                if st.free > 0 && st.waiting.is_empty() {
                    st.free -= 1;
                    return Permit {
                        gate: Some(self.clone()),
                    };
                }
                let (tx, rx) = oneshot::channel();
                let seq = st.next_seq;
                st.next_seq += 1;
                st.waiting.push(Waiter { priority, seq, tx });
                rx
            };
            // The sender is only dropped unsent if the gate itself goes away,
            // which cannot happen while we hold an Arc to it; retry regardless.
            if let Ok(permit) = rx.await {
                return permit;
            }
        }
    }

    /// Requests waiting for a slot (cancelled waiters are not counted).
    pub(crate) fn queued(&self) -> usize {
        self.lock()
            .waiting
            .iter()
            .filter(|w| !w.tx.is_closed())
            .count()
    }

    /// Hands the released slot to the best waiter still listening.
    fn release(self: &Arc<Self>) {
        let mut permit = Permit {
            gate: Some(self.clone()),
        };
        let mut st = self.lock();
        while let Some(w) = st.waiting.pop() {
            match w.tx.send(permit) {
                Ok(()) => return,
                // That waiter was cancelled; offer the slot to the next one.
                Err(p) => permit = p,
            }
        }
        st.free += 1;
        // Defuse so dropping it does not release a second time.
        permit.gate = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[tokio::test]
    async fn serves_by_priority_then_fifo() {
        let gate = Gate::new(1);
        let first = gate.acquire(Priority::Background).await;
        let order = Arc::new(Mutex::new(vec![]));
        let mut tasks = vec![];
        for (name, p) in [
            ("dream", Priority::Dream),
            ("bg1", Priority::Background),
            ("fg", Priority::Foreground),
            ("bg2", Priority::Background),
            ("int", Priority::Interactive),
        ] {
            let (g, order) = (gate.clone(), order.clone());
            tasks.push(tokio::spawn(async move {
                let _permit = g.acquire(p).await;
                order.lock().unwrap().push(name);
            }));
            // Make arrival order deterministic.
            while gate.queued() < tasks.len() {
                tokio::task::yield_now().await;
            }
        }
        drop(first);
        for t in tasks {
            t.await.unwrap();
        }
        assert_eq!(*order.lock().unwrap(), ["int", "fg", "bg1", "bg2", "dream"]);
        assert_eq!(gate.queued(), 0);
    }

    #[tokio::test]
    async fn concurrency_limit_and_reuse() {
        let gate = Gate::new(2);
        let a = gate.acquire(Priority::Foreground).await;
        let _b = gate.acquire(Priority::Foreground).await;
        let waiting = tokio::time::timeout(
            Duration::from_millis(50),
            gate.acquire(Priority::Interactive),
        )
        .await;
        assert!(waiting.is_err(), "third request must wait");
        drop(a);
        let _c = tokio::time::timeout(Duration::from_secs(5), gate.acquire(Priority::Dream))
            .await
            .expect("slot freed");
    }

    #[tokio::test]
    async fn cancelled_waiter_passes_its_turn() {
        let gate = Gate::new(1);
        let held = gate.acquire(Priority::Foreground).await;
        // This waiter gives up (its future is dropped by the timeout).
        let gone = tokio::time::timeout(
            Duration::from_millis(20),
            gate.acquire(Priority::Interactive),
        )
        .await;
        assert!(gone.is_err());
        let g = gate.clone();
        let next = tokio::spawn(async move { g.acquire(Priority::Dream).await });
        while gate.queued() < 1 {
            tokio::task::yield_now().await;
        }
        drop(held);
        let permit = tokio::time::timeout(Duration::from_secs(5), next)
            .await
            .unwrap()
            .unwrap();
        drop(permit);
        // All slots are back.
        let _again = tokio::time::timeout(Duration::from_secs(5), gate.acquire(Priority::Dream))
            .await
            .unwrap();
    }
}
