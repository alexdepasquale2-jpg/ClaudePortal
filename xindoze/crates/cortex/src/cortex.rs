//! The Cortex: role-routed, scheduled inference over registered backends
//! (SPEC §3.6). This is what the rest of the OS calls, via `xz_types::Inference`.

use crate::calibrate::Profile;
use crate::registry::Registry;
use crate::scheduler::Gate;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex, RwLock};
use std::time::Instant;
use xz_types::{GenRequest, GenResponse, Inference, ModelBackend, Priority, Role, XzError};

/// Which backend and model serve a role.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Assignment {
    pub backend: String,
    pub model: String,
}

/// Counters for Pulse.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct CortexStats {
    /// Generate calls that reached a backend.
    pub requests: u64,
    /// Generate or embed calls that failed in the backend.
    pub errors: u64,
    /// Embed calls that reached a backend.
    pub embeds: u64,
    pub tokens_in: u64,
    pub tokens_out: u64,
    /// Generated tokens per second, over every successful request.
    pub tokens_per_sec: f64,
    /// `backend:model` of the latest successful generate call.
    pub last_model: Option<String>,
    /// Requests waiting for a backend right now.
    pub queued: usize,
}

struct Slot {
    backend: Arc<dyn ModelBackend>,
    gate: Arc<Gate>,
}

#[derive(Default)]
struct Routes {
    backends: HashMap<String, Arc<Slot>>,
    roles: HashMap<Role, Assignment>,
}

#[derive(Default)]
struct Counters {
    stats: CortexStats,
    gen_millis: u64,
}

/// Role-routed inference with a per-backend priority scheduler.
///
/// `generate` falls back from Reflex and Oracle to the Cortex assignment when
/// those roles are unassigned. `has_role` reports explicit assignments only,
/// so escalation never re-runs the same model under another name.
pub struct Cortex {
    routes: RwLock<Routes>,
    counters: Mutex<Counters>,
}

impl Cortex {
    pub fn builder() -> CortexBuilder {
        CortexBuilder::default()
    }

    /// One backend and one model for every role (tests and tiny setups).
    pub fn single(backend: Arc<dyn ModelBackend>, model: &str) -> Self {
        let id = backend.id().to_string();
        let mut b = Self::builder().backend(backend);
        for role in [
            Role::Reflex,
            Role::Cortex,
            Role::Oracle,
            Role::Embed,
            Role::Vision,
        ] {
            b = b.assign(role, &id, model);
        }
        Self::from_parts(b.backends, b.roles)
    }

    fn from_parts(
        backends: Vec<(Arc<dyn ModelBackend>, usize)>,
        roles: Vec<(Role, Assignment)>,
    ) -> Self {
        let mut routes = Routes::default();
        for (backend, n) in backends {
            let slot = Slot {
                gate: Gate::new(n),
                backend,
            };
            routes
                .backends
                .insert(slot.backend.id().to_string(), Arc::new(slot));
        }
        routes.roles.extend(roles);
        Self {
            routes: RwLock::new(routes),
            counters: Mutex::new(Counters::default()),
        }
    }

    /// Registers (or replaces) a backend, e.g. a Hive peer that just joined.
    pub fn add_backend(&self, backend: Arc<dyn ModelBackend>, concurrency: usize) {
        let slot = Slot {
            gate: Gate::new(concurrency),
            backend,
        };
        let id = slot.backend.id().to_string();
        self.write().backends.insert(id, Arc::new(slot));
    }

    /// Removes a backend and every role assigned to it.
    pub fn remove_backend(&self, id: &str) {
        let mut r = self.write();
        r.backends.remove(id);
        r.roles.retain(|_, a| a.backend != id);
    }

    /// Points `role` at `model` on a registered backend.
    pub fn assign(&self, role: Role, backend: &str, model: &str) -> Result<(), XzError> {
        let mut r = self.write();
        if !r.backends.contains_key(backend) {
            return Err(XzError::NotFound(format!("backend {backend}")));
        }
        r.roles.insert(
            role,
            Assignment {
                backend: backend.into(),
                model: model.into(),
            },
        );
        Ok(())
    }

