use crate::any::collect_any_types;
use crate::client::AutoReflectionClient;
use crate::error::Error::GenericError;
use crate::error::Result;
use crate::manager::GrpcConfig;
use anyhow::anyhow;
use async_recursion::async_recursion;
use log::{debug, info, warn};
use prost::Message;
use prost_reflect::{DescriptorPool, MethodDescriptor};
use prost_types::{FileDescriptorProto, FileDescriptorSet};
use std::collections::{BTreeMap, HashSet};
use std::env::temp_dir;
use std::ops::Deref;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::Arc;
use tokio::fs;
use tokio::sync::RwLock;
use tonic::codegen::http::uri::PathAndQuery;
use tonic::transport::Uri;
use tonic_reflection::pb::v1::server_reflection_request::MessageRequest;
use tonic_reflection::pb::v1::server_reflection_response::MessageResponse;
use yaak_common::command::new_xplatform_command;
use yaak_tls::ClientCertificateConfig;

pub async fn fill_pool_from_files(
    config: &GrpcConfig,
    paths: &Vec<PathBuf>,
) -> Result<DescriptorPool> {
    let mut pool = DescriptorPool::new();
    let random_file_name = format!("{}.desc", uuid::Uuid::new_v4());
    let desc_path = temp_dir().join(random_file_name);

    // HACK: Remove UNC prefix for Windows paths
    let global_import_dir =
        dunce::simplified(config.protoc_include_dir.as_path()).to_string_lossy().to_string();
    let desc_path = dunce::simplified(desc_path.as_path());

    let mut args = vec![
        "--include_imports".to_string(),
        "--include_source_info".to_string(),
        "-I".to_string(),
        global_import_dir,
        "-o".to_string(),
        desc_path.to_string_lossy().to_string(),
    ];

    let mut include_dirs = HashSet::new();
    let mut include_protos = HashSet::new();

    for p in paths {
        if !p.exists() {
            continue;
        }

        // Dirs are added as includes
        if p.is_dir() {
            include_dirs.insert(p.to_string_lossy().to_string());
            continue;
        }

        let parent = p.as_path().parent();
        if let Some(parent_path) = parent {
            match find_parent_proto_dir(parent_path) {
                None => {
                    // Add parent/grandparent as fallback
                    include_dirs.insert(parent_path.to_string_lossy().to_string());
                    if let Some(grandparent_path) = parent_path.parent() {
                        include_dirs.insert(grandparent_path.to_string_lossy().to_string());
                    }
                }
                Some(p) => {
                    include_dirs.insert(p.to_string_lossy().to_string());
                }
            };
        } else {
            debug!("ignoring {:?} since it does not exist.", parent)
        }

        include_protos.insert(p.to_string_lossy().to_string());
    }

    for d in include_dirs.clone() {
        args.push("-I".to_string());
        args.push(d);
    }
    for p in include_protos.clone() {
        args.push(p);
    }

    info!("Invoking protoc with {}", args.join(" "));

    let mut cmd = new_xplatform_command(&config.protoc_bin_path);
    cmd.args(&args);

    let out =
        cmd.output().await.map_err(|e| GenericError(format!("Failed to run protoc: {}", e)))?;

    if !out.status.success() {
        return Err(GenericError(format!(
            "protoc failed with status {}: {}",
            out.status.code().unwrap_or(-1),
            String::from_utf8_lossy(out.stderr.as_slice())
        )));
    }

    let bytes = fs::read(desc_path).await?;
    let fdp = FileDescriptorSet::decode(bytes.deref())?;
    pool.add_file_descriptor_set(fdp)?;

    fs::remove_file(desc_path).await?;

    Ok(pool)
}

pub async fn fill_pool_from_reflection(
    uri: &Uri,
    metadata: &BTreeMap<String, String>,
    validate_certificates: bool,
    client_cert: Option<ClientCertificateConfig>,
) -> Result<DescriptorPool> {
    let mut pool = DescriptorPool::new();
    let mut client = AutoReflectionClient::new(uri, validate_certificates, client_cert)?;

    for service in list_services(&mut client, metadata).await? {
        if service == "grpc.reflection.v1alpha.ServerReflection" {
            continue;
        }
        if service == "grpc.reflection.v1.ServerReflection" {
            continue;
        }
        debug!("Fetching descriptors for {}", service);
        file_descriptor_set_from_service_name(&service, &mut pool, &mut client, metadata).await;
    }

    Ok(pool)
}

