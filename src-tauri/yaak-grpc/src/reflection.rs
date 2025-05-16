use std::collections::BTreeMap;
use std::env::temp_dir;
use std::ops::Deref;
use std::path::PathBuf;
use std::str::FromStr;

use crate::client::AutoReflectionClient;
use anyhow::anyhow;
use async_recursion::async_recursion;
use log::{debug, warn};
use prost::Message;
use prost_reflect::{DescriptorPool, MethodDescriptor};
use prost_types::{FileDescriptorProto, FileDescriptorSet};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::ShellExt;
use tokio::fs;
use tonic::codegen::http::uri::PathAndQuery;
use tonic::transport::Uri;
use tonic_reflection::pb::v1::server_reflection_request::MessageRequest;
use tonic_reflection::pb::v1::server_reflection_response::MessageResponse;

pub async fn fill_pool_from_files(
    app_handle: &AppHandle,
    paths: &Vec<PathBuf>,
) -> Result<DescriptorPool, String> {
    let mut pool = DescriptorPool::new();
    let random_file_name = format!("{}.desc", uuid::Uuid::new_v4());
    let desc_path = temp_dir().join(random_file_name);
    let global_import_dir = app_handle
        .path()
        .resolve("vendored/protoc/include", BaseDirectory::Resource)
        .expect("failed to resolve protoc include directory");

    // HACK: Remove UNC prefix for Windows paths
    let global_import_dir =
        dunce::simplified(global_import_dir.as_path()).to_string_lossy().to_string();
    let desc_path = dunce::simplified(desc_path.as_path());

    let mut args = vec![
        "--include_imports".to_string(),
        "--include_source_info".to_string(),
        "-I".to_string(),
        global_import_dir,
        "-o".to_string(),
        desc_path.to_string_lossy().to_string(),
    ];

    for p in paths {
        if p.as_path().exists() {
            args.push(p.to_string_lossy().to_string());
        } else {
            continue;
        }

        let parent = p.as_path().parent();
        if let Some(parent_path) = parent {
            args.push("-I".to_string());
            args.push(parent_path.to_string_lossy().to_string());
            args.push("-I".to_string());
            args.push(parent_path.parent().unwrap().to_string_lossy().to_string());
        } else {
            debug!("ignoring {:?} since it does not exist.", parent)
        }
    }

    let out = app_handle
        .shell()
        .sidecar("yaakprotoc")
        .expect("yaakprotoc not found")
        .args(args)
        .output()
        .await
        .expect("yaakprotoc failed to run");

    if !out.status.success() {
        return Err(format!(
            "protoc failed with status {}: {}",
            out.status.code().unwrap(),
            String::from_utf8_lossy(out.stderr.as_slice())
        ));
    }

    let bytes = fs::read(desc_path).await.map_err(|e| e.to_string())?;
    let fdp = FileDescriptorSet::decode(bytes.deref()).map_err(|e| e.to_string())?;
    pool.add_file_descriptor_set(fdp).map_err(|e| e.to_string())?;

    fs::remove_file(desc_path).await.map_err(|e| e.to_string())?;

    Ok(pool)
}

pub async fn fill_pool_from_reflection(
    uri: &Uri,
    metadata: &BTreeMap<String, String>,
) -> Result<DescriptorPool, String> {
    let mut pool = DescriptorPool::new();
    let mut client = AutoReflectionClient::new(uri);

    for service in list_services(&mut client, metadata).await? {
        if service == "grpc.reflection.v1alpha.ServerReflection" {
            continue;
        }
        if service == "grpc.reflection.v1.ServerReflection" {
            // TODO: update reflection client to use v1
            continue;
        }
        file_descriptor_set_from_service_name(&service, &mut pool, &mut client, metadata).await;
    }

    Ok(pool)
}

async fn list_services(
    client: &mut AutoReflectionClient,
    metadata: &BTreeMap<String, String>,
) -> Result<Vec<String>, String> {
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
            warn!("Error fetching file descriptor for service {}: {}", service_name, e);
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

#[async_recursion]
async fn add_file_descriptors_to_pool(
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
            warn!("Error fetching file descriptor for {}: {}", filename, e);
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
            SimpleTopoSort {
                out_graph: HashMap::new(),
                in_graph: HashMap::new(),
            }
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

            SimpleTopoSortIter {
                data,
                zero_indegree,
            }
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