    pub fn unassign(&self, role: Role) {
        self.write().roles.remove(&role);
    }

    /// The assignment that would serve `role`, after fallbacks.
    pub fn assignment(&self, role: Role) -> Option<Assignment> {
        let r = self.read();
        resolve(&r, role).map(|(a, _)| a.clone())
    }

    /// Ids of the registered backends.
    pub fn backend_ids(&self) -> Vec<String> {
        let mut ids: Vec<String> = self.read().backends.keys().cloned().collect();
        ids.sort();
        ids
    }

    pub fn stats(&self) -> CortexStats {
        let queued = self.read().backends.values().map(|s| s.gate.queued()).sum();
        let mut stats = self.lock_counters().stats.clone();
        stats.queued = queued;
        stats
    }

    fn route(&self, role: Role) -> Result<(Arc<Slot>, String), XzError> {
        let r = self.read();
        resolve(&r, role)
            .map(|(a, slot)| (slot.clone(), a.model.clone()))
            .ok_or_else(|| XzError::Model(format!("no model assigned to role {role:?}")))
    }

    fn read(&self) -> std::sync::RwLockReadGuard<'_, Routes> {
        self.routes.read().unwrap_or_else(|e| e.into_inner())
    }

    fn write(&self) -> std::sync::RwLockWriteGuard<'_, Routes> {
        self.routes.write().unwrap_or_else(|e| e.into_inner())
    }

    fn lock_counters(&self) -> std::sync::MutexGuard<'_, Counters> {
        self.counters.lock().unwrap_or_else(|e| e.into_inner())
    }
}

/// Explicit assignment first; Reflex and Oracle fall back to Cortex.
fn resolve(r: &Routes, role: Role) -> Option<(&Assignment, &Arc<Slot>)> {
    let direct = |role| {
        let a = r.roles.get(&role)?;
        Some((a, r.backends.get(&a.backend)?))
    };
    direct(role).or_else(|| match role {
        Role::Reflex | Role::Oracle => direct(Role::Cortex),
        _ => None,
    })
}

#[async_trait]
impl Inference for Cortex {
    async fn generate(&self, req: GenRequest) -> Result<GenResponse, XzError> {
        let (slot, model) = self.route(req.role)?;
        let permit = slot.gate.acquire(req.priority).await;
        let start = Instant::now();
        let result = slot.backend.generate(&model, &req).await;
        drop(permit);

        let mut c = self.lock_counters();
        match result {
            Ok(mut resp) => {
                if resp.millis == 0 {
                    resp.millis = start.elapsed().as_millis() as u64;
                }
                let c = &mut *c;
                c.stats.requests += 1;
                c.stats.tokens_in += u64::from(resp.tokens_in);
                c.stats.tokens_out += u64::from(resp.tokens_out);
                c.gen_millis += resp.millis;
                if c.gen_millis > 0 {
                    c.stats.tokens_per_sec =
                        c.stats.tokens_out as f64 * 1000.0 / c.gen_millis as f64;
                }
                c.stats.last_model = Some(resp.model.clone());
                Ok(resp)
            }
            Err(e) => {
                c.stats.requests += 1;
                c.stats.errors += 1;
                Err(e)
            }
        }
    }

    async fn embed(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, XzError> {
        let (slot, model) = self.route(Role::Embed)?;
        // `Inference::embed` carries no priority; embeddings are short, so they
        // queue with ordinary foreground work.
        let permit = slot.gate.acquire(Priority::Foreground).await;
        let result = slot.backend.embed(&model, texts).await;
        drop(permit);
        let mut c = self.lock_counters();
        c.stats.embeds += 1;
        if result.is_err() {
            c.stats.errors += 1;
        }
        result
    }

    fn has_role(&self, role: Role) -> bool {
        let r = self.read();
        r.roles
            .get(&role)
            .is_some_and(|a| r.backends.contains_key(&a.backend))
    }
}

/// Builds a [`Cortex`] for a real setup.
#[derive(Default)]
pub struct CortexBuilder {
    backends: Vec<(Arc<dyn ModelBackend>, usize)>,
    roles: Vec<(Role, Assignment)>,
}

impl CortexBuilder {
    /// Adds a backend that runs one request at a time.
    pub fn backend(self, backend: Arc<dyn ModelBackend>) -> Self {
        self.backend_with_concurrency(backend, 1)
    }