async fn list_services(
    client: &mut AutoReflectionClient,
    metadata: &BTreeMap<String, String>,
) -> Result<Vec<String>> {
    let response =
        client.send_reflection_request(MessageRequest::ListServices("".into()), metadata).await?;

    let list_services_response = match response {
        MessageResponse::ListServicesResponse(resp) => resp,
        _ => panic!("Expected a ListServicesResponse variant"),
    };

    Ok(list_services_response.service.iter().map(|s| s.name.clone()).collect::<Vec<_>>())
}

async fn file_descriptor_set_from_service_name(
    service_name: &str,
    pool: &mut DescriptorPool,
    client: &mut AutoReflectionClient,
    metadata: &BTreeMap<String, String>,
) {
    let response = match client
        .send_reflection_request(
            MessageRequest::FileContainingSymbol(service_name.into()),
            metadata,
        )
        .await
    {
        Ok(resp) => resp,
        Err(e) => {
            warn!("Error fetching file descriptor for service {}: {:?}", service_name, e);
            return;
        }
    };

    let file_descriptor_response = match response {
        MessageResponse::FileDescriptorResponse(resp) => resp,
        _ => panic!("Expected a FileDescriptorResponse variant"),
    };

    add_file_descriptors_to_pool(
        file_descriptor_response.file_descriptor_proto,
        pool,
        client,
        metadata,
    )
    .await;
}

pub(crate) async fn reflect_types_for_message(
    pool: Arc<RwLock<DescriptorPool>>,
    uri: &Uri,
    json: &str,
    metadata: &BTreeMap<String, String>,
    client_cert: Option<ClientCertificateConfig>,
) -> Result<()> {
    // 1. Collect all Any types in the JSON
    let mut extra_types = Vec::new();
    collect_any_types(json, &mut extra_types);

    if extra_types.is_empty() {
        return Ok(()); // nothing to do
    }

    let mut client = AutoReflectionClient::new(uri, false, client_cert)?;
    for extra_type in extra_types {
        {
            let guard = pool.read().await;
            if guard.get_message_by_name(&extra_type).is_some() {
                continue;
            }
        }
        info!("Adding file descriptor for {:?} from reflection", extra_type);
        let req = MessageRequest::FileContainingSymbol(extra_type.clone().into());
        let resp = match client.send_reflection_request(req, metadata).await {
            Ok(r) => r,
            Err(e) => {
                return Err(GenericError(format!(
                    "Error sending reflection request for @type \"{extra_type}\": {e:?}",
                )));
            }
        };
        let files = match resp {
            MessageResponse::FileDescriptorResponse(resp) => resp.file_descriptor_proto,
            _ => panic!("Expected a FileDescriptorResponse variant"),
        };

        {
            let mut guard = pool.write().await;
            add_file_descriptors_to_pool(files, &mut *guard, &mut client, metadata).await;
        }
    }

    Ok(())
}

#[async_recursion]
pub(crate) async fn add_file_descriptors_to_pool(
    fds: Vec<Vec<u8>>,
    pool: &mut DescriptorPool,
    client: &mut AutoReflectionClient,
    metadata: &BTreeMap<String, String>,
) {
    let mut topo_sort = topology::SimpleTopoSort::new();
    let mut fd_mapping = std::collections::HashMap::with_capacity(fds.len());

    for fd in fds {
        let fdp = FileDescriptorProto::decode(fd.deref()).unwrap();

        topo_sort.insert(fdp.name().to_string(), fdp.dependency.clone());
        fd_mapping.insert(fdp.name().to_string(), fdp);
    }

    for node in topo_sort {
        match node {
            Ok(node) => {
                if let Some(fdp) = fd_mapping.remove(&node) {
                    pool.add_file_descriptor_proto(fdp).expect("add file descriptor proto");
                } else {
                    file_descriptor_set_by_filename(node.as_str(), pool, client, metadata).await;
                }
            }
            Err(_) => panic!("proto file got cycle!"),
        }
    }
}

async fn file_descriptor_set_by_filename(
    filename: &str,
    pool: &mut DescriptorPool,
    client: &mut AutoReflectionClient,
    metadata: &BTreeMap<String, String>,
) {
    // We already fetched this file
    if let Some(_) = pool.get_file_by_name(filename) {
        return;
    }

    let msg = MessageRequest::FileByFilename(filename.into());
    let response = client.send_reflection_request(msg, metadata).await;
    let file_descriptor_response = match response {
        Ok(MessageResponse::FileDescriptorResponse(resp)) => resp,
        Ok(_) => {
            panic!("Expected a FileDescriptorResponse variant")
        }
        Err(e) => {
            warn!("Error fetching file descriptor for {}: {:?}", filename, e);
            return;
        }
    };

    add_file_descriptors_to_pool(
        file_descriptor_response.file_descriptor_proto,
        pool,
        client,
        metadata,
    )
    .await;
}