    /// Adds a backend that may run `n` requests at once.
    pub fn backend_with_concurrency(mut self, backend: Arc<dyn ModelBackend>, n: usize) -> Self {
        self.backends.push((backend, n));
        self
    }

    pub fn assign(mut self, role: Role, backend: &str, model: &str) -> Self {
        let a = Assignment {
            backend: backend.into(),
            model: model.into(),
        };
        self.roles.retain(|(r, _)| *r != role);
        self.roles.push((role, a));
        self
    }

    /// Assigns every role in a Genesis profile, translating registry names into
    /// what `backend` expects (an Ollama tag, or a GGUF path in `models_dir`).
    pub fn assign_profile(
        mut self,
        profile: &Profile,
        registry: &Registry,
        backend: &str,
        models_dir: &Path,
    ) -> Result<Self, XzError> {
        for (role, name) in &profile.roles {
            let entry = registry.get(name)?;
            let model = entry.backend_model(backend, models_dir).ok_or_else(|| {
                XzError::NotFound(format!("model {name} has no weights for backend {backend}"))
            })?;
            self = self.assign(*role, backend, &model);
        }
        Ok(self)
    }

    /// Checks that every assignment names a registered backend.
    pub fn build(self) -> Result<Cortex, XzError> {
        for (role, a) in &self.roles {
            if !self.backends.iter().any(|(b, _)| b.id() == a.backend) {
                return Err(XzError::NotFound(format!(
                    "backend {} (assigned to {role:?})",
                    a.backend
                )));
            }
        }
        Ok(Cortex::from_parts(self.backends, self.roles))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scripted::ScriptedBackend;
    use std::time::Duration;
    use xz_types::ChatMessage;

    fn req(role: Role) -> GenRequest {
        GenRequest::new(role, vec![ChatMessage::user("hello world")])
    }

    #[tokio::test]
    async fn single_serves_every_role_and_counts() {
        let sb = Arc::new(ScriptedBackend::new(|m, r| format!("{m} {:?}", r.role)));
        let cx = Cortex::single(sb.clone(), "tiny");
        for role in [Role::Reflex, Role::Cortex, Role::Oracle, Role::Vision] {
            assert!(cx.has_role(role));
            let out = cx.generate(req(role)).await.unwrap();
            assert_eq!(out.text, format!("tiny {role:?}"));
        }
        assert_eq!(cx.embed(&["a b".into()]).await.unwrap().len(), 1);
        let s = cx.stats();
        assert_eq!((s.requests, s.embeds, s.errors), (4, 1, 0));
        assert_eq!(s.tokens_in, 8);
        assert_eq!(s.tokens_out, 8);
        assert_eq!(s.last_model.as_deref(), Some("scripted:tiny"));
        assert_eq!(s.queued, 0);
        assert_eq!(sb.calls().len(), 4);
    }

    #[tokio::test]
    async fn fallbacks_and_explicit_has_role() {
        let main = Arc::new(ScriptedBackend::new(|m, _| m.to_string()));
        let cx = Cortex::builder()
            .backend(main)
            .assign(Role::Cortex, "scripted", "big")
            .build()
            .unwrap();
        assert_eq!(cx.generate(req(Role::Reflex)).await.unwrap().text, "big");
        assert_eq!(cx.generate(req(Role::Oracle)).await.unwrap().text, "big");
        assert!(cx.has_role(Role::Cortex));
        assert!(!cx.has_role(Role::Reflex) && !cx.has_role(Role::Oracle));
        assert!(matches!(
            cx.generate(req(Role::Vision)).await,
            Err(XzError::Model(_))
        ));
        assert!(cx.embed(&["x".into()]).await.is_err());
        assert_eq!(cx.assignment(Role::Oracle).unwrap().model, "big");
        assert!(cx.assignment(Role::Embed).is_none());
    }

    #[tokio::test]
    async fn runtime_backends_and_assignments() {
        let local = Arc::new(ScriptedBackend::always("local"));
        let cx = Cortex::builder()
            .backend(local)
            .assign(Role::Cortex, "scripted", "m")
            .build()
            .unwrap();
        let peer = Arc::new(ScriptedBackend::always("peer").with_id("hive:pc"));
        assert!(cx.assign(Role::Oracle, "hive:pc", "huge").is_err());
        cx.add_backend(peer, 1);
        cx.assign(Role::Oracle, "hive:pc", "huge").unwrap();
        assert_eq!(cx.backend_ids(), ["hive:pc", "scripted"]);
        assert_eq!(cx.generate(req(Role::Oracle)).await.unwrap().text, "peer");
        // The peer drops: Oracle degrades to the local Cortex.
        cx.remove_backend("hive:pc");
        assert!(!cx.has_role(Role::Oracle));
        assert_eq!(cx.generate(req(Role::Oracle)).await.unwrap().text, "local");
        cx.unassign(Role::Cortex);
        assert!(cx.generate(req(Role::Cortex)).await.is_err());
    }

    #[test]
    fn builder_rejects_unknown_backend() {
        assert!(
            Cortex::builder()
                .assign(Role::Cortex, "ollama", "m")
                .build()
                .is_err()
        );
    }

    #[tokio::test]
    async fn errors_are_counted() {
        let cx = Cortex::single(Arc::new(ScriptedBackend::queue(Vec::<String>::new())), "m");
        assert!(cx.generate(req(Role::Cortex)).await.is_err());
        assert_eq!(cx.stats().errors, 1);
    }

    /// A backend that records who reached it and blocks until told to finish.
    struct Slow {
        go: tokio::sync::Semaphore,
        seen: Mutex<Vec<Priority>>,
    }

    #[async_trait]
    impl ModelBackend for Slow {
        fn id(&self) -> &str {
            "slow"
        }
        async fn available(&self) -> bool {
            true
        }
        async fn generate(&self, _: &str, req: &GenRequest) -> Result<GenResponse, XzError> {
            self.seen.lock().unwrap().push(req.priority);
            let _go = self.go.acquire().await;
            Ok(GenResponse {
                tokens_out: 10,
                millis: 500,
                ..Default::default()
            })
        }
        async fn embed(&self, _: &str, _: &[String]) -> Result<Vec<Vec<f32>>, XzError> {
            Ok(vec![])
        }
    }

    #[tokio::test]
    async fn requests_queue_by_priority_per_backend() {
        let slow = Arc::new(Slow {
            go: tokio::sync::Semaphore::new(0),
            seen: Mutex::new(vec![]),
        });
        let cx = Arc::new(Cortex::single(slow.clone(), "m"));
        let spawn = |p: Priority| {
            let cx = cx.clone();
            tokio::spawn(async move { cx.generate(req(Role::Cortex).with_priority(p)).await })
        };
        let mut tasks = vec![spawn(Priority::Dream)];
        while slow.seen.lock().unwrap().is_empty() {
            tokio::task::yield_now().await;
        }
        for p in [
            Priority::Background,
            Priority::Foreground,
            Priority::Interactive,
        ] {
            tasks.push(spawn(p));
        }
        while cx.stats().queued < 3 {
            tokio::task::yield_now().await;
        }
        slow.go.add_permits(4);
        for t in tasks {
            tokio::time::timeout(Duration::from_secs(5), t)
                .await
                .unwrap()
                .unwrap()
                .unwrap();
        }
        assert_eq!(
            *slow.seen.lock().unwrap(),
            [
                Priority::Dream,
                Priority::Interactive,
                Priority::Foreground,
                Priority::Background
            ]
        );
        let s = cx.stats();
        assert_eq!(s.tokens_out, 40);
        assert!((s.tokens_per_sec - 20.0).abs() < 1e-9);
    }
}