pub fn method_desc_to_path(md: &MethodDescriptor) -> PathAndQuery {
    let full_name = md.full_name();
    let (namespace, method_name) = full_name
        .rsplit_once('.')
        .ok_or_else(|| anyhow!("invalid method path"))
        .expect("invalid method path");
    PathAndQuery::from_str(&format!("/{}/{}", namespace, method_name)).expect("invalid method path")
}

mod topology {
    use std::collections::{HashMap, HashSet};

    pub struct SimpleTopoSort<T> {
        out_graph: HashMap<T, HashSet<T>>,
        in_graph: HashMap<T, HashSet<T>>,
    }

    impl<T> SimpleTopoSort<T>
    where
        T: Eq + std::hash::Hash + Clone,
    {
        pub fn new() -> Self {
            SimpleTopoSort { out_graph: HashMap::new(), in_graph: HashMap::new() }
        }

        pub fn insert<I: IntoIterator<Item = T>>(&mut self, node: T, deps: I) {
            self.out_graph.entry(node.clone()).or_insert(HashSet::new());
            for dep in deps {
                self.out_graph.entry(node.clone()).or_insert(HashSet::new()).insert(dep.clone());
                self.in_graph.entry(dep.clone()).or_insert(HashSet::new()).insert(node.clone());
            }
        }
    }

    impl<T> IntoIterator for SimpleTopoSort<T>
    where
        T: Eq + std::hash::Hash + Clone,
    {
        type Item = <SimpleTopoSortIter<T> as Iterator>::Item;
        type IntoIter = SimpleTopoSortIter<T>;

        fn into_iter(self) -> Self::IntoIter {
            SimpleTopoSortIter::new(self)
        }
    }

    pub struct SimpleTopoSortIter<T> {
        data: SimpleTopoSort<T>,
        zero_indegree: Vec<T>,
    }

    impl<T> SimpleTopoSortIter<T>
    where
        T: Eq + std::hash::Hash + Clone,
    {
        pub fn new(data: SimpleTopoSort<T>) -> Self {
            let mut zero_indegree = Vec::new();
            for (node, _) in data.in_graph.iter() {
                if !data.out_graph.contains_key(node) {
                    zero_indegree.push(node.clone());
                }
            }
            for (node, deps) in data.out_graph.iter() {
                if deps.is_empty() {
                    zero_indegree.push(node.clone());
                }
            }

            SimpleTopoSortIter { data, zero_indegree }
        }
    }

    impl<T> Iterator for SimpleTopoSortIter<T>
    where
        T: Eq + std::hash::Hash + Clone,
    {
        type Item = Result<T, &'static str>;

        fn next(&mut self) -> Option<Self::Item> {
            if self.zero_indegree.is_empty() {
                if self.data.out_graph.is_empty() {
                    return None;
                }
                return Some(Err("Cycle detected"));
            }

            let node = self.zero_indegree.pop().unwrap();
            if let Some(parents) = self.data.in_graph.get(&node) {
                for parent in parents.iter() {
                    let deps = self.data.out_graph.get_mut(parent).unwrap();
                    deps.remove(&node);
                    if deps.is_empty() {
                        self.zero_indegree.push(parent.clone());
                    }
                }
            }
            self.data.out_graph.remove(&node);

            Some(Ok(node))
        }
    }

    #[test]
    fn test_sort() {
        {
            let mut topo_sort = SimpleTopoSort::new();
            topo_sort.insert("a", []);

            for node in topo_sort {
                match node {
                    Ok(n) => assert_eq!(n, "a"),
                    Err(e) => panic!("err {}", e),
                }
            }
        }

        {
            let mut topo_sort = SimpleTopoSort::new();
            topo_sort.insert("a", ["b"]);
            topo_sort.insert("b", []);

            let mut iter = topo_sort.into_iter();
            match iter.next() {
                Some(Ok(n)) => assert_eq!(n, "b"),
                _ => panic!("err"),
            }
            match iter.next() {
                Some(Ok(n)) => assert_eq!(n, "a"),
                _ => panic!("err"),
            }
            assert_eq!(iter.next(), None);
        }
    }
}

fn find_parent_proto_dir(start_path: impl AsRef<Path>) -> Option<PathBuf> {
    let mut dir = start_path.as_ref().canonicalize().ok()?;

    loop {
        if let Some(name) = dir.file_name().and_then(|n| n.to_str()) {
            if name == "proto" {
                return Some(dir);
            }
        }

        let parent = dir.parent()?;
        if parent == dir {
            return None; // Reached root
        }

        dir = parent.to_path_buf();
    }
}
